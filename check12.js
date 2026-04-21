const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  try {
    const {rows} = await pool.query(`
      SELECT id_paquete, estado, COUNT(*) 
      FROM paquete_paciente 
      WHERE EXTRACT(YEAR FROM fecha_inicio)=2026
      GROUP BY 1,2 
      ORDER BY 1,2
    `);
    console.table(rows);
  } catch(e) { console.error(e); } finally { pool.end(); }
}
check();
