const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    const { rows } = await pool.query(`
      SELECT codigo_item, COUNT(DISTINCT id_paciente) as patients, COUNT(*) as qty
      FROM atencion
      WHERE codigo_item LIKE '%X'
      GROUP BY 1 ORDER BY 2 DESC
    `);
    console.table(rows);
    
    // Check if these missing 3 patients are due to F21X
    const { rows: test2 } = await pool.query(`
      SELECT COUNT(DISTINCT a.id_paciente) as p
      FROM atencion a
      WHERE a.tipo_diagnostico IN ('P', 'D')
      AND (a.codigo_item IN ('F21X', 'F24X', 'F28X', 'F29X'))
      AND EXTRACT(YEAR FROM a.fecha_atencion) = 2026
    `);
    console.log("Patients in 2026 with missing F-codes (that used to be in PF_REHAB_PSICOSOCIAL):", test2[0].p);
    
  } catch(e) { console.error(e); } finally { pool.end(); }
}
run();
