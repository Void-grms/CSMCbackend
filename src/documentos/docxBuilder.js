/**
 * docxBuilder.js — Helpers para construir documentos .docx programáticamente.
 *
 * Construye WordprocessingML y lo empaqueta con pizzip (sin plantilla binaria).
 * Lo usan generarPaqueteDocx.js y generarReporteAtenciones.js.
 *
 * Tamaños de fuente en half-points: 22=11pt, 24=12pt, 26=13pt, 30=15pt, 36=18pt.
 */

const PizZip = require('pizzip');

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** Escapa los caracteres reservados de XML. */
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Fecha (Date o string) a dd/mm/yyyy en UTC (las fechas vienen sin hora). */
function fmtFecha(f) {
  if (!f) return '—';
  const d = new Date(f);
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/** Texto formateado dentro de una corrida (<w:r>). */
function run(text, { bold = false, size = 22, color = null } = {}) {
  const rpr =
    `<w:rPr>${bold ? '<w:b/>' : ''}` +
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` +
    `${color ? `<w:color w:val="${color}"/>` : ''}</w:rPr>`;
  return `<w:r>${rpr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

/** Párrafo (<w:p>) con uno o varios runs. */
function para(inner, { align = null, spacingAfter = 80 } = {}) {
  const jc = align ? `<w:jc w:val="${align}"/>` : '';
  const ppr = `<w:pPr>${jc}<w:spacing w:after="${spacingAfter}"/></w:pPr>`;
  return `<w:p>${ppr}${Array.isArray(inner) ? inner.join('') : inner}</w:p>`;
}

/** Párrafo "Etiqueta: valor" con la etiqueta en negrita. */
function campo(label, valor) {
  return para([run(`${label}: `, { bold: true }), run(valor)]);
}

/** Celda de tabla (<w:tc>). `inner` son runs ya construidos. */
function celda(inner, { width = null, fill = null } = {}) {
  const tcPr =
    `<w:tcPr>${width ? `<w:tcW w:w="${width}" w:type="dxa"/>` : ''}` +
    `${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}` +
    `<w:vAlign w:val="center"/></w:tcPr>`;
  const p = `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${inner}</w:p>`;
  return `<w:tc>${tcPr}${p}</w:tc>`;
}

/** Fila de tabla (<w:tr>) a partir de un array de celdas. */
function filaTabla(celdas) {
  return `<w:tr>${celdas.join('')}</w:tr>`;
}

/** Tabla (<w:tbl>) con bordes grises a partir de un array de filas. */
function tabla(filas) {
  const bordes =
    '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`)
      .join('') +
    '</w:tblBorders>';
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${bordes}` +
    `<w:tblLook w:val="04A0"/></w:tblPr>${filas.join('')}</w:tbl>`
  );
}

/**
 * Empaqueta las partes del cuerpo en un .docx válido.
 * @param {string[]} partes - Párrafos/tablas (WordprocessingML) del cuerpo.
 * @param {object}  [opts]  - { landscape: boolean } para orientación horizontal.
 * @returns {Buffer}
 */
function construirDocx(partes, { landscape = false } = {}) {
  const pgSz = landscape
    ? '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>'
    : '<w:pgSz w:w="11906" w:h="16838"/>';
  const sectPr = `<w:sectPr>${pgSz}<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>`;

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${partes.join('')}${sectPr}</w:body></w:document>`;

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>';

  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  const zip = new PizZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', rels);
  zip.file('word/document.xml', documentXml);

  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = {
  MESES, esc, fmtFecha, run, para, campo, celda, filaTabla, tabla, construirDocx,
};
