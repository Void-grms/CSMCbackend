const { Pool } = require('pg');
require('dotenv').config();
const { calcularPaquetes } = require('./src/paquetes/calcularPaquetes');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function resetAndRun() {
  try {
    // 1. Borramos todos los paquetes que SÍ tienen un grupo_dx (que se auto abrieron)
    // O simplemente todo, ya que al importar vuelve a calcular.
    await pool.query(`DELETE FROM paquete_paciente`);
    console.log("Limpiados todos los paquetes_paciente en la BD.");

    // 2. Corremos calcularPaquetes
    await calcularPaquetes();
    
    // 3. Verificamos cómo quedó
    const { rows } = await pool.query(`
      SELECT EXTRACT(YEAR FROM fecha_inicio) as anio, estado, COUNT(*) 
      FROM paquete_paciente 
      GROUP BY 1, 2 ORDER BY 1, 2
    `);
    console.table(rows);

  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

resetAndRun();
