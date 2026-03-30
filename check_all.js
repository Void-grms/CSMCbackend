const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    const { rows } = await pool.query(`
      SELECT EXTRACT(YEAR FROM fecha_inicio) as anio, estado, COUNT(*) 
      FROM paquete_paciente 
      GROUP BY 1, 2 ORDER BY 1, 2
    `);
    console.table(rows);
    
    // Y veamos cuántos de cada estado hubo
    const r2 = await pool.query(`
      SELECT estado, count(*) FROM paquete_paciente GROUP BY estado
    `);
    console.table(r2.rows);

  } catch(e) { console.error(e); } finally { await pool.end(); }
}
run();
