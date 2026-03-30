const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    const { rows: misses } = await pool.query(`
      SELECT DISTINCT p.id_paciente, p.numero_documento, p.fecha_nacimiento, a.fecha_atencion, a.codigo_item, EXTRACT(YEAR FROM AGE(a.fecha_atencion, p.fecha_nacimiento))::INT AS edad_anos
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
    
    console.log("PF_REHAB_PSICOSOCIAL misses detailed:");
    for (const m of misses) {
      console.log(m);

      const { rows: prevOpened } = await pool.query(`
        SELECT id, fecha_inicio, estado FROM paquete_paciente 
        WHERE id_paquete = 'PF_REHAB_PSICOSOCIAL' AND id_paciente = $1
      `, [m.id_paciente]);
      console.log("Existing packages for patient:", prevOpened);

      const { rows: def } = await pool.query(`
        SELECT edad_minima, edad_maxima FROM paquete_definicion WHERE id_paquete = 'PF_REHAB_PSICOSOCIAL'
      `);
      console.log("Package config:", def[0]);
    }

  } catch(e) { console.error(e); } finally { pool.end(); }
}
run();
