/**
 * calcularPaquetes.js  — versión 2
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor central del sistema de monitoreo PP 0131.
 *
 * Cambios respecto a v1:
 *   • PASO 1: Abre paquetes con tipo_diagnostico IN ('P', 'D') — Presuntivo o Definitivo.
 *   • PASO 1: Valida restricciones de edad (edad_minima / edad_maxima) usando
 *             la fecha de nacimiento del paciente y la fecha de la atención.
 *   • PASO 2/3: PF_CONTINUIDAD_CUIDADOS (5.5) no tiene componentes fijos;
 *               nunca pasa a 'completado' automáticamente (cierre manual).
 *
 * Pasos del ciclo:
 *   1. Apertura de paquetes nuevos (detección de Dx disparadores DEFINITIVOS)
 *   2. Cálculo de avance por componente (lógica del "o")
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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  client_encoding: 'utf8',
});

// ── Contadores globales del ciclo ────────────────────────────────────────────
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

/**
 * Busca atenciones con Dx disparadores PRESUNTIVOS (P) o DEFINITIVOS (D)
 * que deberían abrir un paquete nuevo y los crea si:
 *   a) No existe ya un paquete abierto del mismo tipo para ese paciente.
 *   b) La edad del paciente en la fecha de la atención está dentro del rango
 *      permitido por el paquete (edad_minima / edad_maxima).
 */
async function paso1_abrirPaquetes(client) {
  console.log('\n── PASO 1: Apertura de paquetes ──────────────────────────────');

  // ── 1a. Primera atención con Dx DEFINITIVO disparador por (paciente, paquete).
  //        Se incluye la fecha_nacimiento del paciente para validar la edad.
  const { rows: candidatos } = await client.query(`
    SELECT
      a.id_paciente,
      a.fecha_atencion,
      a.codigo_item,
      a.tipo_diagnostico,
      a.valor_lab,
      pgd.id_paquete,
      EXTRACT(YEAR FROM AGE(a.fecha_atencion, p.fecha_nacimiento))::INT AS edad_anos
    FROM atencion a
    JOIN paquete_grupo_dx pgd ON pgd.codigo_cie10 = a.codigo_item
    LEFT JOIN paciente p ON p.id_paciente = a.id_paciente
    WHERE a.tipo_diagnostico IN ('P', 'D')   -- PRESUNTIVO o DEFINITIVO abren paquete
    ORDER BY a.id_paciente, pgd.id_paquete, a.fecha_atencion ASC, a.id_correlativo ASC
  `);

  console.log(`  Candidatos encontrados: ${candidatos.length}`);

  // ── 1b. Pre-cargar definiciones de paquetes (plazo + restricciones de edad)
  const { rows: defRows } = await client.query(`
    SELECT id_paquete, plazo_meses, edad_minima, edad_maxima
    FROM paquete_definicion
  `);
  const defs = {};
  for (const r of defRows) {
    defs[r.id_paquete] = {
      plazo_meses: r.plazo_meses,
      edad_minima: r.edad_minima,   // null = sin límite inferior
      edad_maxima: r.edad_maxima,   // null = sin límite superior
    };
  }

  // ── 1c. Procesar cada candidato
  for (const cand of candidatos) {
    try {
      const { id_paciente, codigo_item, id_paquete, tipo_diagnostico, valor_lab } = cand;
      let fechaInicio = cand.fecha_atencion;

      const def = defs[id_paquete] || { plazo_meses: 8, edad_minima: null, edad_maxima: null };

      // ── Validación de edad ──────────────────────────────────────────────────
      // Si edad_anos es null (paciente sin fecha_nacimiento), omitimos validación.
      if (cand.edad_anos !== null) {
        if (def.edad_minima !== null && cand.edad_anos < def.edad_minima) {
          // Paciente demasiado joven para este paquete (ej: PF_VIOLENCIA_FAMILIAR exige ≥18)
          continue;
        }
        if (def.edad_maxima !== null && cand.edad_anos > def.edad_maxima) {
          // Paciente demasiado mayor para este paquete (ej: PF_MALTRATO_NNA exige ≤17)
          continue;
        }
      }

      // ── Regla especial: PF_REHAB_PSICOSOCIAL_ALC ───────────────────────────
      // Se activa SOLO cuando el paciente tiene AMBOS códigos F102 + Z502
      // registrados como definitivos en el mismo mes.
      if (id_paquete === 'PF_REHAB_PSICOSOCIAL_ALC') {
        const { rows: check } = await client.query(`
          SELECT 1
          FROM atencion a1
          JOIN atencion a2
            ON  a1.id_paciente = a2.id_paciente
            AND DATE_TRUNC('month', a1.fecha_atencion) = DATE_TRUNC('month', a2.fecha_atencion)
          WHERE a1.id_paciente         = $1
            AND a1.codigo_item         = 'F102'
            AND a2.codigo_item         = 'Z502'
            AND a1.tipo_diagnostico    = 'D'
            AND a2.tipo_diagnostico    = 'D'
          LIMIT 1
        `, [id_paciente]);

        if (check.length === 0) continue;
      }

      // ── Regla especial: PF_REHAB_PSICOSOCIAL y PF_REHAB_LABORAL ───────────

      // ── PF_CONTINUIDAD_CUIDADOS no tiene grupo_dx y no se abre automáticamente.
      // Si llegara a aparecer aquí (por configuración manual futura), se puede abrir.
      // No requiere lógica especial adicional.

      // ── Verificar que no exista paquete que cubra esta fecha_atencion para el paciente
      const { rows: existente } = await client.query(`
        SELECT 1 FROM paquete_paciente
        WHERE id_paquete  = $1
          AND id_paciente = $2
          AND $3::DATE >= fecha_inicio
          AND $3::DATE <= fecha_limite
        LIMIT 1
      `, [id_paquete, id_paciente, fechaInicio]);

      if (existente.length > 0) continue;

      // ── Crear el paquete ────────────────────────────────────────────────────
      const plazoMeses = def.plazo_meses || 8;

      await client.query(`
        INSERT INTO paquete_paciente
          (id_paquete, id_paciente, fecha_inicio, fecha_limite, estado,
           dx_principal, tipo_diagnostico_dx, valor_lab_dx)
        VALUES
          ($1, $2, $3, $3::DATE + ($4 || ' months')::INTERVAL, 'abierto', $5, $6, $7)
        ON CONFLICT (id_paquete, id_paciente, fecha_inicio) DO NOTHING
      `, [id_paquete, id_paciente, fechaInicio, plazoMeses, codigo_item, tipo_diagnostico, valor_lab]);

      contadores.nuevosAbiertos++;

    } catch (err) {
      contadores.errores++;
      console.error(`  ✖ Error abriendo paquete para paciente ${cand.id_paciente}: ${err.message}`);
    }
  }

  console.log(`  Paquetes nuevos abiertos: ${contadores.nuevosAbiertos}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// PASO 2 — CÁLCULO DE AVANCE
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Para cada paquete abierto, calcula cuántas atenciones tiene el paciente
 * por cada componente y determina si está cumplido.
 *
 * Nota: PF_CONTINUIDAD_CUIDADOS no tiene componentes definidos, por lo que
 * nunca alcanza todosCumplidos = true (cierre manual desde la interfaz).
 *
 * Retorna un Map:  paquete_paciente.id → { componentes, todosCumplidos, maxFecha }
 */
async function paso2_calcularAvance(client) {
  console.log('\n── PASO 2: Cálculo de avance ─────────────────────────────────');

  // 2a. Obtener todos los paquetes abiertos
  const { rows: paquetesAbiertos } = await client.query(`
    SELECT id, id_paquete, id_paciente, fecha_inicio, fecha_limite
    FROM paquete_paciente
    WHERE estado = 'abierto'
  `);

  contadores.paquetesAbiertosEncontrados = paquetesAbiertos.length;
  console.log(`  Paquetes abiertos: ${paquetesAbiertos.length}`);

  // 2b. Pre-cargar los componentes y sus códigos válidos por paquete
  const { rows: detalleRows } = await client.query(`
    SELECT pd.id_paquete, pd.tipo_componente, pd.cantidad_minima, pd.usar_prefijo,
           ARRAY_AGG(pdc.codigo_item) AS codigos
    FROM paquete_detalle pd
    JOIN paquete_detalle_codigos pdc
      ON  pd.id_paquete       = pdc.id_paquete
      AND pd.tipo_componente  = pdc.tipo_componente
    GROUP BY pd.id_paquete, pd.tipo_componente, pd.cantidad_minima, pd.usar_prefijo
  `);

  // Organizar: { id_paquete: [{ tipo_componente, cantidad_minima, usar_prefijo, codigos[] }] }
  const componentesPorPaquete = {};
  for (const r of detalleRows) {
    if (!componentesPorPaquete[r.id_paquete]) componentesPorPaquete[r.id_paquete] = [];
    componentesPorPaquete[r.id_paquete].push({
      tipo_componente: r.tipo_componente,
      cantidad_minima: r.cantidad_minima,
      usar_prefijo: r.usar_prefijo,
      codigos: r.codigos,
    });
  }

  // 2c. Calcular avance por cada paquete abierto
  const resultados = new Map();

  for (const paq of paquetesAbiertos) {
    try {
      const componentes = componentesPorPaquete[paq.id_paquete] || [];
      let todosCumplidos = true;
      let maxFecha = null;
      const detalle = [];

      // PF_CONTINUIDAD_CUIDADOS (y cualquier paquete sin componentes) no
      // puede completarse automáticamente.
      if (componentes.length === 0) {
        todosCumplidos = false;
        resultados.set(paq.id, {
          id_paquete: paq.id_paquete,
          id_paciente: paq.id_paciente,
          fecha_limite: paq.fecha_limite,
          componentes: [],
          todosCumplidos: false,
          maxFecha: null,
        });
        continue;
      }

      for (const comp of componentes) {
        // Contar atenciones que cumplen para este componente.
        // Si usar_prefijo = TRUE se comparan los primeros 5 caracteres del código
        // (captura 99207, 99207.1..9 y 97537, 97537.01 etc.)
        let conteoRows;
        if (comp.usar_prefijo) {
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
        const ultima_fecha = conteoRows[0].ultima_fecha;
        const cumplido = cantidad_realizada >= comp.cantidad_minima;

        if (!cumplido) todosCumplidos = false;
        if (ultima_fecha && (!maxFecha || ultima_fecha > maxFecha)) {
          maxFecha = ultima_fecha;
        }

        detalle.push({
          tipo_componente: comp.tipo_componente,
          cantidad_minima: comp.cantidad_minima,
          cantidad_realizada,
          cumplido,
        });
      }

      resultados.set(paq.id, {
        id_paquete: paq.id_paquete,
        id_paciente: paq.id_paciente,
        fecha_limite: paq.fecha_limite,
        componentes: detalle,
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

/**
 * Cambia el estado de los paquetes:
 *   - Todos los componentes cumplidos → 'completado' + fecha_cierre
 *   - Fecha límite superada + algún componente pendiente → 'vencido'
 *   - Paquetes sin componentes (PF_CONTINUIDAD_CUIDADOS) → solo pueden vencer,
 *     nunca se marcan como 'completado' automáticamente.
 */
async function paso3_actualizarEstados(client, resultados) {
  console.log('\n── PASO 3: Actualización de estados ──────────────────────────');

  const hoy = new Date();

  for (const [ppId, info] of resultados) {
    try {
      if (info.todosCumplidos) {
        // ── COMPLETADO ──
        await client.query(`
          UPDATE paquete_paciente
          SET estado       = 'completado',
              fecha_cierre = $2
          WHERE id = $1
            AND estado = 'abierto'
        `, [ppId, info.maxFecha]);

        contadores.pasaronCompletado++;

      } else if (hoy > new Date(info.fecha_limite)) {
        // ── VENCIDO ──
        // Aplica también a PF_CONTINUIDAD_CUIDADOS si supera el plazo sin cierre manual.
        await client.query(`
          UPDATE paquete_paciente
          SET estado = 'vencido'
          WHERE id = $1
            AND estado = 'abierto'
        `, [ppId]);

        contadores.pasaronVencido++;
      }
      // Si sigue abierto y dentro del plazo: no se toca.
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

/**
 * Ejecuta el ciclo completo de cálculo de paquetes terapéuticos.
 *
 * @param {number} [anio] - Año del periodo cargado (informativo para logs).
 * @param {number} [mes]  - Mes del periodo cargado (informativo para logs).
 */
async function calcularPaquetes(anio, mes) {
  resetContadores();

  const periodo = (anio && mes)
    ? `${anio}-${String(mes).padStart(2, '0')}`
    : 'todos';

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║         MOTOR DE CÁLCULO DE PAQUETES PP 0131  v2           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Periodo de referencia : ${periodo}`);
  console.log(`  Apertura de paquetes  : diagnósticos PRESUNTIVOS (P) y DEFINITIVOS (D)`);

  const client = await pool.connect();

  try {
    // ── PASO 1: Apertura ──
    await client.query('BEGIN');
    await paso1_abrirPaquetes(client);
    await client.query('COMMIT');

    // ── PASO 2: Avance ──
    await client.query('BEGIN');
    const resultados = await paso2_calcularAvance(client);
    await client.query('COMMIT');

    // ── PASO 3: Estados ──
    await client.query('BEGIN');
    await paso3_actualizarEstados(client, resultados);
    await client.query('COMMIT');

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // ── Resumen final ──
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

// ── Exportar ─────────────────────────────────────────────────────────────────
module.exports = { calcularPaquetes };

// ── Ejecución directa desde CLI ──────────────────────────────────────────────
// node src/paquetes/calcularPaquetes.js
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