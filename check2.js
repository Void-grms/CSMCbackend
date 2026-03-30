const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    const { rows } = await pool.query(`
      SELECT id_paquete, EXTRACT(YEAR FROM fecha_inicio) as anio, COUNT(*) as qty,
             COUNT(*) FILTER (WHERE estado='abierto') as abiertos
      FROM paquete_paciente
      WHERE id_paquete IN ('PF_REHAB_PSICOSOCIAL', 'PF_TM_COMPORTAMIENTO', 'PF_PSICOSIS')
      GROUP BY 1, 2 ORDER BY 1, 2
    `);
    console.table(rows);
  } catch(e) { console.error(e); } finally { pool.end(); }
}
run();
