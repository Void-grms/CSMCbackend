const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    const { rows } = await pool.query(`
      SELECT pp.id_paquete, COUNT(DISTINCT pp.id_paciente) as patients_con_atencion_en_2026_pero_paquete_2025
      FROM paquete_paciente pp
      JOIN atencion a ON a.id_paciente = pp.id_paciente 
                 AND a.fecha_atencion >= '2026-01-01' 
                 AND a.fecha_atencion <= '2026-12-31'
                 AND a.tipo_diagnostico IN ('P','D')
                 AND a.codigo_item LIKE ANY(ARRAY['F20%', 'F21%', 'F22%', 'F23%', 'F24%', 'F25%', 'F28%', 'F29%'])
      WHERE pp.id_paquete = 'PF_REHAB_PSICOSOCIAL'
        AND EXTRACT(YEAR FROM pp.fecha_inicio) = 2025
      GROUP BY 1
    `);
    console.table(rows);
  } catch(e) { console.error(e); } finally { pool.end(); }
}
run();
