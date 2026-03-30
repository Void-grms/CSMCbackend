const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const migrations = [
  'schema.sql',
  'migration_usuarios.sql',
  'migration_v2.sql',
  'seed_paquetes.sql'
];

async function runMigrations() {
  const client = await pool.connect();
  try {
    for (const file of migrations) {
      const filePath = path.join(__dirname, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      console.log(`Running: ${file}`);
      await client.query(sql);
      console.log(`✓ ${file} ejecutado`);
    }
  } catch (err) {
    console.error('Error en migración:', err.message);
  } finally {
    client.release();
  }
}

module.exports = runMigrations;