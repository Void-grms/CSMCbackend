require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function analyze() {
  console.log("Conectando a la BD...");
  const client = await pool.connect();

  try {
    // 1. Obtener los códigos de diagnóstico disparadores de la BD
    console.log("Cargando paquete_grupo_dx...");
    const { rows: disparadores } = await client.query(`
      SELECT pgd.id_paquete, pgd.codigo_cie10, p.nombre, p.edad_minima, p.edad_maxima
      FROM paquete_grupo_dx pgd
      JOIN paquete_definicion p ON p.id_paquete = pgd.id_paquete
    `);
    
    // Crear un mapa para búsqueda rápida: cie10 -> {id_paquete, min, max}
    const mapaDisparadores = {};
    for (const d of disparadores) {
      if (!mapaDisparadores[d.codigo_cie10]) {
        mapaDisparadores[d.codigo_cie10] = [];
      }
      mapaDisparadores[d.codigo_cie10].push(d);
    }
    
    console.log(`Cargados ${disparadores.length} códigos disparadores.`);

    // 2. Procesar CSVs
    const basePath = path.join(__dirname, 'datos');
    const files = ['NominalTrama202601.csv', 'NominalTrama202602.csv', 'NominalTrama202603.csv'];

    let csvCandidatos = [];
    let pacientesVistos = new Set();
    
    for (const f of files) {
      const fullPath = path.join(basePath, f);
      if (!fs.existsSync(fullPath)) {
        console.warn(`Archivo no encontrado: ${fullPath}`);
        continue;
      }

      console.log(`Parseando ${f}...`);
      const fileContent = fs.readFileSync(fullPath, 'utf8');
      const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true,
      });

      console.log(`  ${f} tiene ${records.length} registros.`);

      for (const row of records) {
        const codigo = (row['Codigo_Item'] || '').trim();
        const tipoDx = (row['Tipo_Diagnostico'] || '').trim();
        const paciente = (row['Id_Paciente'] || '').trim();
        const fecha = (row['Fecha_Atencion'] || '').trim();
        const edadReg = parseInt(row['Edad_Reg'] || '0', 10);
        
        if (['P', 'D'].includes(tipoDx) && mapaDisparadores[codigo]) {
          const paquetesPosibles = mapaDisparadores[codigo];
          for (const pq of paquetesPosibles) {
            let descartaPorEdad = false;
            if (pq.edad_minima && edadReg < pq.edad_minima) descartaPorEdad = true;
            if (pq.edad_maxima && edadReg > pq.edad_maxima) descartaPorEdad = true;
            
            if (!descartaPorEdad) {
               // Encontramos un candidato válido en el CSV
               const key = `${paciente}_${pq.id_paquete}`;
               if (!pacientesVistos.has(key)) {
                 pacientesVistos.add(key);
                 csvCandidatos.push({
                   paciente,
                   paquete: pq.id_paquete,
                   codigo,
                   tipoDx,
                   fecha,
                   edadReg,
                   file: f
                 });
               }
            }
          }
        }
      }
    }

    console.log(`\nCandidatos detectados en CSV: ${csvCandidatos.length} (únicos paciente+paquete)`);

    // 3. Revisar en BD
    let faltantes = 0;
    let encontrados = 0;
    console.log("\nRevisando si existen en la BD...");
    
    // Consultar todos los paquetes del 2026 en memoria para cruce súper rápido
    const { rows: dbs } = await client.query(`
      SELECT id_paciente, id_paquete 
      FROM paquete_paciente 
      WHERE EXTRACT(YEAR FROM fecha_inicio) = 2026
    `);
    
    const dbSet = new Set(dbs.map(d => `${d.id_paciente}_${d.id_paquete}`));

    let detalleFaltantes = {};

    for (const c of csvCandidatos) {
      const key = `${c.paciente}_${c.paquete}`;
      if (dbSet.has(key)) {
        encontrados++;
      } else {
        faltantes++;
        if (!detalleFaltantes[c.paquete]) detalleFaltantes[c.paquete] = 0;
        detalleFaltantes[c.paquete]++;
        
        if (faltantes <= 10) {
            console.log(` - Faltante: Paciente ${c.paciente} / Paquete ${c.paquete} / Dx ${c.codigo} (${c.tipoDx}) / Fecha: ${c.fecha} / Edad: ${c.edadReg} / Archivo: ${c.file}`);
        }
      }
    }

    console.log(`\nResumen del cruce:`);
    console.log(` - CSV detecta que deben crearse: ${csvCandidatos.length}`);
    console.log(` - De ellos existen en BD 2026: ${encontrados}`);
    console.log(` - Faltantes en BD: ${faltantes}`);
    
    if (faltantes > 0) {
        console.log(`\nDesglose de faltantes por paquete:`);
        console.table(detalleFaltantes);
        
        console.log(`\nAviso: ¿Se cargaron estos pacientes a Maestro_Paciente?`);
        // Checar los primeros faltantes si existen en paciente
        const idsPrimeros = csvCandidatos.filter(c => !dbSet.has(`${c.paciente}_${c.paquete}`)).slice(0, 20).map(c => c.paciente);
        if (idsPrimeros.length > 0) {
            const { rows: pacs } = await client.query(`SELECT id_paciente FROM paciente WHERE id_paciente = ANY($1)`, [idsPrimeros]);
            const pacsSet = new Set(pacs.map(p => p.id_paciente));
            console.log(`De los primeros 20 pacientes faltantes, ${pacsSet.size} existen en la tabla 'paciente'.`);
            const noExisten = idsPrimeros.filter(id => !pacsSet.has(id));
            if (noExisten.length > 0) {
                console.log(`No existen en 'paciente': `, [...new Set(noExisten)].slice(0, 5), '...');
            }
        }
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    client.release();
    pool.end();
  }
}

analyze();
