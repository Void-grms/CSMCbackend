require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const { rows } = await pool.query("SELECT * FROM paquete_paciente WHERE id_paciente='1063030836275'");
  console.log("Paquetes del paciente:", rows);
  
  const { rows: atenciones } = await pool.query("SELECT fecha_atencion, codigo_item, tipo_diagnostico FROM atencion WHERE id_paciente='1063030836275' ORDER BY fecha_atencion");
  console.log("Atenciones del paciente:", atenciones);
  pool.end();
}
check();
