const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  try {
    const {rows} = await pool.query(`
      SELECT estado, count(*) 
      FROM paquete_paciente 
      WHERE id_paquete = 'PF_PSICOSIS' 
      GROUP BY 1 
    `);
    console.table(rows);
  } catch(e) { console.error(e); } finally { pool.end(); }
}
check();
