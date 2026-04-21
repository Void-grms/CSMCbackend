require('dotenv').config();
const {Pool} = require('pg');
const pool = new Pool({connectionString: process.env.DATABASE_URL});

pool.query("SELECT COUNT(*) FROM atencion WHERE id_actividad ILIKE 'APP%'")
  .then(res => console.log(res.rows))
  .catch(console.error)
  .finally(() => pool.end());
