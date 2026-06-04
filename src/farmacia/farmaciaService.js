/**
 * farmaciaService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Lógica del módulo Farmacia: seguimiento de la dispensación de medicamentos.
 *
 * El evento de entrega es cada atención con codigo_item = '99199.05'. El estado
 * (al día / próximo / vencido / inactivo) se calcula on-the-fly a partir de la
 * última dispensación de cada paciente, su intervalo (propio o el default global)
 * y la fecha actual. No se materializa ni requiere job; siempre es consistente
 * con la tabla `atencion`.
 *
 * Patrón de referencia: src/paquetes/resumenAvance.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  client_encoding: 'utf8',
});
pool.on('error', (err) => console.error('⚠️  Pool error:', err.message));

// Código que indica una dispensación de medicamentos en el HIS MINSA.
const COD_DISPENSACION = '99199.05';

// ─────────────────────────────────────────────────────────────────────────────
// SQL base — una fila por paciente con ≥1 dispensación, con su estado calculado.
//   $1 = código de dispensación.
// Estados:
//   inactivo : pausado o última entrega fuera de la ventana de relevancia (histórico).
//   vencido  : ya pasó la fecha esperada de la próxima entrega.
//   proximo  : faltan entre 0 y `dias_aviso_previo` días.
//   al_dia   : aún falta más que el aviso previo.
// ─────────────────────────────────────────────────────────────────────────────
const SQL_PACIENTES_ESTADO = `
  WITH cfg AS (
    SELECT intervalo_default_dias, ventana_relevancia_dias, dias_aviso_previo
    FROM farmacia_config_global
    WHERE id = 1
  ),
  disp AS (
    SELECT
      a.id_paciente,
      MAX(a.fecha_atencion) AS ultima_dispensacion,
      MIN(a.fecha_atencion) AS primera_dispensacion,
      COUNT(*)::INT         AS total_dispensaciones
    FROM atencion a
    WHERE a.codigo_item = $1
      AND a.id_paciente IS NOT NULL
    GROUP BY a.id_paciente
  ),
  base AS (
    SELECT
      d.id_paciente,
      CONCAT_WS(' ', p.apellido_paterno, p.apellido_materno, p.nombres) AS nombre_paciente,
      p.numero_documento                                       AS dni,
      d.ultima_dispensacion,
      d.primera_dispensacion,
      d.total_dispensaciones,
      COALESCE(fpc.intervalo_dias, cfg.intervalo_default_dias)  AS intervalo_dias,
      (fpc.intervalo_dias IS NOT NULL)                          AS intervalo_personalizado,
      COALESCE(fpc.activo, TRUE)                                AS activo,
      cfg.ventana_relevancia_dias,
      cfg.dias_aviso_previo,
      (d.ultima_dispensacion
        + (COALESCE(fpc.intervalo_dias, cfg.intervalo_default_dias) * INTERVAL '1 day'))::DATE AS proxima_fecha,
      (CURRENT_DATE - d.ultima_dispensacion)::INT              AS dias_desde_ultima
    FROM disp d
    JOIN paciente p ON p.id_paciente = d.id_paciente
    CROSS JOIN cfg
    LEFT JOIN farmacia_paciente_config fpc ON fpc.id_paciente = d.id_paciente
  )
  SELECT
    b.*,
    (b.proxima_fecha - CURRENT_DATE)::INT AS dias_restantes,
    CASE
      WHEN b.activo = FALSE                                          THEN 'inactivo'
      WHEN b.dias_desde_ultima > b.ventana_relevancia_dias           THEN 'inactivo'
      WHEN (b.proxima_fecha - CURRENT_DATE) < 0                      THEN 'vencido'
      WHEN (b.proxima_fecha - CURRENT_DATE) <= b.dias_aviso_previo   THEN 'proximo'
      ELSE 'al_dia'
    END AS estado
  FROM base b
`;

// Orden de prioridad para mostrar primero lo urgente.
const PRIORIDAD_ESTADO = { vencido: 0, proximo: 1, al_dia: 2, inactivo: 3 };

// ═════════════════════════════════════════════════════════════════════════════
// LECTURA
// ═════════════════════════════════════════════════════════════════════════════

/** Conteos por estado para las tarjetas resumen del módulo. */
async function getResumen() {
  const { rows } = await pool.query(
    `SELECT estado, COUNT(*)::INT AS cantidad
     FROM (${SQL_PACIENTES_ESTADO}) s
     GROUP BY estado`,
    [COD_DISPENSACION]
  );

  const resumen = { total: 0, al_dia: 0, proximo: 0, vencido: 0, inactivo: 0 };
  for (const r of rows) {
    resumen[r.estado] = r.cantidad;
    resumen.total += r.cantidad;
  }
  // "En seguimiento" = pacientes activos dentro de la ventana de relevancia.
  resumen.en_seguimiento = resumen.total - resumen.inactivo;
  return resumen;
}

/**
 * Lista de pacientes con dispensaciones y su estado.
 * @param {object} filtros { estado, q, incluirInactivos }
 */
async function getPacientes({ estado, q, incluirInactivos } = {}) {
  const { rows } = await pool.query(SQL_PACIENTES_ESTADO, [COD_DISPENSACION]);

  let lista = rows;

  if (!incluirInactivos) {
    lista = lista.filter((r) => r.estado !== 'inactivo');
  }
  if (estado && estado !== 'todos') {
    lista = lista.filter((r) => r.estado === estado);
  }
  if (q && q.trim()) {
    const t = q.trim().toLowerCase();
    lista = lista.filter(
      (r) =>
        (r.nombre_paciente || '').toLowerCase().includes(t) ||
        (r.dni || '').toLowerCase().includes(t) ||
        (r.id_paciente || '').toLowerCase().includes(t)
    );
  }

  lista.sort(
    (a, b) =>
      (PRIORIDAD_ESTADO[a.estado] - PRIORIDAD_ESTADO[b.estado]) ||
      (a.dias_restantes - b.dias_restantes)
  );

  return lista;
}

/**
 * Detalle de un paciente: datos, estado actual e historial de entregas (con nota).
 * Devuelve null si el paciente no existe.
 */
async function getPacienteDetalle(idPaciente) {
  const { rows } = await pool.query(
    `SELECT * FROM (${SQL_PACIENTES_ESTADO}) s WHERE s.id_paciente = $2`,
    [COD_DISPENSACION, idPaciente]
  );

  // Datos personales (existan o no dispensaciones).
  const { rows: pac } = await pool.query(
    `SELECT
       id_paciente,
       CONCAT_WS(' ', apellido_paterno, apellido_materno, nombres) AS nombre_paciente,
       numero_documento AS dni,
       fecha_nacimiento,
       historia_clinica
     FROM paciente
     WHERE id_paciente = $1`,
    [idPaciente]
  );
  if (!pac.length) return null;

  // Historial de entregas con su nota manual (si la tiene).
  //   num_dispensacion = valor_lab del registro 99199.05 (la trama del HIS lo
  //     numera por tratamiento y lo reinicia a 1 cuando cambia el diagnóstico).
  //   dx = diagnóstico CIE-10 de la misma cita (correlativo más bajo con código
  //     que empieza por letra; en los datos siempre es el correlativo 1).
  const { rows: historial } = await pool.query(
    `SELECT
       a.id_cita,
       a.id_correlativo,
       a.fecha_atencion,
       a.valor_lab        AS num_dispensacion,
       dxc.codigo_item    AS dx,
       CONCAT_WS(' ', pr.apellido_paterno, pr.apellido_materno, pr.nombres) AS nombre_profesional,
       a.id_turno,
       n.medicamento,
       n.cantidad,
       n.observaciones
     FROM atencion a
     LEFT JOIN profesional pr ON pr.id_personal = a.id_personal
     LEFT JOIN farmacia_dispensacion_nota n
       ON n.id_cita = a.id_cita AND n.id_correlativo = a.id_correlativo
     LEFT JOIN LATERAL (
       SELECT dx.codigo_item
       FROM atencion dx
       WHERE dx.id_cita = a.id_cita
         AND dx.codigo_item ~ '^[A-Za-z]'
       ORDER BY dx.id_correlativo ASC
       LIMIT 1
     ) dxc ON TRUE
     WHERE a.id_paciente = $1 AND a.codigo_item = $2
     ORDER BY a.fecha_atencion DESC, a.id_correlativo DESC`,
    [idPaciente, COD_DISPENSACION]
  );

  const info = rows[0] || null;
  // La última entrega (historial está ordenado por fecha DESC) define el
  // diagnóstico y número de dispensación vigentes del paciente.
  const ultima = historial[0] || null;

  return {
    paciente: pac[0],
    estado: info
      ? {
          estado:               info.estado,
          ultima_dispensacion:  info.ultima_dispensacion,
          primera_dispensacion: info.primera_dispensacion,
          proxima_fecha:        info.proxima_fecha,
          dias_restantes:       info.dias_restantes,
          dias_desde_ultima:    info.dias_desde_ultima,
          total_dispensaciones: info.total_dispensaciones,
          intervalo_dias:       info.intervalo_dias,
          intervalo_personalizado: info.intervalo_personalizado,
          activo:               info.activo,
          dx_actual:            ultima?.dx ?? null,
          num_dispensacion_actual: ultima?.num_dispensacion ?? null,
        }
      : null,
    historial,
  };
}

/** Configuración global (fila única). */
async function getConfigGlobal() {
  const { rows } = await pool.query(
    `SELECT intervalo_default_dias, ventana_relevancia_dias, dias_aviso_previo
     FROM farmacia_config_global WHERE id = 1`
  );
  return rows[0] ?? { intervalo_default_dias: 30, ventana_relevancia_dias: 45, dias_aviso_previo: 5 };
}

// ═════════════════════════════════════════════════════════════════════════════
// ESCRITURA (solo admin desde el router)
// ═════════════════════════════════════════════════════════════════════════════

/** Actualiza la configuración global. Campos null = no se modifican. */
async function actualizarConfigGlobal({ intervalo_default_dias, ventana_relevancia_dias, dias_aviso_previo }) {
  const { rows } = await pool.query(
    `UPDATE farmacia_config_global
     SET intervalo_default_dias  = COALESCE($1, intervalo_default_dias),
         ventana_relevancia_dias = COALESCE($2, ventana_relevancia_dias),
         dias_aviso_previo       = COALESCE($3, dias_aviso_previo)
     WHERE id = 1
     RETURNING intervalo_default_dias, ventana_relevancia_dias, dias_aviso_previo`,
    [intervalo_default_dias ?? null, ventana_relevancia_dias ?? null, dias_aviso_previo ?? null]
  );
  return rows[0];
}

/** Crea o actualiza el intervalo personalizado de un paciente. */
async function setIntervaloPaciente(idPaciente, { intervalo_dias, activo }, usuario) {
  // Validar que el paciente exista (evita filas huérfanas).
  const { rows: pac } = await pool.query(
    `SELECT 1 FROM paciente WHERE id_paciente = $1`,
    [idPaciente]
  );
  if (!pac.length) {
    const err = new Error('Paciente no encontrado.');
    err.status = 404;
    throw err;
  }

  const { rows } = await pool.query(
    `INSERT INTO farmacia_paciente_config
       (id_paciente, intervalo_dias, activo, actualizado_por, actualizado_en)
     VALUES ($1, $2, COALESCE($3, TRUE), $4, CURRENT_TIMESTAMP)
     ON CONFLICT (id_paciente) DO UPDATE SET
       intervalo_dias  = EXCLUDED.intervalo_dias,
       activo          = EXCLUDED.activo,
       actualizado_por = EXCLUDED.actualizado_por,
       actualizado_en  = CURRENT_TIMESTAMP
     RETURNING id_paciente, intervalo_dias, activo`,
    [idPaciente, intervalo_dias, activo, usuario ?? null]
  );
  return rows[0];
}

/** Guarda (o reemplaza) la nota manual de una entrega concreta. */
async function guardarNota(idCita, idCorrelativo, { medicamento, cantidad, observaciones }, usuario) {
  // La nota solo tiene sentido sobre una atención que sea una dispensación.
  const { rows: at } = await pool.query(
    `SELECT 1 FROM atencion
     WHERE id_cita = $1 AND id_correlativo = $2 AND codigo_item = $3`,
    [idCita, idCorrelativo, COD_DISPENSACION]
  );
  if (!at.length) {
    const err = new Error('La atención no existe o no es una dispensación (99199.05).');
    err.status = 404;
    throw err;
  }

  const { rows } = await pool.query(
    `INSERT INTO farmacia_dispensacion_nota
       (id_cita, id_correlativo, medicamento, cantidad, observaciones, creado_por, creado_en)
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
     ON CONFLICT (id_cita, id_correlativo) DO UPDATE SET
       medicamento   = EXCLUDED.medicamento,
       cantidad      = EXCLUDED.cantidad,
       observaciones = EXCLUDED.observaciones,
       creado_por    = EXCLUDED.creado_por,
       creado_en     = CURRENT_TIMESTAMP
     RETURNING id_cita, id_correlativo, medicamento, cantidad, observaciones`,
    [idCita, idCorrelativo, medicamento ?? null, cantidad ?? null, observaciones ?? null, usuario ?? null]
  );
  return rows[0];
}

module.exports = {
  COD_DISPENSACION,
  getResumen,
  getPacientes,
  getPacienteDetalle,
  getConfigGlobal,
  actualizarConfigGlobal,
  setIntervaloPaciente,
  guardarNota,
};
