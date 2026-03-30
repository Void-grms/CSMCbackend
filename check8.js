const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT p.numero_documento, a.fecha_atencion, a.codigo_item
      FROM atencion a
      JOIN paciente p ON p.id_paciente = a.id_paciente
      JOIN paquete_grupo_dx pgd ON pgd.codigo_cie10 = a.codigo_item
      WHERE pgd.id_paquete = 'PF_REHAB_PSICOSOCIAL'
        AND a.fecha_atencion >= '2026-01-01'
        AND a.tipo_diagnostico IN ('P', 'D')
        AND a.id_paciente NOT IN (
          SELECT id_paciente FROM paquete_paciente 
          WHERE id_paquete = 'PF_REHAB_PSICOSOCIAL' 
            AND EXTRACT(YEAR FROM fecha_inicio) = 2026
        )
      ORDER BY a.fecha_atencion
    `);
    console.log("PF_REHAB_PSICOSOCIAL misses", rows.length);
  } catch(e) { console.error(e); } finally { pool.end(); }
}
run();
