const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    const { rows } = await pool.query(`
      SELECT 
        EXTRACT(YEAR FROM AGE(a.fecha_atencion, p.fecha_nacimiento))::INT AS edad,
        COUNT(DISTINCT a.id_paciente) as patients
      FROM atencion a
      JOIN paciente p ON p.id_paciente = a.id_paciente
      JOIN paquete_grupo_dx pgd ON pgd.codigo_cie10 = a.codigo_item
      WHERE pgd.id_paquete = 'PF_TM_COMPORTAMIENTO'
        AND a.fecha_atencion >= '2026-01-01'
        AND a.tipo_diagnostico IN ('P', 'D')
        AND EXTRACT(YEAR FROM AGE(a.fecha_atencion, p.fecha_nacimiento))::INT >= 18
      GROUP BY 1
    `);
    console.table(rows);
  } catch(e) { console.error(e); } finally { pool.end(); }
}
run();
