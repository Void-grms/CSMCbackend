/**
 * verificarCodificacion.js — Verificación de errores de codificación HIS.
 *
 * Audita las citas de INGRESO (usuarios nuevos) de un periodo y comprueba dos
 * reglas de codificación que deben cumplirse en la MISMA cita:
 *
 *   1. El diagnóstico CIE-10 debe estar en DEFINITIVO (tipo_diagnostico = 'D').
 *   2. La cita debe incluir el código PAI 99366.
 *
 * Una cita se considera "nueva" si cualquiera de sus filas tiene
 * id_condicion_servicio = 'N' (marca del HIS). El diagnóstico evaluado es el
 * principal: el primer CIE-10 (codigo_item que empieza con letra) por id_correlativo.
 *
 * Se calcula al vuelo sobre `atencion`, sin materializar nada.
 */

const { Pool } = require('pg');
const {
  MESES, fmtFecha, run, para, celda, filaTabla, tabla, construirDocx,
} = require('./docxBuilder');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  client_encoding: 'utf8',
});

const COD_PAI = '99366';

// Etiqueta legible del tipo de diagnóstico del HIS.
const TIPO_DX_LABEL = { D: 'Definitivo', P: 'Presuntivo', R: 'Repetido' };

/**
 * Obtiene las citas nuevas del periodo con su diagnóstico principal y si tienen
 * el código PAI. Devuelve las filas crudas (sin evaluar reglas todavía).
 */
async function obtenerCitasNuevas(anio, mes) {
  const { rows } = await pool.query(
    `
    WITH citas AS (
      SELECT id_cita,
             bool_or(id_condicion_servicio = 'N') AS es_nueva,
             bool_or(codigo_item = $3)             AS tiene_pai
      FROM atencion
      WHERE anio = $1 AND mes = $2
      GROUP BY id_cita
    ),
    -- Cabecera de la cita (primera fila por correlativo): paciente y fecha.
    -- Se obtiene aquí para que las citas SIN diagnóstico CIE-10 igual muestren
    -- al paciente y la fecha.
    cab AS (
      SELECT DISTINCT ON (a.id_cita)
             a.id_cita, a.id_paciente, a.fecha_atencion
      FROM atencion a
      WHERE a.anio = $1 AND a.mes = $2
      ORDER BY a.id_cita, a.id_correlativo ASC
    ),
    -- Diagnóstico principal: primer CIE-10 (codigo que empieza con letra).
    dx AS (
      SELECT DISTINCT ON (a.id_cita)
             a.id_cita,
             a.codigo_item     AS dx,
             a.tipo_diagnostico AS tipo_dx
      FROM atencion a
      WHERE a.anio = $1 AND a.mes = $2 AND a.codigo_item ~ '^[A-Za-z]'
      ORDER BY a.id_cita, a.id_correlativo ASC
    )
    SELECT
      c.id_cita,
      c.tiene_pai,
      cab.id_paciente,
      cab.fecha_atencion,
      d.dx,
      d.tipo_dx,
      p.numero_documento,
      p.apellido_paterno,
      p.apellido_materno,
      p.nombres
    FROM citas c
    JOIN cab              ON cab.id_cita = c.id_cita
    LEFT JOIN dx d        ON d.id_cita = c.id_cita
    LEFT JOIN paciente p  ON p.id_paciente = cab.id_paciente
    WHERE c.es_nueva
    ORDER BY cab.fecha_atencion ASC NULLS LAST, c.id_cita ASC
    `,
    [anio, mes, COD_PAI]
  );
  return rows;
}

/** Evalúa las reglas de una cita y devuelve la fila enriquecida. */
function evaluarFila(r) {
  const errores = [];

  if (!r.dx) {
    errores.push('Sin diagnóstico CIE-10');
  } else if (r.tipo_dx !== 'D') {
    const etiqueta = TIPO_DX_LABEL[r.tipo_dx] || r.tipo_dx || '—';
    errores.push(`Diagnóstico no definitivo (${etiqueta})`);
  }

  if (!r.tiene_pai) {
    errores.push(`Falta código PAI ${COD_PAI}`);
  }

  const nombre = [r.apellido_paterno, r.apellido_materno, r.nombres]
    .filter(Boolean).join(' ') || '—';

  return {
    id_cita: r.id_cita,
    fecha_atencion: r.fecha_atencion,
    id_paciente: r.id_paciente,
    nombre,
    dni: r.numero_documento || '—',
    dx: r.dx || '—',
    tipo_dx: r.tipo_dx || null,
    tipo_dx_label: r.tipo_dx ? (TIPO_DX_LABEL[r.tipo_dx] || r.tipo_dx) : '—',
    tiene_pai: !!r.tiene_pai,
    errores,
    estado: errores.length ? 'error' : 'ok',
  };
}

/**
 * Verifica la codificación de los usuarios nuevos de un periodo.
 * @param {{anio:number, mes:number}} params
 * @returns {Promise<{periodo:object, resumen:object, filas:object[]}>}
 */
async function verificarCodificacion({ anio, mes }) {
  const a = parseInt(anio, 10);
  const m = parseInt(mes, 10);
  if (!Number.isInteger(a) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error('Periodo inválido: se requiere anio y mes válidos.');
  }

  const filas = (await obtenerCitasNuevas(a, m)).map(evaluarFila);

  const resumen = {
    total: filas.length,
    ok: filas.filter((f) => f.estado === 'ok').length,
    con_errores: filas.filter((f) => f.estado === 'error').length,
    sin_diagnostico: filas.filter((f) => f.errores.includes('Sin diagnóstico CIE-10')).length,
    dx_no_definitivo: filas.filter((f) => f.errores.some((e) => e.startsWith('Diagnóstico no definitivo'))).length,
    sin_pai: filas.filter((f) => !f.tiene_pai).length,
  };

  // Errores primero (para que la auditoría salte a la vista), luego por fecha.
  filas.sort((x, y) => {
    if (x.estado !== y.estado) return x.estado === 'error' ? -1 : 1;
    return new Date(x.fecha_atencion) - new Date(y.fecha_atencion);
  });

  return { periodo: { anio: a, mes: m }, resumen, filas };
}

/**
 * Genera el .docx de la verificación (tabla horizontal, una fila por cita nueva).
 * @param {{anio:number, mes:number}} params
 * @returns {Promise<{buffer: Buffer, filename: string}|null>}
 */
async function generarReporteCodificacion({ anio, mes }) {
  const { periodo, resumen, filas } = await verificarCodificacion({ anio, mes });
  if (!filas.length) return null;

  const nombreMes = MESES[periodo.mes - 1] || periodo.mes;
  const hoy = new Date();
  const fechaEmision = `${String(hoy.getDate()).padStart(2, '0')} de ${MESES[hoy.getMonth()]} de ${hoy.getFullYear()}`;

  const partes = [];
  partes.push(para([run('VERIFICACIÓN DE CODIFICACIÓN — USUARIOS NUEVOS', { bold: true, size: 28 })], { align: 'center', spacingAfter: 40 }));
  partes.push(para([run(`Centro de Salud Mental Comunitario RENACER · Periodo: ${nombreMes} ${periodo.anio}`, { size: 20, color: '595959' })], { align: 'center', spacingAfter: 120 }));
  partes.push(para([run(
    `Total usuarios nuevos: ${resumen.total}  ·  Correctos: ${resumen.ok}  ·  Con errores: ${resumen.con_errores}  ` +
    `(sin Dx: ${resumen.sin_diagnostico}, Dx no definitivo: ${resumen.dx_no_definitivo}, sin ${COD_PAI}: ${resumen.sin_pai})`,
    { size: 18, color: '595959' }
  )], { spacingAfter: 160 }));

  const headers = ['N°', 'Fecha', 'Nombres y apellidos', 'DNI', 'Dx (CIE-10)', 'Tipo Dx', 'PAI 99366', 'Estado', 'Observación'];
  const widths = [480, 1150, 3200, 1150, 1300, 1400, 1150, 1150, 4900];

  const filasTabla = [];
  filasTabla.push(filaTabla(headers.map((h, i) =>
    celda(run(h, { bold: true, size: 18 }), { width: widths[i], fill: 'E7EEF0' })
  )));

  filas.forEach((f, i) => {
    const esError = f.estado === 'error';
    const fill = esError ? 'FCE8E6' : null; // rojo muy claro en filas con error
    const estadoTxt = esError ? 'ERROR' : 'OK';
    const obs = esError ? f.errores.join('; ') : 'Cumple ambas reglas';
    const celdas = [
      [String(i + 1), widths[0]],
      [fmtFecha(f.fecha_atencion), widths[1]],
      [f.nombre, widths[2]],
      [f.dni, widths[3]],
      [f.dx, widths[4]],
      [f.tipo_dx_label, widths[5]],
      [f.tiene_pai ? 'Sí' : 'No', widths[6]],
      [estadoTxt, widths[7]],
      [obs, widths[8]],
    ];
    filasTabla.push(filaTabla(celdas.map(([txt, w]) =>
      celda(run(txt, { size: 18 }), { width: w, fill })
    )));
  });
  partes.push(tabla(filasTabla));

  partes.push(para(
    [run(`Documento generado el ${fechaEmision}.`, { size: 18, color: '808080' })],
    { align: 'right', spacingAfter: 0 }
  ));

  const buffer = construirDocx(partes, { landscape: true });
  const filename = `Verificacion_Codificacion_${periodo.anio}${String(periodo.mes).padStart(2, '0')}.docx`;
  return { buffer, filename };
}

module.exports = { verificarCodificacion, generarReporteCodificacion };
