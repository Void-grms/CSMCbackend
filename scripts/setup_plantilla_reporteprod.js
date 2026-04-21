/**
 * setup_plantilla_reporteprod.js
 * 
 * Crea la plantilla Excel para el Reporte de Producción HIS
 * con encabezados institucionales, formato y placeholders.
 * 
 * Ejecutar una sola vez:
 *   node scripts/setup_plantilla_reporteprod.js
 */

require('dotenv').config();
const ExcelJS = require('exceljs');
const path = require('path');

async function crearPlantilla() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sistema RENACER';
  workbook.created = new Date();

  const ws = workbook.addWorksheet('Reporte HIS', {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: {
        left: 0.5, right: 0.5,
        top: 0.75, bottom: 0.75,
        header: 0.3, footer: 0.3,
      },
    },
  });

  // ── Anchos de columna ────────────────────────────────────────────────────
  ws.columns = [
    { width: 5 },   // A: N°
    { width: 45 },  // B: Profesional
    { width: 12 },  // C: ATDe
    { width: 12 },  // D: ATCe
    { width: 12 },  // E: ATDs
    { width: 12 },  // F: ATCs
  ];

  // ── Estilos ──────────────────────────────────────────────────────────────
  const fuenteTitulo = { name: 'Calibri', size: 14, bold: true };
  const fuenteSubtitulo = { name: 'Calibri', size: 11, bold: true };
  const fuenteNormal = { name: 'Calibri', size: 10 };
  const fuenteLabel = { name: 'Calibri', size: 10, bold: true };
  const fuenteCabecera = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };

  const bordeDelgado = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  };

  const fondoCabecera = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E5A88' } };
  const fondoDatos = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4F8' } };

  // ── Fila 1: Encabezado institucional ─────────────────────────────────────
  ws.mergeCells('A1:F1');
  const cell1 = ws.getCell('A1');
  cell1.value = 'RED INTEGRADA DE SALUD OTUZCO';
  cell1.font = fuenteTitulo;
  cell1.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 25;

  // ── Fila 2: Título del documento ─────────────────────────────────────────
  ws.mergeCells('A2:F2');
  const cell2 = ws.getCell('A2');
  cell2.value = 'REPORTE DE PRODUCCIÓN HIS';
  cell2.font = { ...fuenteTitulo, size: 13 };
  cell2.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 22;

  // ── Fila 3: Nombre del establecimiento ───────────────────────────────────
  ws.mergeCells('A3:F3');
  const cell3 = ws.getCell('A3');
  cell3.value = 'CENTRO DE SALUD MENTAL COMUNITARIO RENACER - OTUZCO';
  cell3.font = fuenteSubtitulo;
  cell3.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(3).height = 20;

  // ── Fila 4: Período ──────────────────────────────────────────────────────
  ws.getCell('A4').value = 'Período:';
  ws.getCell('A4').font = fuenteLabel;
  ws.mergeCells('C4:F4');
  ws.getCell('C4').value = '{{PERIODO}}';
  ws.getCell('C4').font = fuenteNormal;

  // ── Fila 5: Fecha de generación ──────────────────────────────────────────
  ws.getCell('A5').value = 'Fecha de generación:';
  ws.getCell('A5').font = fuenteLabel;
  ws.mergeCells('C5:F5');
  ws.getCell('C5').value = '{{FECHA_GENERACION}}';
  ws.getCell('C5').font = fuenteNormal;

  // ── Fila 7: Cabecera de tabla ────────────────────────────────────────────
  const cabecera = ['N°', 'PROFESIONAL', 'ATDe', 'ATCe', 'ATDs', 'ATCs'];
  const row7 = ws.getRow(7);
  row7.height = 22;
  cabecera.forEach((titulo, i) => {
    const cell = row7.getCell(i + 1);
    cell.value = titulo;
    cell.font = fuenteCabecera;
    cell.fill = fondoCabecera;
    cell.alignment = {
      horizontal: i <= 1 ? 'center' : 'center',
      vertical: 'middle',
    };
    cell.border = bordeDelgado;
  });

  // ── Fila 8: Fila de datos (placeholders) ─────────────────────────────────
  const datosRow = ['{{N}}', '{{NOMBRE_PROFESIONAL}}', '{{ATDe}}', '{{ATCe}}', '{{ATDs}}', '{{ATCs}}'];
  const row8 = ws.getRow(8);
  row8.height = 20;
  datosRow.forEach((val, i) => {
    const cell = row8.getCell(i + 1);
    cell.value = val;
    cell.font = fuenteNormal;
    cell.fill = fondoDatos;
    cell.alignment = {
      horizontal: i <= 1 ? 'left' : 'center',
      vertical: 'middle',
    };
    cell.border = bordeDelgado;
  });

  // ── Guardar ──────────────────────────────────────────────────────────────
  const destino = path.resolve(__dirname, '..', 'templates', 'plantilla_reporteprod.xlsx');
  await workbook.xlsx.writeFile(destino);
  console.log(`✔ Plantilla creada: ${destino}`);
}

crearPlantilla().catch((err) => {
  console.error('✖ Error:', err.message);
  process.exit(1);
});
