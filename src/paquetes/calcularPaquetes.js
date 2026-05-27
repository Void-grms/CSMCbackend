/**
 * calcularPaquetes.js  — versión 3
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor central del sistema de monitoreo PP 0131.
 *
 * Cambios respecto a v2:
 *   • Reglas especiales leídas desde la tabla paquete_regla_especial (BD),
 *     ya no están hardcodeadas. Ver src/paquetes/reglasEspeciales.js.
 *   • Cada paquete_paciente nuevo guarda la version_catalogo activa al momento
 *     de abrirse. El cálculo de avance respeta esa versión: paquetes ya
 *     abiertos NO cambian de regla aunque se edite el paquete después.
 *
 * Pasos del ciclo:
 *   1. Apertura de paquetes nuevos (detección de Dx disparadores P/D)
 *   2. Cálculo de avance por componente, usando la versión del catálogo
 *      asociada a cada paquete abierto.
 *   3. Actualización de estados (completado / vencido)
 *
 * Uso:
 *   const { calcularPaquetes } = require('./calcularPaquetes');
 *   await calcularPaquetes();          // todos los periodos
 *   await calcularPaquetes(2025, 1);   // solo enero 2025 (informativo)
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const { Pool } = require('pg');
const { evaluarReglas } = require('./reglasEspeciales');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  client_encoding: 'utf8',
});

let contadores = {
  paquetesAbiertosEncontrados: 0,
  nuevosAbiertos: 0,
  pasaronCompletado: 0,
  pasaronVencido: 0,
  errores: 0,
};

function resetContadores() {
  contadores = {
    paquetesAbiertosEncontrados: 0,
    nuevosAbiertos: 0,
    pasaronCompletado: 0,
    pasaronVencido: 0,
    errores: 0,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// PASO 1 — APERTURA DE PAQUETES
// ═════════════════════════════════════════════════════════════════════════════

async function paso1_abrirPaquetes(client) {
  console.log('\n── PASO 1: Apertura de paquetes ──────────────────────────────');

  // Candidatos: atenciones cuyo codigo_item está en el grupo_dx de la versión
  // ACTUAL de algún paquete (los paquetes inactivos no aparecen en
  // paquete_version_actual con grupo_dx vigente porque sincronizarTablasCanonicas
  // borra del catálogo canónico al desactivar, pero leemos directo de _version
  // para mayor seguridad).
  const { rows: candidatos } = await client.query(`
    SELECT
      a.id_cita,
      a.id_paciente,
      a.fecha_atencion,
      a.codigo_item,
      a.tipo_diagnostico,
      a.valor_lab,
      pgdv.id_paquete,
      pva.version_actual AS version,
      EXTRACT(YEAR FROM AGE(a.fecha_atencion, p.fecha_nacimiento))::INT AS edad_anos
    FROM atencion a
    JOIN paquete_version_actual pva ON TRUE
    JOIN paquete_grupo_dx_version pgdv
      ON pgdv.id_paquete = pva.id_paquete
     AND pgdv.version    = pva.version_actual
     AND pgdv.codigo_cie10 = a.codigo_item
    JOIN paquete_definicion_version pdv
      ON pdv.id_paquete = pgdv.id_paquete
     AND pdv.version    = pgdv.version
     AND pdv.activo     = TRUE
    LEFT JOIN paciente p ON p.id_paciente = a.id_paciente
    WHERE a.tipo_diagnostico IN ('P', 'D')
    ORDER BY a.id_paciente, pgdv.id_paquete, a.fecha_atencion ASC, a.id_correlativo ASC
  `);

  console.log(`  Candidatos encontrados: ${candidatos.length}`);

  // Pre-cargar definiciones (plazo + edad) para todas las versiones actuales
  const { rows: defRows } = await client.query(`
    SELECT pdv.id_paquete, pdv.version, pdv.plazo_meses,
           pdv.edad_minima, pdv.edad_maxima
    FROM paquete_definicion_version pdv
    JOIN paquete_version_actual pva
      ON pva.id_paquete = pdv.id_paquete
     AND pva.version_actual = pdv.version
  `);
  const defs = {};
  for (const r of defRows) {
    defs[r.id_paquete] = {
      version:     r.version,
      plazo_meses: r.plazo_meses,
      edad_minima: r.edad_minima,
      edad_maxima: r.edad_maxima,
    };
  }

  for (const cand of candidatos) {
    try {
      const { id_paciente, codigo_item, id_paquete, tipo_diagnostico, valor_lab, version } = cand;
      const fechaInicio = cand.fecha_atencion;
      const def = defs[id_paquete] || { plazo_meses: 8, edad_minima: null, edad_maxima: null, version };

      // ── Validación de edad ──
      if (cand.edad_anos !== null) {
        if (def.edad_minima !== null && cand.edad_anos < def.edad_minima) continue;
        if (def.edad_maxima !== null && cand.edad_anos > def.edad_maxima) continue;
      }

      // ── Reglas especiales (configuradas en BD) ──
      const reglasOk = await evaluarReglas(client, id_paquete, cand);
      if (!reglasOk) continue;

      // ── ¿Ya existe paquete que cubre esta fecha? ──
      const { rows: existente } = await client.query(`
        SELECT 1 FROM paquete_paciente
        WHERE id_paquete  = $1
          AND id_paciente = $2
          AND $3::DATE >= fecha_inicio
          AND $3::DATE <= fecha_limite
        LIMIT 1
      `, [id_paquete, id_paciente, fechaInicio]);
      if (existente.length > 0) continue;

      const plazoMeses = def.plazo_meses || 8;

      await client.query(`
        INSERT INTO paquete_paciente
          (id_paquete, id_paciente, fecha_inicio, fecha_limite, estado,
           dx_principal, tipo_diagnostico_dx, valor_lab_dx, version_catalogo)
        VALUES
          ($1, $2, $3, $3::DATE + ($4 || ' months')::INTERVAL, 'abierto',
           $5, $6, $7, $8)
        ON CONFLICT (id_paquete, id_paciente, fecha_inicio) DO NOTHING
      `, [id_paquete, id_paciente, fechaInicio, plazoMeses,
          codigo_item, tipo_diagnostico, valor_lab, def.version]);

      contadores.nuevosAbiertos++;
    } catch (err) {
      contadores.errores++;
      console.error(`  ✖ Error abriendo paquete para paciente ${cand.id_paciente}: ${err.message}`);
    }
  }

  console.log(`  Paquetes nuevos abiertos: ${contadores.nuevosAbiertos}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// PASO 2 — CÁLCULO DE AVANCE (usando versión del paquete_paciente)
// ═════════════════════════════════════════════════════════════════════════════

async function paso2_calcularAvance(client) {
  console.log('\n── PASO 2: Cálculo de avance ─────────────────────────────────');

  const { rows: paquetesAbiertos } = await client.query(`
    SELECT id, id_paquete, id_paciente, fecha_inicio, fecha_limite,
           COALESCE(version_catalogo, 1) AS version_catalogo
    FROM paquete_paciente
    WHERE estado = 'abierto'
  `);

  contadores.paquetesAbiertosEncontrados = paquetesAbiertos.length;
  console.log(`  Paquetes abiertos: ${paquetesAbiertos.length}`);

  // Pre-cargar componentes de TODAS las versiones referenciadas
  const { rows: detalleRows } = await client.query(`
    SELECT pdv.id_paquete, pdv.version, pdv.tipo_componente,
           pdv.cantidad_minima, pdv.usar_prefijo,
           COALESCE(ARRAY_AGG(pdcv.codigo_item)
             FILTER (WHERE pdcv.codigo_item IS NOT NULL), '{}') AS codigos
    FROM paquete_detalle_version pdv
    LEFT JOIN paquete_detalle_codigos_version pdcv
      ON pdcv.id_paquete = pdv.id_paquete
     AND pdcv.version    = pdv.version
     AND pdcv.tipo_componente = pdv.tipo_componente
    GROUP BY pdv.id_paquete, pdv.version, pdv.tipo_componente,
             pdv.cantidad_minima, pdv.usar_prefijo
  `);

  // { 'id_paquete|version': [ {tipo_componente, cantidad_minima, usar_prefijo, codigos[]} ] }
  const componentesPorVersion = {};
  for (const r of detalleRows) {
    const key = `${r.id_paquete}|${r.version}`;
    if (!componentesPorVersion[key]) componentesPorVersion[key] = [];
    componentesPorVersion[key].push({
      tipo_componente: r.tipo_componente,
      cantidad_minima: r.cantidad_minima,
      usar_prefijo:    r.usar_prefijo,
      codigos:         r.codigos || [],
    });
  }

  const resultados = new Map();

  for (const paq of paquetesAbiertos) {
    try {
      const key = `${paq.id_paquete}|${paq.version_catalogo}`;
      const componentes = componentesPorVersion[key] || [];
      let todosCumplidos = true;
      let maxFecha = null;
      const detalle = [];

      if (componentes.length === 0) {
        // Paquete sin componentes (ej. PF_CONTINUIDAD_CUIDADOS) — cierre manual.
        resultados.set(paq.id, {
          id_paquete:   paq.id_paquete,
          id_paciente:  paq.id_paciente,
          fecha_limite: paq.fecha_limite,
          componentes:  [],
          todosCumplidos: false,
          maxFecha:     null,
        });
        continue;
      }

      for (const comp of componentes) {
        let conteoRows;
        if (comp.usar_prefijo && comp.codigos.length) {
          const prefijo = comp.codigos[0].substring(0, 5);
          ({ rows: conteoRows } = await client.query(`
            SELECT COUNT(*)::INT AS cantidad,
                   MAX(fecha_atencion) AS ultima_fecha
            FROM atencion
            WHERE id_paciente          = $1
              AND fecha_atencion       >= $2
              AND fecha_atencion       <= $3
              AND LEFT(codigo_item, 5) = $4
          `, [paq.id_paciente, paq.fecha_inicio, paq.fecha_limite, prefijo]));
        } else {
          ({ rows: conteoRows } = await client.query(`
            SELECT COUNT(*)::INT AS cantidad,
                   MAX(fecha_atencion) AS ultima_fecha
            FROM atencion
            WHERE id_paciente     = $1
              AND fecha_atencion >= $2
              AND fecha_atencion <= $3
              AND codigo_item     = ANY($4)
          `, [paq.id_paciente, paq.fecha_inicio, paq.fecha_limite, comp.codigos]));
        }

        const cantidad_realizada = conteoRows[0].cantidad;
        const ultima_fecha       = conteoRows[0].ultima_fecha;
        const cumplido           = cantidad_realizada >= comp.cantidad_minima;

        if (!cumplido) todosCumplidos = false;
        if (ultima_fecha && (!maxFecha || ultima_fecha > maxFecha)) maxFecha = ultima_fecha;

        detalle.push({
          tipo_componente: comp.tipo_componente,
          cantidad_minima: comp.cantidad_minima,
          cantidad_realizada,
          cumplido,
        });
      }

      resultados.set(paq.id, {
        id_paquete:   paq.id_paquete,
        id_paciente:  paq.id_paciente,
        fecha_limite: paq.fecha_limite,
        componentes:  detalle,
        todosCumplidos,
        maxFecha,
      });
    } catch (err) {
      contadores.errores++;
      console.error(`  ✖ Error calculando avance de paquete ${paq.id}: ${err.message}`);
    }
  }

  console.log(`  Paquetes calculados: ${resultados.size}`);
  return resultados;
}

// ═════════════════════════════════════════════════════════════════════════════
// PASO 3 — ACTUALIZACIÓN DE ESTADOS
// ═════════════════════════════════════════════════════════════════════════════

async function paso3_actualizarEstados(client, resultados) {
  console.log('\n── PASO 3: Actualización de estados ──────────────────────────');

  const hoy = new Date();

  for (const [ppId, info] of resultados) {
    try {
      if (info.todosCumplidos) {
        await client.query(`
          UPDATE paquete_paciente
          SET estado = 'completado', fecha_cierre = $2
          WHERE id = $1 AND estado = 'abierto'
        `, [ppId, info.maxFecha]);
        contadores.pasaronCompletado++;
      } else if (hoy > new Date(info.fecha_limite)) {
        await client.query(`
          UPDATE paquete_paciente
          SET estado = 'vencido'
          WHERE id = $1 AND estado = 'abierto'
        `, [ppId]);
        contadores.pasaronVencido++;
      }
    } catch (err) {
      contadores.errores++;
      console.error(`  ✖ Error actualizando estado del paquete ${ppId}: ${err.message}`);
    }
  }

  console.log(`  Completados: ${contadores.pasaronCompletado}`);
  console.log(`  Vencidos:    ${contadores.pasaronVencido}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ═════════════════════════════════════════════════════════════════════════════

async function calcularPaquetes(anio, mes) {
  resetContadores();

  const periodo = (anio && mes)
    ? `${anio}-${String(mes).padStart(2, '0')}`
    : 'todos';

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║         MOTOR DE CÁLCULO DE PAQUETES PP 0131  v3           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Periodo de referencia : ${periodo}`);
  console.log(`  Reglas especiales     : leídas de paquete_regla_especial (BD)`);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await paso1_abrirPaquetes(client);
    await client.query('COMMIT');

    await client.query('BEGIN');
    const resultados = await paso2_calcularAvance(client);
    await client.query('COMMIT');

    await client.query('BEGIN');
    await paso3_actualizarEstados(client, resultados);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  RESUMEN DE CÁLCULO DE PAQUETES');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  Paquetes abiertos encontrados : ${contadores.paquetesAbiertosEncontrados}`);
  console.log(`  Nuevos paquetes abiertos      : ${contadores.nuevosAbiertos}`);
  console.log(`  Pasaron a completado          : ${contadores.pasaronCompletado}`);
  console.log(`  Pasaron a vencido             : ${contadores.pasaronVencido}`);
  console.log(`  Errores individuales          : ${contadores.errores}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  return contadores;
}

module.exports = { calcularPaquetes };

if (require.main === module) {
  calcularPaquetes()
    .then(() => {
      console.log('✔ Cálculo de paquetes finalizado.');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`✖ Error fatal: ${err.message}`);
      process.exit(1);
    });
}
