/**
 * resumenAvance.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Funciones de consulta (solo lectura) para la API del sistema PP 0131.
 *
 * Exporta:
 *   getAvancePaquete(idPaquetePaciente)
 *   getProximosAVencer(diasLimite)
 *   getDashboard()
 *   getPaquetesPorPaciente(idPaciente)
 *   getPaquetesPorProfesional(idPersonal)
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  client_encoding: 'utf8',
});
pool.on('error', (err) => console.error('⚠️  Pool error:', err.message));

const DIAS_PROXIMO_VENCER = parseInt(process.env.DIAS_PROXIMO_VENCER, 10) || 30;

// ─────────────────────────────────────────────────────────────────────────────
// HELPER INTERNO — calcularAvanceComponentes
// ─────────────────────────────────────────────────────────────────────────────
/**
 * ✅ FIX: reemplaza la subconsulta con ANY(ARRAY_AGG(...)) que era SQL inválido.
 * Usa un LEFT JOIN directo para contar atenciones por componente.
 *
 * Devuelve array con { tipo_componente, cantidad_minima, cantidad_realizada, cumplido }
 */
async function calcularAvanceComponentes(idPaquete, idPaciente, fechaInicio, fechaLimite) {
  const { rows } = await pool.query(`
    SELECT
      pdet.tipo_componente,
      pdet.cantidad_minima,
      pdet.usar_prefijo,
      -- Con usar_prefijo=TRUE el JOIN ya filtra por prefijo; con FALSE por código exacto.
      -- DISTINCT evita doble-conteo cuando hay varios pdc.codigo_item con el mismo prefijo.
      COUNT(DISTINCT (a.id_cita, a.id_correlativo))::INT AS cantidad_realizada
    FROM paquete_detalle pdet
    JOIN paquete_detalle_codigos pdc
      ON  pdc.id_paquete      = pdet.id_paquete
      AND pdc.tipo_componente = pdet.tipo_componente
    LEFT JOIN atencion a
      ON  (
            (NOT pdet.usar_prefijo AND a.codigo_item = pdc.codigo_item)
            OR
            (pdet.usar_prefijo    AND LEFT(a.codigo_item, 5) = LEFT(pdc.codigo_item, 5))
          )
      AND a.id_paciente     = $1
      AND a.fecha_atencion >= $2
      AND a.fecha_atencion <= $3
    WHERE pdet.id_paquete = $4
    GROUP BY pdet.tipo_componente, pdet.cantidad_minima, pdet.usar_prefijo
  `, [idPaciente, fechaInicio, fechaLimite, idPaquete]);

  return rows.map(r => ({
    tipo_componente:   r.tipo_componente,
    cantidad_minima:   r.cantidad_minima,
    usar_prefijo:      r.usar_prefijo,
    cantidad_realizada: r.cantidad_realizada ?? 0,
    cumplido: (r.cantidad_realizada ?? 0) >= r.cantidad_minima,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER INTERNO — calcPorcentaje
// ─────────────────────────────────────────────────────────────────────────────
function calcPorcentaje(componentes) {
  if (!componentes.length) return 0;
  const cumplidos = componentes.filter(c => c.cumplido).length;
  return Math.round((cumplidos / componentes.length) * 100);
}

// ═════════════════════════════════════════════════════════════════════════════
// FUNCIÓN 1 — getAvancePaquete
// ═════════════════════════════════════════════════════════════════════════════

async function getAvancePaquete(idPaquetePaciente) {
  const { rows: ppRows } = await pool.query(`
    SELECT
      pp.*,
      pd.nombre      AS nombre_paquete,
      pd.plazo_meses,
      p.id_paciente,
      p.numero_documento AS dni,
      p.apellido_paterno,
      p.apellido_materno,
      p.nombres,
      p.fecha_nacimiento,
      p.historia_clinica
    FROM paquete_paciente pp
    JOIN paquete_definicion pd ON pd.id_paquete = pp.id_paquete
    JOIN paciente p            ON p.id_paciente = pp.id_paciente
    WHERE pp.id = $1
  `, [idPaquetePaciente]);

  if (!ppRows.length) return null;
  const pp = ppRows[0];

  const nombreCompleto = [pp.apellido_paterno, pp.apellido_materno, pp.nombres]
    .filter(Boolean).join(' ');

  // ── Componentes con sus códigos válidos ──
  const { rows: compRows } = await pool.query(`
    SELECT
      pdet.tipo_componente,
      pdet.cantidad_minima,
      ARRAY_AGG(pdc.codigo_item) AS codigos_validos
    FROM paquete_detalle pdet
    JOIN paquete_detalle_codigos pdc
      ON  pdet.id_paquete      = pdc.id_paquete
      AND pdet.tipo_componente = pdc.tipo_componente
    WHERE pdet.id_paquete = $1
    GROUP BY pdet.tipo_componente, pdet.cantidad_minima
  `, [pp.id_paquete]);

  // ✅ FIX: usar helper con JOIN válido en lugar de ANY(ARRAY_AGG(...))
  const avanceComp = await calcularAvanceComponentes(
    pp.id_paquete, pp.id_paciente, pp.fecha_inicio, pp.fecha_limite
  );

  // Enriquecer componentes con atenciones individuales
  const componentes = [];
  for (const comp of avanceComp) {
    const compDef = compRows.find(c => c.tipo_componente === comp.tipo_componente);
    const codigos = compDef?.codigos_validos ?? [];

    // La consulta de detalle de atenciones respeta la misma lógica de coincidencia
    // (exacta o por prefijo) que usa calcularAvanceComponentes.
    let atenciones;
    if (comp.usar_prefijo && codigos.length > 0) {
      const prefijo = codigos[0].substring(0, 5);
      const { rows } = await pool.query(`
        SELECT
          a.id_cita,
          a.id_correlativo,
          a.fecha_atencion,
          a.codigo_item,
          a.tipo_diagnostico,
          a.valor_lab,
          CONCAT(pr.apellido_paterno, ' ', pr.apellido_materno, ' ', pr.nombres) AS nombre_profesional,
          a.id_turno
        FROM atencion a
        LEFT JOIN profesional pr ON pr.id_personal = a.id_personal
        WHERE a.id_paciente          = $1
          AND a.fecha_atencion      >= $2
          AND a.fecha_atencion      <= $3
          AND LEFT(a.codigo_item, 5) = $4
        ORDER BY a.fecha_atencion ASC, a.id_correlativo ASC
      `, [pp.id_paciente, pp.fecha_inicio, pp.fecha_limite, prefijo]);
      atenciones = rows;
    } else {
      const { rows } = await pool.query(`
        SELECT
          a.id_cita,
          a.id_correlativo,
          a.fecha_atencion,
          a.codigo_item,
          a.tipo_diagnostico,
          a.valor_lab,
          CONCAT(pr.apellido_paterno, ' ', pr.apellido_materno, ' ', pr.nombres) AS nombre_profesional,
          a.id_turno
        FROM atencion a
        LEFT JOIN profesional pr ON pr.id_personal = a.id_personal
        WHERE a.id_paciente     = $1
          AND a.fecha_atencion >= $2
          AND a.fecha_atencion <= $3
          AND a.codigo_item     = ANY($4)
        ORDER BY a.fecha_atencion ASC, a.id_correlativo ASC
      `, [pp.id_paciente, pp.fecha_inicio, pp.fecha_limite, codigos]);
      atenciones = rows;
    }

    componentes.push({
      tipo_componente:    comp.tipo_componente,
      cantidad_minima:    comp.cantidad_minima,
      cantidad_realizada: comp.cantidad_realizada,
      pendiente:          Math.max(0, comp.cantidad_minima - comp.cantidad_realizada),
      cumplido:           comp.cumplido,
      usar_prefijo:       comp.usar_prefijo,
      codigos_validos:    codigos,
      atenciones,
    });
  }

  const porcentaje_avance = calcPorcentaje(avanceComp);

  // ── Timeline completa ──
  const { rows: timeline } = await pool.query(`
    SELECT
      a.id_cita,
      a.id_correlativo,
      a.fecha_atencion,
      a.codigo_item,
      a.tipo_diagnostico,
      a.valor_lab,
      CONCAT(pr.apellido_paterno, ' ', pr.apellido_materno, ' ', pr.nombres) AS nombre_profesional,
      a.id_turno
    FROM atencion a
    LEFT JOIN profesional pr ON pr.id_personal = a.id_personal
    WHERE a.id_paciente     = $1
      AND a.fecha_atencion >= $2
      AND a.fecha_atencion <= $3
    ORDER BY a.id_cita ASC, a.id_correlativo ASC
  `, [pp.id_paciente, pp.fecha_inicio, pp.fecha_limite]);

  return {
    paquete_paciente: {
      id:                  pp.id,
      id_paquete:          pp.id_paquete,
      nombre_paquete:      pp.nombre_paquete,
      id_paciente:         pp.id_paciente,
      fecha_inicio:        pp.fecha_inicio,
      fecha_limite:        pp.fecha_limite,
      estado:              pp.estado,
      fecha_cierre:        pp.fecha_cierre,
      dx_principal:        pp.dx_principal,
      tipo_diagnostico_dx: pp.tipo_diagnostico_dx,  // P / D / R del Dx que abrió el paquete
      valor_lab_dx:        pp.valor_lab_dx,          // valor_lab de ese Dx
      observaciones:       pp.observaciones,
    },
    paciente: {
      nombre_completo:  nombreCompleto,
      dni:              pp.dni,
      fecha_nacimiento: pp.fecha_nacimiento,
      historia_clinica: pp.historia_clinica,
    },
    componentes,
    porcentaje_avance,
    timeline,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// FUNCIÓN 2 — getProximosAVencer
// ═════════════════════════════════════════════════════════════════════════════

async function getProximosAVencer(diasLimite) {
  const dias = diasLimite ?? DIAS_PROXIMO_VENCER;

  const { rows: paquetes } = await pool.query(`
    SELECT
      pp.id,
      pp.id_paquete,
      pd.nombre AS nombre_paquete,
      CONCAT(p.apellido_paterno, ' ', p.apellido_materno, ' ', p.nombres) AS nombre_paciente,
      p.numero_documento AS dni,
      EXTRACT(YEAR FROM AGE(CURRENT_DATE, p.fecha_nacimiento))::INT AS edad,
      pp.fecha_inicio,
      pp.fecha_limite,
      (pp.fecha_limite - CURRENT_DATE)::INT AS dias_restantes,
      pp.id_paciente
    FROM paquete_paciente pp
    JOIN paquete_definicion pd ON pd.id_paquete = pp.id_paquete
    JOIN paciente p            ON p.id_paciente = pp.id_paciente
    WHERE pp.estado = 'abierto'
      AND (pp.fecha_limite - CURRENT_DATE) BETWEEN 0 AND $1
    ORDER BY (pp.fecha_limite - CURRENT_DATE) ASC
  `, [dias]);

  // ✅ FIX: usar helper con JOIN válido para calcular avance
  const resultado = [];
  for (const paq of paquetes) {
    const avance = await calcularAvanceComponentes(
      paq.id_paquete, paq.id_paciente, paq.fecha_inicio, paq.fecha_limite
    );
    const cumplidos  = avance.filter(c => c.cumplido).length;
    const porcentaje = calcPorcentaje(avance);

    resultado.push({
      id:                     paq.id,
      id_paquete:             paq.id_paquete,
      nombre_paquete:         paq.nombre_paquete,
      nombre_paciente:        paq.nombre_paciente,
      dni:                    paq.dni,
      edad:                   paq.edad ?? null,
      fecha_inicio:           paq.fecha_inicio,
      fecha_limite:           paq.fecha_limite,
      // ✅ FIX: castear a INT en SQL y garantizar número aquí también
      dias_restantes:         parseInt(paq.dias_restantes, 10) || 0,
      porcentaje_avance:      porcentaje,
      componentes_pendientes: avance.length - cumplidos,
    });
  }

  return resultado;
}

// ═════════════════════════════════════════════════════════════════════════════
// FUNCIÓN 3 — getDashboard
// ═════════════════════════════════════════════════════════════════════════════

function getMetaDashboard(nombre) {
  if (!nombre) return 100;
  const n = nombre.toLowerCase();
  if (n.includes('maltrato infantil')) return 200;
  if (n.includes('niños') && n.includes('violencia sexual')) return 10;
  if (n.includes('violencia sexual')) return 10;
  if (n.includes('violencia')) return 155;
  if (n.includes('autista')) return 10;
  if (n.includes('comportamiento')) return 240;
  if (n.includes('depresi')) return 210;
  if (n.includes('suicida')) return 10;
  if (n.includes('ansiedad')) return 300;
  if (n.includes('motivacional')) return 108;
  if (n.includes('dependencia')) return 45;
  if (n.includes('alcohol')) return 45;
  if (n.includes('esquizofrenia')) return 40;
  if (n.includes('mental grave')) return 50;
  if (n.includes('primer episodio')) return 40;
  if (n.includes('deterioro cognitivo')) return 50;
  if (n.includes('laboral')) return 50;
  if (n.includes('psicosocial')) return 45;
  return 100;
}

async function getDashboard(anio) {
  const whereGlobal = anio && anio !== 'todos'
    ? 'WHERE EXTRACT(YEAR FROM fecha_inicio) = $2'
    : '';
  const filterParams = anio && anio !== 'todos' 
    ? [DIAS_PROXIMO_VENCER, parseInt(anio, 10)] 
    : [DIAS_PROXIMO_VENCER];

  const { rows: totalesRows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE estado = 'abierto')     AS abiertos,
      COUNT(*) FILTER (WHERE estado = 'completado')  AS completados,
      COUNT(*) FILTER (WHERE estado = 'vencido')     AS vencidos,
      COUNT(*) FILTER (
        WHERE estado = 'abierto'
          AND (fecha_limite - CURRENT_DATE) BETWEEN 0 AND $1
      ) AS proximos_a_vencer
    FROM paquete_paciente
    ${whereGlobal}
  `, filterParams);

  const t = totalesRows[0];
  const paquetesAbiertos   = parseInt(t.abiertos,           10) || 0;
  const completados        = parseInt(t.completados,        10) || 0;
  const vencidos           = parseInt(t.vencidos,           10) || 0;
  const proximosAVencer    = parseInt(t.proximos_a_vencer,  10) || 0;

  // ── Distribución por tipo ──
  const joinWhere = anio && anio !== 'todos' ? `AND EXTRACT(YEAR FROM pp.fecha_inicio) = $1` : '';
  const porTipoParams = anio && anio !== 'todos' ? [parseInt(anio, 10)] : [];

  const { rows: porTipo } = await pool.query(`
    SELECT
      pd.id_paquete,
      pd.nombre,
      COUNT(*) FILTER (WHERE pp.estado = 'abierto')    AS abiertos,
      COUNT(*) FILTER (WHERE pp.estado = 'completado') AS completados,
      COUNT(*) FILTER (WHERE pp.estado = 'vencido')    AS vencidos
    FROM paquete_definicion pd
    LEFT JOIN paquete_paciente pp ON pp.id_paquete = pd.id_paquete ${joinWhere}
    GROUP BY pd.id_paquete, pd.nombre
    ORDER BY pd.nombre
  `, porTipoParams);

  const distribucion = porTipo.map(r => ({
    id_paquete:  r.id_paquete,
    nombre:      r.nombre,
    abiertos:    parseInt(r.abiertos,    10) || 0,
    completados: parseInt(r.completados, 10) || 0,
    vencidos:    parseInt(r.vencidos,    10) || 0,
  }));

  const totalCerrados = completados + vencidos;
  const meta_pp0131   = totalCerrados > 0
    ? Math.round((completados / totalCerrados) * 100)
    : 0;

  // ── Avance de paquetes por mes ──
  const { rows: mesesRows } = await pool.query(`
    SELECT
      pd.id_paquete,
      pd.nombre AS nombre_paquete,
      act.codigo AS act_codigo,
      act.nombre AS act_nombre,
      EXTRACT(MONTH FROM pp.fecha_inicio)::INT AS mes,
      COUNT(pp.id)::INT as cantidad
    FROM paquete_definicion pd
    LEFT JOIN actividad act ON act.id_actividad = pd.id_actividad
    LEFT JOIN paquete_paciente pp ON pp.id_paquete = pd.id_paquete ${joinWhere}
    GROUP BY pd.id_paquete, pd.nombre, act.codigo, act.nombre, EXTRACT(MONTH FROM pp.fecha_inicio)
    ORDER BY act.codigo, pd.nombre, mes
  `, porTipoParams);

  const paquetesMap = {};
  for (const r of mesesRows) {
    if (!paquetesMap[r.id_paquete]) {
      paquetesMap[r.id_paquete] = {
        id_paquete: r.id_paquete,
        nombre_paquete: r.nombre_paquete,
        act_codigo: r.act_codigo,
        act_nombre: r.act_nombre,
        meta: getMetaDashboard(r.nombre_paquete),
        meses: new Array(12).fill(0),
        total_acumulado: 0
      };
    }
    if (r.mes >= 1 && r.mes <= 12 && r.cantidad > 0) {
      paquetesMap[r.id_paquete].meses[r.mes - 1] += r.cantidad;
      paquetesMap[r.id_paquete].total_acumulado += r.cantidad;
    }
  }
  const paquetes = Object.values(paquetesMap);

  return {
    paquetesAbiertos,
    completados,
    vencidos,
    proximosAVencer,
    distribucion,
    paquetes,
    meta_pp0131,
    totales: { abiertos: paquetesAbiertos, completados, vencidos, proximos_a_vencer: proximosAVencer },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// FUNCIÓN 4 — getPaquetesPorPaciente
// ═════════════════════════════════════════════════════════════════════════════

async function getPaquetesPorPaciente(idPaciente) {
  const { rows: paquetes } = await pool.query(`
    SELECT
      pp.id,
      pp.id_paquete,
      pd.nombre AS nombre_paquete,
      pp.fecha_inicio,
      pp.fecha_limite,
      pp.estado,
      pp.fecha_cierre,
      pp.dx_principal,
      pp.observaciones
    FROM paquete_paciente pp
    JOIN paquete_definicion pd ON pd.id_paquete = pp.id_paquete
    WHERE pp.id_paciente = $1
    ORDER BY pp.fecha_inicio DESC
  `, [idPaciente]);

  if (!paquetes.length) return [];

  // ✅ FIX: usar helper con JOIN válido
  const resultado = [];
  for (const paq of paquetes) {
    const avance     = await calcularAvanceComponentes(paq.id_paquete, idPaciente, paq.fecha_inicio, paq.fecha_limite);
    const porcentaje = calcPorcentaje(avance);
    resultado.push({
      ...paq,
      porcentaje_avance:      porcentaje,
      componentes_pendientes: avance.filter(c => !c.cumplido).length,
      componentes_total:      avance.length,
    });
  }

  return resultado;
}

// ═════════════════════════════════════════════════════════════════════════════
// FUNCIÓN 5 — getPaquetesPorProfesional
// ═════════════════════════════════════════════════════════════════════════════

async function getPaquetesPorProfesional(idPersonal) {
  const { rows: paquetes } = await pool.query(`
    SELECT DISTINCT
      pp.id,
      pp.id_paquete,
      pd.nombre AS nombre_paquete,
      pp.id_paciente,
      CONCAT(p.apellido_paterno, ' ', p.apellido_materno, ' ', p.nombres) AS nombre_paciente,
      p.numero_documento AS dni,
      pp.fecha_inicio,
      pp.fecha_limite,
      pp.estado
    FROM paquete_paciente pp
    JOIN paquete_definicion pd ON pd.id_paquete = pp.id_paquete
    JOIN paciente p            ON p.id_paciente = pp.id_paciente
    JOIN atencion a            ON a.id_paciente    = pp.id_paciente
                              AND a.id_personal    = $1
                              AND a.fecha_atencion >= pp.fecha_inicio
                              AND a.fecha_atencion <= pp.fecha_limite
    ORDER BY pp.fecha_inicio DESC
  `, [idPersonal]);

  if (!paquetes.length) return [];

  const resultado = [];
  for (const paq of paquetes) {
    // ✅ FIX: usar helper con JOIN válido para el avance general
    const avance     = await calcularAvanceComponentes(paq.id_paquete, paq.id_paciente, paq.fecha_inicio, paq.fecha_limite);
    const porcentaje = calcPorcentaje(avance);

    // Componentes donde este profesional contribuyó
    const { rows: contribuciones } = await pool.query(`
      SELECT DISTINCT pdet.tipo_componente
      FROM atencion a
      JOIN paquete_detalle_codigos pdc
        ON  pdc.codigo_item     = a.codigo_item
        AND pdc.id_paquete      = $3
      JOIN paquete_detalle pdet
        ON  pdet.id_paquete      = pdc.id_paquete
        AND pdet.tipo_componente = pdc.tipo_componente
      WHERE a.id_paciente     = $1
        AND a.id_personal     = $2
        AND a.fecha_atencion >= $4
        AND a.fecha_atencion <= $5
    `, [paq.id_paciente, idPersonal, paq.id_paquete, paq.fecha_inicio, paq.fecha_limite]);

    resultado.push({
      id:                    paq.id,
      id_paquete:            paq.id_paquete,
      nombre_paquete:        paq.nombre_paquete,
      id_paciente:           paq.id_paciente,
      nombre_paciente:       paq.nombre_paciente,
      dni:                   paq.dni,
      fecha_inicio:          paq.fecha_inicio,
      fecha_limite:          paq.fecha_limite,
      estado:                paq.estado,
      porcentaje_avance:     porcentaje,
      componentes_cubiertos: contribuciones.map(c => c.tipo_componente),
    });
  }

  return resultado;
}

// ═════════════════════════════════════════════════════════════════════════════
// FUNCIÓN 6 — getPaquetesPaginados (Vista General de Paquetes)
// ═════════════════════════════════════════════════════════════════════════════

async function getPaquetesPaginados(filtros = {}) {
  const { estado, periodo, tipo, campoFecha, fechaDesde, fechaHasta, ordenDias, limite = 50, offset = 0 } = filtros;
  
  const condiciones = [];
  const valores     = [];

  if (estado && estado !== 'todos') {
    valores.push(estado);
    condiciones.push(`pp.estado = $${valores.length}`);
  }

  if (tipo && tipo !== 'todos') {
    valores.push(tipo);
    condiciones.push(`pp.id_paquete = $${valores.length}`);
  }

  if (periodo) {
    valores.push(`${periodo}-01`);
    condiciones.push(
      `pp.fecha_inicio >= DATE_TRUNC('month', $${valores.length}::date)
       AND pp.fecha_inicio < DATE_TRUNC('month', $${valores.length}::date) + INTERVAL '1 month'`
    );
  }

  if ((campoFecha === 'fecha_inicio' || campoFecha === 'fecha_limite')) {
    if (fechaDesde) {
       valores.push(fechaDesde);
       condiciones.push(`pp.${campoFecha} >= $${valores.length}::date`);
    }
    if (fechaHasta) {
       valores.push(fechaHasta);
       condiciones.push(`pp.${campoFecha} <= $${valores.length}::date`);
    }
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  
  let orderSql = 'ORDER BY pp.fecha_inicio DESC';
  if (ordenDias === 'asc') orderSql = 'ORDER BY (pp.fecha_limite - CURRENT_DATE) ASC';
  if (ordenDias === 'desc') orderSql = 'ORDER BY (pp.fecha_limite - CURRENT_DATE) DESC';
  
  valores.push(limite);
  const limiteIndex = valores.length;
  valores.push(offset);
  const offsetIndex = valores.length;

  const { rows: paquetes } = await pool.query(
    `SELECT
       pp.id,
       pp.id_paquete,
       pd.nombre                                                            AS nombre_paquete,
       pp.id_paciente,
       CONCAT(p.apellido_paterno, ' ', p.apellido_materno, ' ', p.nombres) AS paciente_nombre,
       p.numero_documento                                                   AS dni,
       pp.estado,
       pp.fecha_inicio,
       pp.fecha_limite,
       pp.fecha_cierre,
       pp.dx_principal,
       (pp.fecha_limite - CURRENT_DATE)::INT                               AS dias_restantes
     FROM paquete_paciente pp
     LEFT JOIN paquete_definicion pd ON pd.id_paquete  = pp.id_paquete
     LEFT JOIN paciente           p  ON p.id_paciente  = pp.id_paciente
     ${where}
     ${orderSql}
     LIMIT $${limiteIndex} OFFSET $${offsetIndex}`,
    valores
  );

  if (!paquetes.length) return [];

  const resultado = [];
  for (const paq of paquetes) {
    // Calculamos el avance dinámicamente
    const avance     = await calcularAvanceComponentes(paq.id_paquete, paq.id_paciente, paq.fecha_inicio, paq.fecha_limite);
    const porcentaje = calcPorcentaje(avance);
    
    // Si el porcentaje llega al 100% y todos están cumplidos, actualizamos en BD y en respuesta
    let estadoReal = paq.estado;
    const todosCumplidos = avance.length > 0 && avance.every(c => c.cumplido);
    
    if (estadoReal === 'abierto' && todosCumplidos) {
        estadoReal = 'completado';
        // Persistir el cambio en la base de datos para mantener consistencia
        try {
          await pool.query(
            `UPDATE paquete_paciente SET estado = 'completado', fecha_cierre = CURRENT_DATE WHERE id = $1 AND estado = 'abierto'`,
            [paq.id]
          );
        } catch (e) {
          console.error(`  ⚠ Error al actualizar estado a completado para paquete ${paq.id}: ${e.message}`);
        }
    }

    resultado.push({
      ...paq,
      estado: estadoReal,
      porcentaje_avance: porcentaje,
    });
  }

  return resultado;
}

// ── Exportar ──────────────────────────────────────────────────────────────────
module.exports = {
  getAvancePaquete,
  getProximosAVencer,
  getDashboard,
  getPaquetesPorPaciente,
  getPaquetesPorProfesional,
  getPaquetesPaginados,
};