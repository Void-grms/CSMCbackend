const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    const { rows } = await pool.query(`
      SELECT pp.id_paquete, COUNT(DISTINCT pp.id_paciente) as missing_in_excel
      FROM paquete_paciente pp
      JOIN atencion a ON a.id_paciente = pp.id_paciente 
                 AND a.fecha_atencion >= '2026-01-01' 
                 AND a.fecha_atencion <= '2026-12-31'
                 AND a.tipo_diagnostico IN ('P','D')
                 AND a.codigo_item IN (SELECT codigo_cie10 FROM paquete_grupo_dx WHERE id_paquete = pp.id_paquete)
      WHERE pp.id_paquete = 'PF_REHAB_PSICOSOCIAL'
        AND EXTRACT(YEAR FROM pp.fecha_inicio) = 2025
      GROUP BY 1
    `);
    console.table(rows);
  } catch(e) { console.error(e); } finally { pool.end(); }
}
run();
