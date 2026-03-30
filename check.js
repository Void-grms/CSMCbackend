const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    const { rows: paquetes } = await pool.query(`
      SELECT pd.nombre, COUNT(pp.id) as total 
      FROM paquete_definicion pd 
      LEFT JOIN paquete_paciente pp ON pp.id_paquete = pd.id_paquete 
      GROUP BY pd.nombre ORDER BY pd.nombre
    `);
    console.table(paquetes);

    const { rows: missingDx } = await pool.query(`
      SELECT codigo_item, COUNT(*) as qty 
      FROM atencion 
      WHERE (codigo_item LIKE 'F21%' OR codigo_item LIKE 'F03%' OR codigo_item LIKE 'F29%' OR codigo_item LIKE 'F24%' OR codigo_item LIKE 'F28%') 
      GROUP BY codigo_item ORDER BY qty DESC
    `);
    console.log("F21X, F28X, F29X in DB:", missingDx);
  } catch(e) { console.error(e); } finally { pool.end(); }
}
run();
