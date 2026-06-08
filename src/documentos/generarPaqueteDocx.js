/**
 * generarPaqueteDocx.js — Genera un .docx con el resumen de un paquete terapéutico.
 *
 * El documento incluye una tabla de atenciones de longitud variable, por lo que se
 * construye el WordprocessingML programáticamente (ver docxBuilder.js) en vez de
 * rellenar una plantilla con docxtemplater.
 *
 * Contenido: paciente, paquete y diagnóstico, nº de atenciones, última atención y
 * el detalle de atenciones (por cita: fecha, profesional, procedimientos).
 */

const { getAvancePaquete } = require('../paquetes/resumenAvance');
const {
  MESES, fmtFecha, run, para, campo, celda, filaTabla, tabla, construirDocx,
} = require('./docxBuilder');

/**
 * @param {string} idPaquetePaciente - UUID del paquete_paciente (el de la URL).
 * @returns {Promise<{buffer: Buffer, filename: string}|null>}
 */
async function generarPaqueteDocx(idPaquetePaciente) {
  const data = await getAvancePaquete(idPaquetePaciente);
  if (!data) return null;

  const pp = data.paquete_paciente || {};
  const paciente = data.paciente || {};
  const timeline = data.timeline || [];

  // Agrupar el timeline por cita: fecha, profesional, procedimientos (códigos).
  const citasMap = new Map();
  for (const r of timeline) {
    if (!citasMap.has(r.id_cita)) {
      citasMap.set(r.id_cita, {
        id_cita: r.id_cita,
        fecha: r.fecha_atencion,
        profesional: r.nombre_profesional,
        procedimientos: [],
      });
    }
    if (r.codigo_item) citasMap.get(r.id_cita).procedimientos.push(r.codigo_item);
  }
  const citas = Array.from(citasMap.values()).sort(
    (a, b) => new Date(a.fecha) - new Date(b.fecha)
  );
  const numAtenciones = citas.length;
  const ultima = citas.length ? citas[citas.length - 1] : null;

  const hoy = new Date();
  const fechaEmision = `${String(hoy.getDate()).padStart(2, '0')} de ${MESES[hoy.getMonth()]} de ${hoy.getFullYear()}`;

  const partes = [];

  // Título
  partes.push(para([run('REPORTE DE PAQUETE TERAPÉUTICO — PP 0131', { bold: true, size: 30 })], { align: 'center', spacingAfter: 40 }));
  partes.push(para([run('Centro de Salud Mental Comunitario RENACER', { size: 20, color: '595959' })], { align: 'center', spacingAfter: 200 }));

  // Datos del paciente y paquete
  partes.push(para([run('Datos del paciente y paquete', { bold: true, size: 26, color: '1F4E5F' })], { spacingAfter: 100 }));
  partes.push(campo('Paciente', paciente.nombre_completo || pp.id_paciente || '—'));
  partes.push(campo('DNI', paciente.dni || '—'));
  partes.push(campo('Paquete', `${pp.nombre_paquete || pp.id_paquete || '—'}${pp.id_paquete && pp.nombre_paquete ? ` (${pp.id_paquete})` : ''}`));
  partes.push(campo('Diagnóstico vinculado', pp.dx_principal || '—'));
  partes.push(campo('Estado', pp.estado || '—'));
  partes.push(campo('Fecha de inicio', fmtFecha(pp.fecha_inicio)));
  partes.push(campo('Número de atenciones', String(numAtenciones)));

  // Última atención
  partes.push(para([run('Última atención', { bold: true, size: 26, color: '1F4E5F' })], { spacingAfter: 100 }));
  if (ultima) {
    partes.push(campo('Fecha', fmtFecha(ultima.fecha)));
    if (ultima.profesional) partes.push(campo('Profesional', ultima.profesional));
    if (ultima.procedimientos.length) partes.push(campo('Procedimientos', ultima.procedimientos.join(', ')));
  } else {
    partes.push(para([run('Sin atenciones registradas en el periodo del paquete.', { color: '808080' })]));
  }

  // Detalle de atenciones (tabla)
  partes.push(para([run('Detalle de atenciones', { bold: true, size: 26, color: '1F4E5F' })], { spacingAfter: 100 }));
  if (citas.length) {
    const filas = [];
    filas.push(filaTabla([
      celda(run('N°', { bold: true, size: 20 }), { width: 600, fill: 'E7EEF0' }),
      celda(run('Fecha', { bold: true, size: 20 }), { width: 1600, fill: 'E7EEF0' }),
      celda(run('Profesional', { bold: true, size: 20 }), { width: 3600, fill: 'E7EEF0' }),
      celda(run('Procedimientos', { bold: true, size: 20 }), { width: 3400, fill: 'E7EEF0' }),
    ]));
    citas.forEach((c, i) => {
      filas.push(filaTabla([
        celda(run(String(i + 1), { size: 20 }), { width: 600 }),
        celda(run(fmtFecha(c.fecha), { size: 20 }), { width: 1600 }),
        celda(run(c.profesional || '—', { size: 20 }), { width: 3600 }),
        celda(run(c.procedimientos.join(', ') || '—', { size: 20 }), { width: 3400 }),
      ]));
    });
    partes.push(tabla(filas));
  } else {
    partes.push(para([run('Sin atenciones registradas.', { color: '808080' })]));
  }

  // Pie
  partes.push(para([run(`Documento generado el ${fechaEmision}.`, { size: 18, color: '808080' })], { align: 'right', spacingAfter: 0 }));

  const buffer = construirDocx(partes);

  const refArchivo = (paciente.dni || pp.id_paciente || 'paquete').toString().replace(/[^\w.-]/g, '');
  const filename = `Paquete_${refArchivo}_${(pp.id_paquete || '').replace(/[^\w.-]/g, '')}.docx`;

  return { buffer, filename };
}

module.exports = { generarPaqueteDocx };
