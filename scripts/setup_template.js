/**
 * setup_template.js
 * 
 * Lee CSMCbackend/Constancia_simple.docx (que ya tiene encabezado, logos y pie de página),
 * reemplaza el cuerpo del documento con el texto de la constancia simple
 * usando placeholders de docxtemplater {variable}, y guarda el resultado
 * en CSMCbackend/templates/constancia_simple.docx.
 * 
 * Ejecutar una sola vez:   node scripts/setup_template.js
 */

const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

// ── Rutas ──────────────────────────────────────────────────────────────────────
const SOURCE = path.resolve(__dirname, '..', 'Constancia_simple.docx');
const DEST   = path.resolve(__dirname, '..', 'templates', 'constancia_simple.docx');

// ── Helpers XML ────────────────────────────────────────────────────────────────

/** Crea un párrafo Word XML con texto y propiedades opcionales */
function p(text, opts = {}) {
  const { bold, size, align, spacing, font } = opts;

  let rPr = '';
  if (bold || size || font) {
    rPr = '<w:rPr>';
    if (bold) rPr += '<w:b/>';
    if (size) rPr += `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`;
    if (font) rPr += `<w:rFonts w:ascii="${font}" w:hAnsi="${font}"/>`;
    rPr += '</w:rPr>';
  }

  let pPr = '';
  if (align || spacing) {
    pPr = '<w:pPr>';
    if (align) pPr += `<w:jc w:val="${align}"/>`;
    if (spacing) pPr += `<w:spacing ${spacing}/>`;
    pPr += '</w:pPr>';
  }

  // Separar por saltos de línea si el texto contiene \n
  const lines = text.split('\n');
  let runs = '';
  lines.forEach((line, i) => {
    runs += `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`;
    if (i < lines.length - 1) {
      runs += `<w:r>${rPr}<w:br/></w:r>`;
    }
  });

  return `<w:p>${pPr}${runs}</w:p>`;
}

/** Crea un párrafo vacío (espacio en blanco) */
function emptyP() {
  return '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>';
}

/** Escapa caracteres especiales para XML */
function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Cuerpo de la constancia con placeholders ───────────────────────────────────

const bodyParagraphs = [
  // Fecha de emisión
  p('Otuzco, {diaEmision} de {mesEmision} del año {anioEmision}', { align: 'right', size: 22 }),
  
  emptyP(),
  emptyP(),

  // Título
  p('CONSTANCIA SIMPLE', { bold: true, size: 28, align: 'center' }),

  emptyP(),
  emptyP(),

  // Subtítulo
  p('La que suscribe, en representación del Centro de Salud Mental Comunitario RENACER de Otuzco.', { size: 22, align: 'both' }),

  emptyP(),
  emptyP(),

  // HACE CONSTAR
  p('HACE CONSTAR:', { bold: true, size: 22, align: 'both' }),

  emptyP(),

  // Cuerpo principal
  p(
    'Que, {nombreCompleto}, identificado con D.N.I N° {dni}, con domicilio en {domicilio}, ' +
    'Provincia de Otuzco del Departamento LA LIBERTAD, está recibiendo tratamiento en el CENTRO ' +
    'DE SALUD MENTAL COMUNITARIO RENACER DE OTUZCO desde el {diaInicio} de {mesInicio} del año {anioInicio}, ' +
    'con diagnóstico ({codigoDx} - {descripcionDx}); usuario viene recibiendo tratamiento especializado ' +
    'de manera permanente por el equipo interdisciplinario y actualmente cuenta con {numAtenciones} atenciones.',
    { size: 22, align: 'both' }
  ),

  emptyP(),
  emptyP(),

  // Cierre
  p('Atentamente,', { size: 22, align: 'left' }),

  // Espacio para firma manual
  emptyP(),
  emptyP(),
  emptyP(),
  emptyP(),
  emptyP(),
  emptyP(),

  // Pie
  p('MEEA/pfib', { size: 18 }),
  p('Folios (    01   )', { size: 18 }),
];

// ── Script principal ───────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`❌ No se encontró la plantilla base en: ${SOURCE}`);
    console.error('   Asegúrate de que "Constancia_simple.docx" esté en la raíz de CSMCbackend.');
    process.exit(1);
  }

  // Leer el .docx original
  const content = fs.readFileSync(SOURCE);
  const zip = new PizZip(content);

  // Obtener el document.xml (cuerpo del documento)
  const docXml = zip.file('word/document.xml');
  if (!docXml) {
    console.error('❌ No se pudo leer word/document.xml dentro del .docx');
    process.exit(1);
  }

  let xml = docXml.asText();

  // Reemplazar el contenido del <w:body> manteniendo el wrapper
  // El body suele terminar con <w:sectPr> que contiene las propiedades de sección
  // (márgenes, orientación, encabezado/pie de página)
  const bodyStartMatch = xml.match(/<w:body[^>]*>/);
  const sectPrMatch = xml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
  
  if (!bodyStartMatch) {
    console.error('❌ No se encontró <w:body> en document.xml');
    process.exit(1);
  }

  const bodyStart = bodyStartMatch[0];
  const sectPr = sectPrMatch ? sectPrMatch[0] : '';

  // Construir el nuevo body
  const newBody = `${bodyStart}${bodyParagraphs.join('')}${sectPr}</w:body>`;

  // Reemplazar todo el body
  xml = xml.replace(/<w:body[\s\S]*?<\/w:body>/, newBody);

  // Guardar
  zip.file('word/document.xml', xml);
  const output = zip.generate({ type: 'nodebuffer' });

  // Asegurar directorio de destino
  const destDir = path.dirname(DEST);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  fs.writeFileSync(DEST, output);
  console.log(`✅ Plantilla generada exitosamente en: ${DEST}`);
  console.log('   Puedes abrir el archivo en Word para verificar el formato.');
}

main();
