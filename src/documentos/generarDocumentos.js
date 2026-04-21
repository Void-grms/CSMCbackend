/**
 * generarDocumentos.js — Módulo de generación de documentos .docx
 * 
 * Genera documentos Word a partir de plantillas con datos del paciente.
 * Usa docxtemplater + pizzip para rellenar placeholders.
 */

const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// ── Pool de conexión (mismo patrón que el resto del proyecto) ─────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  client_encoding: 'utf8',
});

// ── Meses en español ──────────────────────────────────────────────────────────
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// ── Ruta a la plantilla ───────────────────────────────────────────────────────
const TEMPLATE_PATH = path.resolve(__dirname, '..', '..', 'templates', 'constancia_simple.docx');

// ═════════════════════════════════════════════════════════════════════════════
// buscarPacienteDocumentos — Búsqueda de pacientes para el módulo de documentos
// ═════════════════════════════════════════════════════════════════════════════

async function buscarPacienteDocumentos(termino) {
  const q = `%${termino}%`;
  const { rows } = await pool.query(
    `SELECT
       id_paciente,
       nombres,
       apellido_paterno,
       apellido_materno,
       numero_documento,
       domicilio_declarado,
       domicilio_reniec
     FROM paciente
     WHERE numero_documento ILIKE $1
        OR apellido_paterno  ILIKE $1
        OR apellido_materno  ILIKE $1
        OR nombres           ILIKE $1
        OR CONCAT(apellido_paterno, ' ', apellido_materno, ' ', nombres) ILIKE $1
     ORDER BY apellido_paterno, apellido_materno, nombres
     LIMIT 30`,
    [q]
  );
  return rows;
}

// ═════════════════════════════════════════════════════════════════════════════
// generarConstanciaSimple — Genera el buffer .docx de una constancia simple
// ═════════════════════════════════════════════════════════════════════════════

async function generarConstanciaSimple(pacienteId) {
  // 1. Datos del paciente
  const { rows: pacienteRows } = await pool.query(
    `SELECT
       apellido_paterno,
       apellido_materno,
       nombres,
       numero_documento,
       domicilio_declarado,
       domicilio_reniec
     FROM paciente
     WHERE id_paciente = $1`,
    [pacienteId]
  );

  if (pacienteRows.length === 0) {
    return null; // Paciente no encontrado
  }

  const pac = pacienteRows[0];

  // 2. Paquete: Fecha de inicio de tratamiento y diagnóstico
  const { rows: paqueteRows } = await pool.query(
    `SELECT fecha_inicio, dx_principal
     FROM paquete_paciente
     WHERE id_paciente = $1
     ORDER BY 
       CASE WHEN estado = 'abierto' THEN 0 ELSE 1 END,
       fecha_inicio DESC
     LIMIT 1`,
    [pacienteId]
  );

  // 3. Total de atenciones (únicas por id_cita desde que empezó el paquete)
  let queryCount = `SELECT COUNT(DISTINCT id_cita) AS total FROM atencion WHERE id_paciente = $1`;
  let queryParams = [pacienteId];

  if (paqueteRows.length > 0 && paqueteRows[0].fecha_inicio) {
    queryCount += ` AND fecha_atencion >= $2`;
    queryParams.push(paqueteRows[0].fecha_inicio);
  }

  const { rows: countRows } = await pool.query(queryCount, queryParams);

  // ── Construir datos para la plantilla ───────────────────────────────────
  const hoy = new Date();
  const fechaInicio = paqueteRows.length > 0 ? new Date(paqueteRows[0].fecha_inicio) : null;

  const nombreCompleto = [pac.apellido_paterno, pac.apellido_materno, pac.nombres]
    .filter(Boolean)
    .join(' ');

  const domicilio = pac.domicilio_declarado || pac.domicilio_reniec || '';

  const datos = {
    // Fecha de emisión
    diaEmision:    hoy.getDate().toString().padStart(2, '0'),
    mesEmision:    MESES[hoy.getMonth()],
    anioEmision:   hoy.getFullYear().toString(),

    // Datos del paciente
    nombreCompleto,
    dni:           pac.numero_documento || '',
    domicilio,

    // Fecha de inicio de tratamiento
    diaInicio:     fechaInicio ? fechaInicio.getUTCDate().toString().padStart(2, '0') : '',
    mesInicio:     fechaInicio ? MESES[fechaInicio.getUTCMonth()] : '',
    anioInicio:    fechaInicio ? fechaInicio.getUTCFullYear().toString() : '',

    // Diagnóstico
    codigoDx:      paqueteRows.length > 0 ? (paqueteRows[0].dx_principal || '') : '',
    descripcionDx: '', // No existe en BD — se deja vacío intencionalmente

    // Atenciones
    numAtenciones: countRows[0]?.total?.toString() || '0',
  };

  // ── Generar documento ───────────────────────────────────────────────────
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`Plantilla no encontrada: ${TEMPLATE_PATH}. Ejecuta "node scripts/setup_template.js" primero.`);
  }

  const content = fs.readFileSync(TEMPLATE_PATH, 'binary');
  const zip = new PizZip(content);

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    // nullGetter: variables sin valor retornan cadena vacía en vez de error
    nullGetter() {
      return '';
    },
  });

  doc.render(datos);

  const buffer = doc.getZip().generate({ type: 'nodebuffer' });
  return { buffer, dni: pac.numero_documento || pacienteId };
}

module.exports = {
  buscarPacienteDocumentos,
  generarConstanciaSimple,
};
