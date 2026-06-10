/**
 * verificarCodificacion.js — Verificación de errores de codificación HIS.
 *
 * Audita las APERTURAS de paquete de un periodo. Una "apertura" es la PRIMERA
 * vez (por fecha) que un paciente presenta un diagnóstico CIE-10, cuando esa
 * primera cita tiene condición de servicio 'N' (Nuevo) o 'R' (Reingreso).
 *
 * Reglas que deben cumplirse en esa cita de apertura:
 *   1. El diagnóstico debe estar en DEFINITIVO (tipo_diagnostico = 'D').
 *   2. La cita debe incluir el código PAI 99366.
 *
 * El código PAI y el Definitivo solo se exigen al ABRIR el paquete; en las
 * atenciones siguientes el diagnóstico pasa a Repetido (R) y ya no es necesario,
 * por eso solo se evalúa la primera aparición de cada diagnóstico por paciente.
 *
 * Nota: la "primera aparición" se calcula sobre los datos cargados en la base
 * (los paquetes abiertos antes del periodo más antiguo cargado no son visibles).
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
// Etiqueta legible de la condición de servicio (solo aperturas).
const COND_LABEL = { N: 'Nuevo', R: 'Reingreso' };

/**
 * Obtiene las aperturas de paquete del periodo: primera aparición de cada
 * (paciente, diagnóstico) cuya primera cita es condición N o R y cae en el mes.
 */
async function obtenerAperturas(anio, mes) {
  const { rows } = await pool.query(
    `
    WITH dx_occ AS (
      -- Cada aparición de un diagnóstico CIE-10: codigo que empieza con letra,
      -- EXCEPTO C (los códigos C son procedimientos del HIS, no diagnósticos).
      SELECT a.id_paciente,
             a.codigo_item       AS dx,
             a.id_cita,
             a.fecha_atencion,
             a.id_correlativo,
             a.tipo_diagnostico   AS tipo_dx,
             a.id_condicion_servicio AS cond
      FROM atencion a
      WHERE a.codigo_item ~* '^[abd-z]' AND a.id_paciente IS NOT NULL
    ),
    primera AS (
      -- Primera aparición (fecha, luego correlativo) de cada (paciente, dx).
      SELECT DISTINCT ON (id_paciente, dx)
             id_paciente, dx, id_cita, fecha_atencion, tipo_dx, cond
      FROM dx_occ
      ORDER BY id_paciente, dx, fecha_atencion ASC, id_correlativo ASC
    )
    SELECT
      pr.id_cita,
      pr.id_paciente,
      pr.fecha_atencion,
      pr.dx,
      pr.tipo_dx,
      pr.cond,
      (SELECT bool_or(x.codigo_item = $3) FROM atencion x WHERE x.id_cita = pr.id_cita) AS tiene_pai,
      p.numero_documento,
      p.apellido_paterno,
      p.apellido_materno,
      p.nombres
    FROM primera pr
    LEFT JOIN paciente p ON p.id_paciente = pr.id_paciente
    WHERE pr.cond IN ('N', 'R')
      AND pr.fecha_atencion >= make_date($1, $2, 1)
      AND pr.fecha_atencion <  (make_date($1, $2, 1) + INTERVAL '1 month')
    ORDER BY pr.fecha_atencion ASC, pr.id_cita ASC
    `,
    [anio, mes, COD_PAI]
  );
  return rows;
}

/** Evalúa las reglas de una apertura y devuelve la fila enriquecida. */
function evaluarFila(r) {
  const errores = [];

  if (r.tipo_dx !== 'D') {
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
    cond: r.cond,
    cond_label: COND_LABEL[r.cond] || r.cond,
    tiene_pai: !!r.tiene_pai,
    errores,
    estado: errores.length ? 'error' : 'ok',
  };
}

/**
 * Verifica la codificación de las aperturas de paquete de un periodo.
 * @param {{anio:number, mes:number}} params
 * @returns {Promise<{periodo:object, resumen:object, filas:object[]}>}
 */
async function verificarCodificacion({ anio, mes }) {
  const a = parseInt(anio, 10);
  const m = parseInt(mes, 10);
  if (!Number.isInteger(a) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error('Periodo inválido: se requiere anio y mes válidos.');
  }

  const filas = (await obtenerAperturas(a, m)).map(evaluarFila);

  const resumen = {
    total: filas.length,
    nuevos: filas.filter((f) => f.cond === 'N').length,
    reingresos: filas.filter((f) => f.cond === 'R').length,
    ok: filas.filter((f) => f.estado === 'ok').length,
    con_errores: filas.filter((f) => f.estado === 'error').length,
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
 * Genera el .docx de la verificación (tabla horizontal, una fila por apertura).
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
  partes.push(para([run('VERIFICACIÓN DE CODIFICACIÓN — APERTURAS DE PAQUETE', { bold: true, size: 28 })], { align: 'center', spacingAfter: 40 }));
  partes.push(para([run(`Centro de Salud Mental Comunitario RENACER · Periodo: ${nombreMes} ${periodo.anio}`, { size: 20, color: '595959' })], { align: 'center', spacingAfter: 120 }));
  partes.push(para([run(
    `Aperturas: ${resumen.total} (nuevos: ${resumen.nuevos}, reingresos: ${resumen.reingresos})  ·  ` +
    `Correctas: ${resumen.ok}  ·  Con errores: ${resumen.con_errores}  ` +
    `(Dx no definitivo: ${resumen.dx_no_definitivo}, sin ${COD_PAI}: ${resumen.sin_pai})`,
    { size: 18, color: '595959' }
  )], { spacingAfter: 160 }));

  const headers = ['N°', 'Fecha', 'Nombres y apellidos', 'DNI', 'Condición', 'Dx (CIE-10)', 'Tipo Dx', 'PAI 99366', 'Estado', 'Observación'];
  const widths = [460, 1100, 3000, 1100, 1250, 1250, 1300, 1100, 1050, 4540];

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
      [f.cond_label, widths[4]],
      [f.dx, widths[5]],
      [f.tipo_dx_label, widths[6]],
      [f.tiene_pai ? 'Sí' : 'No', widths[7]],
      [estadoTxt, widths[8]],
      [obs, widths[9]],
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
