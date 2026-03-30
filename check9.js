const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    const { rows } = await pool.query(`
      SELECT 
        id_paquete,
        estado,
        COUNT(*) as qty
      FROM paquete_paciente 
      WHERE EXTRACT(YEAR FROM fecha_inicio) = 2026
        AND id_paquete IN ('PF_PSICOSIS', 'PF_REHAB_PSICOSOCIAL', 'PF_TM_COMPORTAMIENTO')
      GROUP BY 1, 2 ORDER BY 1, 2
    `);
    console.table(rows);
  } catch(e) { console.error(e); } finally { pool.end(); }
}
run();
