require('dotenv').config();
const {Pool} = require('pg');
const pool = new Pool({connectionString: process.env.DATABASE_URL});

pool.query("SELECT * FROM atencion WHERE id_paciente ILIKE 'APP%' OR codigo_item ILIKE 'APP%' OR id_cita ILIKE 'APP%' LIMIT 5")
  .then(res => console.log(res.rows))
  .catch(console.error)
  .finally(() => pool.end());
