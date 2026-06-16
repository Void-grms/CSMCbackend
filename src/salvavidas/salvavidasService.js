/**
 * salvavidasService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Consultas (solo lectura) del módulo "Salvavidas".
 *
 * Objetivo: rescatar paquetes que vencen en el año en curso.
 *   • SALVABLES  → paquetes ABIERTOS cercanos a completarse (pocas atenciones
 *                  pendientes). Se muestra qué componente le falta a cada paciente.
 *   • CORREGIBLES→ paquetes VENCIDOS no completados que tienen al menos una
 *                  atención "no aprovechada" (un código que no cuenta para ningún
 *                  componente) junto a un componente que quedó corto. Sirve para
 *                  señalar dónde el profesional pudo haberse confundido de código.
 *
 * No modifica datos. La corrección real se hace en el HIS y se reimporta.
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const { Pool } = require('pg');
const { calcularAvanceComponentes } = require('../paquetes/resumenAvance');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  client_encoding: 'utf8',
});
pool.on('error', (err) => console.error('⚠️  Pool salvavidas:', err.message));

// ─────────────────────────────────────────────────────────────────────────────
// SALVABLES (paquetes abiertos cercanos a completarse)
// ─────────────────────────────────────────────────────────────────────────────
// CTE compartido por el listado y el conteo. Calcula, por cada paquete_paciente
// abierto que vence en el año $1, las atenciones pendientes por componente.
//   $1 = año (int)   $2 = id_paquete (text | NULL = todos)
const CTE_SALVABLES = `
  WITH abiertos AS (
    SELECT pp.id, pp.id_paquete, pp.id_paciente, pp.fecha_inicio, pp.fecha_limite
    FROM paquete_paciente pp
    WHERE pp.estado = 'abierto'
      AND EXTRACT(YEAR FROM pp.fecha_limite) = $1
      AND ($2::text IS NULL OR pp.id_paquete = $2)
  ),
  avance AS (
    SELECT ab.id AS pp_id, ab.id_paquete, ab.id_paciente,
           ab.fecha_inicio, ab.fecha_limite,
           pdet.tipo_componente, pdet.cantidad_minima,
           COUNT(DISTINCT
             CASE WHEN a.id_cita IS NOT NULL
                  THEN a.id_cita::text || '-' || a.id_correlativo::text END
           )::int AS realizada
    FROM abiertos ab
    JOIN paquete_detalle pdet ON pdet.id_paquete = ab.id_paquete
    JOIN paquete_detalle_codigos pdc
      ON  pdc.id_paquete      = pdet.id_paquete
      AND pdc.tipo_componente = pdet.tipo_componente
    LEFT JOIN atencion a
      ON  (
            (NOT pdet.usar_prefijo AND a.codigo_item = pdc.codigo_item)
            OR
            (pdet.usar_prefijo    AND LEFT(a.codigo_item, 5) = LEFT(pdc.codigo_item, 5))
          )
      AND a.id_paciente     = ab.id_paciente
      AND a.fecha_atencion >= ab.fecha_inicio
      AND a.fecha_atencion <= ab.fecha_limite
    GROUP BY ab.id, ab.id_paquete, ab.id_paciente, ab.fecha_inicio, ab.fecha_limite,
             pdet.tipo_componente, pdet.cantidad_minima
  ),
  pend AS (
    SELECT pp_id, id_paquete, id_paciente, fecha_inicio, fecha_limite,
           SUM(GREATEST(0, cantidad_minima - realizada))::int AS pendientes,
           COALESCE(
             json_agg(
               json_build_object('tipo_componente', tipo_componente,
                                 'falta', GREATEST(0, cantidad_minima - realizada))
               ORDER BY tipo_componente
             ) FILTER (WHERE cantidad_minima - realizada > 0),
             '[]'
           ) AS faltantes
    FROM avance
    GROUP BY pp_id, id_paquete, id_paciente, fecha_inicio, fecha_limite
  )
`;

/**
 * Lista los paquetes abiertos cercanos a completarse de un paquete (o de todos
 * si idPaquete es null), con ≤ umbral atenciones pendientes en total.
 */
async function listarSalvables(idPaquete, anio, umbral) {
  const { rows } = await pool.query(`
    ${CTE_SALVABLES}
    SELECT
      pend.pp_id            AS id,
      pend.id_paquete,
      pend.id_paciente,
      pend.fecha_inicio,
      pend.fecha_limite,
      (pend.fecha_limite - CURRENT_DATE) AS dias_restantes,
      pend.pendientes,
      pend.faltantes,
      p.numero_documento    AS dni,
      p.apellido_paterno,
      p.apellido_materno,
      p.nombres
    FROM pend
    JOIN paciente p ON p.id_paciente = pend.id_paciente
    WHERE pend.pendientes BETWEEN 1 AND $3
    ORDER BY pend.pendientes ASC, dias_restantes ASC
  `, [anio, idPaquete, umbral]);

  return rows.map(r => ({
    ...r,
    nombre_paciente: [r.apellido_paterno, r.apellido_materno, r.nombres]
      .filter(Boolean).join(' '),
  }));
}

/** Conteo de salvables por paquete (para los botones). */
async function contarSalvablesPorPaquete(anio, umbral) {
  const { rows } = await pool.query(`
    ${CTE_SALVABLES}
    SELECT id_paquete, COUNT(*)::int AS n
    FROM pend
    WHERE pendientes BETWEEN 1 AND $3
    GROUP BY id_paquete
  `, [anio, null, umbral]);
  const mapa = {};
  for (const r of rows) mapa[r.id_paquete] = r.n;
  return mapa;
}

// ─────────────────────────────────────────────────────────────────────────────
// CORREGIBLES (paquetes vencidos con atención mal codificada)
// ─────────────────────────────────────────────────────────────────────────────

/** Cache de códigos válidos por componente, por id_paquete. */
async function cargarComponentesPaquete(idPaquete, cache) {
  if (cache.has(idPaquete)) return cache.get(idPaquete);
  const { rows } = await pool.query(`
    SELECT pdet.tipo_componente, pdet.cantidad_minima, pdet.usar_prefijo,
           ARRAY_AGG(pdc.codigo_item) AS codigos_validos
    FROM paquete_detalle pdet
    JOIN paquete_detalle_codigos pdc
      ON  pdc.id_paquete      = pdet.id_paquete
      AND pdc.tipo_componente = pdet.tipo_componente
    WHERE pdet.id_paquete = $1
    GROUP BY pdet.tipo_componente, pdet.cantidad_minima, pdet.usar_prefijo
  `, [idPaquete]);
  cache.set(idPaquete, rows);
  return rows;
}

/**
 * Atenciones del paciente dentro del periodo que son procedimientos (no
 * diagnósticos) y cuyo código NO cuenta para ningún componente del paquete.
 */
async function atencionesNoAprovechadas(idPaquete, idPaciente, fechaInicio, fechaLimite) {
  const { rows } = await pool.query(`
    SELECT
      a.id_cita,
      a.id_correlativo,
      a.fecha_atencion,
      a.codigo_item,
      a.id_turno,
      CONCAT_WS(' ', pr.apellido_paterno, pr.apellido_materno, pr.nombres) AS nombre_profesional
    FROM atencion a
    LEFT JOIN profesional pr ON pr.id_personal = a.id_personal
    WHERE a.id_paciente     = $2
      AND a.fecha_atencion >= $3
      AND a.fecha_atencion <= $4
      -- excluir filas de diagnóstico: solo procedimientos
      AND (a.tipo_diagnostico IS NULL OR a.tipo_diagnostico NOT IN ('P', 'D'))
      -- el código no cuenta para ningún componente del paquete
      AND NOT EXISTS (
        SELECT 1
        FROM paquete_detalle pdet
        JOIN paquete_detalle_codigos pdc
          ON  pdc.id_paquete      = pdet.id_paquete
          AND pdc.tipo_componente = pdet.tipo_componente
        WHERE pdet.id_paquete = $1
          AND (
                (NOT pdet.usar_prefijo AND a.codigo_item = pdc.codigo_item)
                OR
                (pdet.usar_prefijo    AND LEFT(a.codigo_item, 5) = LEFT(pdc.codigo_item, 5))
              )
      )
    ORDER BY a.fecha_atencion ASC, a.id_correlativo ASC
  `, [idPaquete, idPaciente, fechaInicio, fechaLimite]);
  return rows;
}

/**
 * Lista los paquetes vencidos (del año) recuperables: tienen al menos un
 * componente faltante y al menos una atención no aprovechada.
 */
async function listarCorregibles(idPaquete, anio) {
  const { rows: vencidos } = await pool.query(`
    SELECT pp.id, pp.id_paquete, pp.id_paciente, pp.fecha_inicio, pp.fecha_limite,
           p.numero_documento AS dni, p.apellido_paterno, p.apellido_materno, p.nombres
    FROM paquete_paciente pp
    JOIN paciente p ON p.id_paciente = pp.id_paciente
    WHERE pp.estado = 'vencido'
      AND EXTRACT(YEAR FROM pp.fecha_limite) = $1
      AND ($2::text IS NULL OR pp.id_paquete = $2)
    ORDER BY pp.id_paquete, pp.fecha_limite
  `, [anio, idPaquete]);

  const cacheComp = new Map();
  const resultado = [];

  for (const v of vencidos) {
    const avance = await calcularAvanceComponentes(
      v.id_paquete, v.id_paciente, v.fecha_inicio, v.fecha_limite
    );
    const defComp = await cargarComponentesPaquete(v.id_paquete, cacheComp);

    // Componentes que quedaron cortos, con sus códigos válidos
    const faltantes = avance
      .filter(c => !c.cumplido)
      .map(c => {
        const def = defComp.find(d => d.tipo_componente === c.tipo_componente);
        return {
          tipo_componente: c.tipo_componente,
          falta:           Math.max(0, c.cantidad_minima - c.cantidad_realizada),
          codigos_validos: def?.codigos_validos ?? [],
        };
      });
    if (faltantes.length === 0) continue;

    const noAprovechadas = await atencionesNoAprovechadas(
      v.id_paquete, v.id_paciente, v.fecha_inicio, v.fecha_limite
    );
    if (noAprovechadas.length === 0) continue;

    resultado.push({
      id:             v.id,
      id_paquete:     v.id_paquete,
      id_paciente:    v.id_paciente,
      fecha_inicio:   v.fecha_inicio,
      fecha_limite:   v.fecha_limite,
      dni:            v.dni,
      nombre_paciente: [v.apellido_paterno, v.apellido_materno, v.nombres]
        .filter(Boolean).join(' '),
      componentes_faltantes: faltantes,
      atenciones_no_aprovechadas: noAprovechadas,
    });
  }

  return resultado;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEOS (para los botones de paquete)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Devuelve un botón por cada paquete del catálogo con el nº de casos salvables
 * y corregibles del año.
 */
async function listarConteos(anio, umbral) {
  const { rows: catalogo } = await pool.query(`
    SELECT id_paquete, nombre FROM paquete_definicion ORDER BY id_paquete
  `);

  const salvables = await contarSalvablesPorPaquete(anio, umbral);

  const corregiblesAll = await listarCorregibles(null, anio);
  const corregibles = {};
  for (const c of corregiblesAll) {
    corregibles[c.id_paquete] = (corregibles[c.id_paquete] || 0) + 1;
  }

  return catalogo.map(p => ({
    id_paquete:  p.id_paquete,
    nombre:      p.nombre,
    salvables:   salvables[p.id_paquete]   || 0,
    corregibles: corregibles[p.id_paquete] || 0,
  }));
}

module.exports = {
  listarConteos,
  listarSalvables,
  listarCorregibles,
};
