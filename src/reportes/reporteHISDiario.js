const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  client_encoding : 'utf8',
});

const PLANTILLA_PATH = path.resolve(
  __dirname,
  '../../templates/plantilla_reporteproddiario.xlsx'
);

const MESES_ES = [
  'ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
  'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE',
];

const SQL_DIARIO = `
  SELECT
    DATE(a.fecha_atencion)    AS dia,
    COUNT(DISTINCT a.id_cita) AS atcs
  FROM atencion a
  WHERE a.id_personal = $1
    AND a.fecha_atencion >= $2
    AND a.fecha_atencion <= $3
    AND a.id_condicion_servicio IN ('C','N','R')
    AND a.id_paciente IS NOT NULL
  GROUP BY DATE(a.fecha_atencion)
  ORDER BY dia
`;

function generarFechas31(fechaInicioStr) {
  // Parsing date safely as UTC
  const [yyyy, mm, dd] = fechaInicioStr.split('-');
  const cursor = new Date(Date.UTC(yyyy, mm - 1, dd));
  
  const fechas = [];
  for (let i = 0; i < 31; i++) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cursor.getUTCDate()).padStart(2, '0');
    fechas.push(`${y}-${m}-${d}`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return fechas;
}

function calcularGruposMeses(fechas31) {
  const grupos = [];
  let mesActual = null;
  let conteo    = 0;

  for (const f of fechas31) {
    const [yyyy, mm, dd] = f.split('-');
    // mm is 1-12, array index is 0-11
    const mes = MESES_ES[parseInt(mm, 10) - 1];
    
    if (mes !== mesActual) {
      if (mesActual !== null) grupos.push({ nombreMes: mesActual, cantDias: conteo });
      mesActual = mes;
      conteo = 1;
    } else {
      conteo++;
    }
  }
  if (mesActual) grupos.push({ nombreMes: mesActual, cantDias: conteo });
  return grupos;
}

async function getReporteHISDiario(idPersonal, fechaInicioStr) {
  const fechas31 = generarFechas31(fechaInicioStr);
  const fechaFinStr = fechas31[30]; // 31th day
  
  // Obtain Professional Name
  const userRes = await pool.query(
    "SELECT CONCAT(UPPER(apellido_paterno), ' ', UPPER(apellido_materno), ', ', nombres) AS nombre FROM profesional WHERE id_personal = $1", 
    [idPersonal]
  );
  const nombreProfesional = userRes.rows[0]?.nombre ?? 'Profesional no encontrado';

  const { rows } = await pool.query(SQL_DIARIO, [idPersonal, fechaInicioStr, fechaFinStr]);

  const mapaAtcs = {};
  for (const r of rows) {
    // Handling timezone string conversions safely: Use PostgreSQL string 'YYYY-MM-DD'
    let dateStr = r.dia;
    if (r.dia instanceof Date) {
      // In JS, depending on PG parser, pure date fields can come as midnight local Date or midnight UTC String. 
      // Safest way to format it back: get fully padded string.
      const yy = r.dia.getFullYear(); 
      const mm = String(r.dia.getMonth()+1).padStart(2, '0');
      const dd = String(r.dia.getDate()).padStart(2, '0');
      dateStr = `${yy}-${mm}-${dd}`;
    } else {
       // if string: '2026-03-18' or '2026-03-18T00:00:00.000Z'
      dateStr = String(r.dia).split('T')[0];
    }
    mapaAtcs[dateStr] = Number(r.atcs);
  }

  const valoresDiarios = fechas31.map(f => mapaAtcs[f] ?? 0);
  const total = valoresDiarios.reduce((acc, val) => acc + val, 0);

  return {
    nombre_profesional: nombreProfesional,
    fechas31,
    fechaFin: fechaFinStr,
    valoresDiarios,
    total,
    gruposMeses: calcularGruposMeses(fechas31),
  };
}

async function generarExcelHISDiario(idPersonal, fechaInicio) {
  const datos = await getReporteHISDiario(idPersonal, fechaInicio);

  if (!fs.existsSync(PLANTILLA_PATH)) {
    throw new Error(`Plantilla no encontrada: ${PLANTILLA_PATH}`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(PLANTILLA_PATH);
  const ws = workbook.getWorksheet(1); // Primera hoja

  const periodoStr = `${fechaInicio} AL ${datos.fechaFin}`;
  const fechaGenStr = new Date().toLocaleDateString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  }) + ' — 7:00 a.m.';

  ws.eachRow((row) => {
    row.eachCell((cell) => {
      if (typeof cell.value === 'string') {
        if (cell.value.includes('{{PERIODO}}')) {
          cell.value = cell.value.replace('{{PERIODO}}', periodoStr);
        } else if (cell.value.includes('{{FECHA_GENERACION}}')) {
          cell.value = cell.value.replace('{{FECHA_GENERACION}}', fechaGenStr);
        }
      }
    });
  });

  // Fila 8: Cabecera de meses con fusión
  let colActual = 2; // B=2
  for (const grupo of datos.gruposMeses) {
    const colFin = colActual + grupo.cantDias - 1;

    // Exceljs merge fails if it's the exact same cell
    if (colFin > colActual) {
      ws.mergeCells(8, colActual, 8, colFin);
    }
    const cell = ws.getCell(8, colActual);
    cell.value = grupo.nombreMes;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.font = { bold: true, name: 'Arial', size: 10 };
    // Border it
    cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };

    // Hack array styling for merged cells bounds so border isn't missing
    for(let cAux = colActual; cAux <= colFin; cAux++) {
      ws.getCell(8, cAux).border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
    }

    colActual = colFin + 1;
  }

  // Fila 9: Números de día + TOTAL headers
  for (let i = 0; i < 31; i++) {
    const fStr = datos.fechas31[i];
    const numeroDia = parseInt(fStr.split('-')[2], 10);
    const cell = ws.getCell(9, 2 + i);
    cell.value = numeroDia;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.font = { bold: true, name: 'Arial', size: 9 };
    cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
  }
  
  // Columna TOTAL Header en fila 9 (la columna 33 es AG... o es AH = 34?)
  // B(2) ... AG(33)? B is 2. B to AG is 32 columns. 2+30 = 32. 
  // Wait: 2 (1st day), 2+30=32 (31st day). 33 is AH.
  const cellTotalH = ws.getCell(9, 33);
  cellTotalH.value = "TOTAL";
  cellTotalH.alignment = { horizontal: 'center', vertical: 'middle' };
  cellTotalH.font = { bold: true, name: 'Arial', size: 9 };
  cellTotalH.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };

  // Fila 10: Nombre + valores
  ws.getCell(10, 1).value = datos.nombre_profesional;
  ws.getCell(10, 1).border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };

  for (let i = 0; i < 31; i++) {
    const cell = ws.getCell(10, 2 + i);
    cell.value = datos.valoresDiarios[i];
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
  }

  const cellTotalV = ws.getCell(10, 33);
  cellTotalV.value = datos.total;
  cellTotalV.alignment = { horizontal: 'center', vertical: 'middle' };
  cellTotalV.font = { bold: true };
  cellTotalV.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };

  const buffer = await workbook.xlsx.writeBuffer();
  const tag = fechaInicio.replace(/-/g, '') + '_' + datos.fechaFin.replace(/-/g, '');
  const filename = `ReporteHIS_Diario_${tag}.xlsx`;

  return { buffer: Buffer.from(buffer), filename };
}

module.exports = { getReporteHISDiario, generarExcelHISDiario };
