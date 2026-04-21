const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    const { rows } = await pool.query(`
      SELECT COUNT(DISTINCT a.id_paciente) as patients_only_R
      FROM atencion a
      JOIN paquete_grupo_dx pgd ON pgd.codigo_cie10 = a.codigo_item
      WHERE pgd.id_paquete = 'PF_PSICOSIS'
        AND a.fecha_atencion >= '2026-01-01'
        AND a.id_paciente NOT IN (
          SELECT id_paciente FROM atencion 
          WHERE fecha_atencion >= '2026-01-01' 
            AND tipo_diagnostico IN ('P', 'D')
            AND codigo_item IN (SELECT codigo_cie10 FROM paquete_grupo_dx WHERE id_paquete = 'PF_PSICOSIS')
        )
    `);
    console.table(rows);
  } catch(e) { console.error(e); } finally { pool.end(); }
}
run();
