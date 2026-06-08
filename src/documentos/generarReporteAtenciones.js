/**
 * generarReporteAtenciones.js — Reporte .docx de atenciones de varios pacientes.
 *
 * Para cada paciente toma su ÚLTIMO paquete (mayor fecha_inicio, sea cual sea su
 * estado) y arma una fila con: nombres y apellidos, DNI, diagnóstico, fecha de
 * inicio, nº de atenciones (citas únicas dentro del periodo del paquete) y una
 * observación según el estado del paquete.
 */

const { Pool } = require('pg');
const {
  MESES, fmtFecha, run, para, celda, filaTabla, tabla, construirDocx,
} = require('./docxBuilder');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  client_encoding: 'utf8',
});

const MSG_TERMINADO =
  'El usuario terminó con la totalidad de su paquete de atención con el equipo multidisciplinario';
const MSG_CONTINUA = 'Continúa las atenciones con el equipo multidisciplinario';

/** Construye la fila de datos de un paciente (o null si no existe). */
async function obtenerFilaPaciente(idPaciente) {
  const { rows: pacRows } = await pool.query(
    `SELECT apellido_paterno, apellido_materno, nombres, numero_documento
     FROM paciente WHERE id_paciente = $1`,
    [idPaciente]
  );
  if (!pacRows.length) return null;

  const pac = pacRows[0];
  const nombre = [pac.apellido_paterno, pac.apellido_materno, pac.nombres]
    .filter(Boolean).join(' ');
  const dni = pac.numero_documento || '—';

  // Último paquete del paciente (cualquier estado).
  const { rows: paqRows } = await pool.query(
    `SELECT id_paquete, dx_principal, fecha_inicio, fecha_limite, estado
     FROM paquete_paciente
     WHERE id_paciente = $1
     ORDER BY fecha_inicio DESC
     LIMIT 1`,
    [idPaciente]
  );

  if (!paqRows.length) {
    return { nombre, dni, dx: '—', fecha_inicio: null, num: 0, observacion: 'Sin paquete registrado' };
  }

  const paq = paqRows[0];

  // Nº de atenciones = citas únicas dentro del periodo del paquete.
  const { rows: cnt } = await pool.query(
    `SELECT COUNT(DISTINCT id_cita)::int AS n
     FROM atencion
     WHERE id_paciente = $1 AND fecha_atencion >= $2 AND fecha_atencion <= $3`,
    [idPaciente, paq.fecha_inicio, paq.fecha_limite]
  );

  // 'completado' => terminó; 'abierto' y 'vencido' => continúa.
  const observacion = paq.estado === 'completado' ? MSG_TERMINADO : MSG_CONTINUA;

  return {
    nombre,
    dni,
    dx: paq.dx_principal || '—',
    fecha_inicio: paq.fecha_inicio,
    num: cnt[0].n,
    observacion,
  };
}

/**
 * @param {string[]} idsPacientes - Lista de id_paciente.
 * @returns {Promise<{buffer: Buffer, filename: string}|null>}
 */
async function generarReporteAtenciones(idsPacientes) {
  const ids = Array.from(new Set((idsPacientes || []).filter(Boolean)));
  if (!ids.length) return null;

  const filasDatos = [];
  for (const id of ids) {
    const fila = await obtenerFilaPaciente(id);
    if (fila) filasDatos.push(fila);
  }
  if (!filasDatos.length) return null;

  const hoy = new Date();
  const fechaEmision = `${String(hoy.getDate()).padStart(2, '0')} de ${MESES[hoy.getMonth()]} de ${hoy.getFullYear()}`;

  const partes = [];
  partes.push(para([run('REPORTE DE ATENCIONES', { bold: true, size: 30 })], { align: 'center', spacingAfter: 40 }));
  partes.push(para([run('Centro de Salud Mental Comunitario RENACER', { size: 20, color: '595959' })], { align: 'center', spacingAfter: 200 }));

  const headers = ['N°', 'Nombres y apellidos', 'DNI', 'Diagnóstico', 'Fecha de inicio', 'N° atenciones', 'Observación'];
  const widths = [520, 2900, 1200, 1500, 1400, 1150, 5900];

  const filas = [];
  filas.push(filaTabla(headers.map((h, i) =>
    celda(run(h, { bold: true, size: 18 }), { width: widths[i], fill: 'E7EEF0' })
  )));
  filasDatos.forEach((f, i) => {
    filas.push(filaTabla([
      celda(run(String(i + 1), { size: 18 }), { width: widths[0] }),
      celda(run(f.nombre, { size: 18 }), { width: widths[1] }),
      celda(run(f.dni, { size: 18 }), { width: widths[2] }),
      celda(run(f.dx, { size: 18 }), { width: widths[3] }),
      celda(run(fmtFecha(f.fecha_inicio), { size: 18 }), { width: widths[4] }),
      celda(run(String(f.num), { size: 18 }), { width: widths[5] }),
      celda(run(f.observacion, { size: 18 }), { width: widths[6] }),
    ]));
  });
  partes.push(tabla(filas));

  partes.push(para(
    [run(`Documento generado el ${fechaEmision}. Total de usuarios: ${filasDatos.length}.`, { size: 18, color: '808080' })],
    { align: 'right', spacingAfter: 0 }
  ));

  const buffer = construirDocx(partes, { landscape: true });
  const filename = `Reporte_Atenciones_${hoy.toISOString().slice(0, 10)}.docx`;
  return { buffer, filename };
}

module.exports = { generarReporteAtenciones };
