/**
 * reporteHIS.js — Reporte de Producción HIS
 *
 * Calcula los indicadores ATDe, ATCe, ATDs, ATCs por profesional
 * y genera un archivo Excel (.xlsx) rellenando una plantilla predefinida.
 *
 * Indicadores:
 *   ATDe = COUNT DISTINCT id_cita WHERE id_condicion_establecimiento IN ('N','R')
 *   ATCe = COUNT DISTINCT id_cita WHERE id_condicion_establecimiento IN ('C','N','R')
 *   ATDs = COUNT DISTINCT id_cita WHERE id_condicion_servicio IN ('N','R')
 *   ATCs = COUNT DISTINCT id_cita WHERE id_condicion_servicio IN ('C','N','R')
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { Pool } = require('pg');

// ── Pool de conexión (mismo patrón que el resto del proyecto) ─────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  client_encoding: 'utf8',
});

// ── Ruta a la plantilla Excel ─────────────────────────────────────────────────
const PLANTILLA_PATH = path.resolve(
  __dirname,
  '../../templates/plantilla_reporteprod.xlsx'
);

// ── Query SQL ─────────────────────────────────────────────────────────────────
// Filtra por profesional ($1), fecha_inicio ($2) y fecha_fin ($3).
// Excluye actividades colectivas (APP*) con `id_paciente IS NOT NULL`.
const SQL_REPORTE_HIS = `
  SELECT
    CONCAT(
      UPPER(p.apellido_paterno), ' ',
      UPPER(p.apellido_materno), ' ',
      p.nombres
    ) AS nombre_profesional,
    COUNT(DISTINCT CASE
      WHEN a.id_condicion_establecimiento IN ('N','R') THEN a.id_cita
    END) AS "ATDe",
    COUNT(DISTINCT CASE
      WHEN a.id_condicion_establecimiento IN ('C','N','R') THEN a.id_cita
    END) AS "ATCe",
    COUNT(DISTINCT CASE
      WHEN a.id_condicion_servicio IN ('N','R') THEN a.id_cita
    END) AS "ATDs",
    COUNT(DISTINCT CASE
      WHEN a.id_condicion_servicio IN ('C','N','R') THEN a.id_cita
    END) AS "ATCs"
  FROM atencion a
  JOIN profesional p ON p.id_personal = a.id_personal
  WHERE a.id_personal = $1
    AND a.fecha_atencion >= $2
    AND a.fecha_atencion <= $3
    AND a.id_paciente IS NOT NULL
  GROUP BY p.apellido_paterno, p.apellido_materno, p.nombres
`;

// ═════════════════════════════════════════════════════════════════════════════
// getReporteHIS — Consulta los indicadores de un profesional
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Obtiene los indicadores ATDe/ATCe/ATDs/ATCs de un profesional
 * en un rango de fechas.
 *
 * @param {string} idPersonal  - ID del profesional (ej: '1614498736275')
 * @param {string} fechaInicio - Fecha inicio en formato YYYY-MM-DD
 * @param {string} fechaFin    - Fecha fin en formato YYYY-MM-DD
 * @returns {Promise<object|null>} Objeto con los indicadores, o null si no hay datos
 */
async function getReporteHIS(idPersonal, fechaInicio, fechaFin) {
  const { rows } = await pool.query(SQL_REPORTE_HIS, [
    idPersonal,
    fechaInicio,
    fechaFin,
  ]);
  return rows[0] || null;
}

// ═════════════════════════════════════════════════════════════════════════════
// generarExcelHIS — Genera el Excel rellenando la plantilla
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Lee la plantilla Excel, reemplaza los placeholders con los datos
 * calculados y retorna el buffer del archivo generado.
 *
 * @param {string} idPersonal  - ID del profesional
 * @param {string} fechaInicio - Fecha inicio YYYY-MM-DD
 * @param {string} fechaFin    - Fecha fin YYYY-MM-DD
 * @returns {Promise<{buffer: Buffer, filename: string}>}
 */
async function generarExcelHIS(idPersonal, fechaInicio, fechaFin) {
  // 1. Obtener datos de la BD
  const datos = await getReporteHIS(idPersonal, fechaInicio, fechaFin);

  // 2. Leer la plantilla
  if (!fs.existsSync(PLANTILLA_PATH)) {
    throw new Error(
      `Plantilla no encontrada: ${PLANTILLA_PATH}. ` +
      'Coloca el archivo plantilla_reporteprod.xlsx en la carpeta templates/.'
    );
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(PLANTILLA_PATH);
  const ws = workbook.getWorksheet(1); // Primera hoja

  const nombreProfesional = datos?.nombre_profesional ?? '(Sin atenciones en el período)';
  const periodo = `${fechaInicio} al ${fechaFin}`;
  const fechaGen = new Date().toLocaleDateString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  // 3. Reemplazar valores dinámicamente en cualquier celda que contenga el placeholder
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      if (typeof cell.value === 'string') {
        if (cell.value.includes('{{PERIODO}}')) {
          cell.value = cell.value.replace('{{PERIODO}}', periodo);
        } else if (cell.value.includes('{{FECHA_GENERACION}}')) {
          cell.value = cell.value.replace('{{FECHA_GENERACION}}', fechaGen);
        } else if (cell.value.includes('{{N}}')) {
          cell.value = cell.value.replace('{{N}}', 1);
        } else if (cell.value.includes('{{NOMBRE_PROFESIONAL}}')) {
          cell.value = cell.value.replace('{{NOMBRE_PROFESIONAL}}', nombreProfesional);
        } else if (cell.value.includes('{{ATDe}}')) {
          cell.value = datos ? Number(datos.ATDe) : 0;
        } else if (cell.value.includes('{{ATCe}}')) {
          cell.value = datos ? Number(datos.ATCe) : 0;
        } else if (cell.value.includes('{{ATDs}}')) {
          cell.value = datos ? Number(datos.ATDs) : 0;
        } else if (cell.value.includes('{{ATCs}}')) {
          cell.value = datos ? Number(datos.ATCs) : 0;
        }
      }
    });
  });

  // 6. Generar buffer
  const buffer = await workbook.xlsx.writeBuffer();
  const fechaTag = fechaInicio.replace(/-/g, '') + '_' + fechaFin.replace(/-/g, '');
  const filename = `ReporteHIS_${fechaTag}.xlsx`;

  return { buffer: Buffer.from(buffer), filename };
}

module.exports = { getReporteHIS, generarExcelHIS };
