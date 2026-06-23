const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const migrations = [
  'schema.sql',
  'migration_usuarios.sql',
  'migration_v2.sql',
  'seed_paquetes.sql',
  'migration_v3_ajustes.sql',
  'migration_v4_farmacia.sql',
  'migration_v5_plazo_dias.sql',
  'migration_v6_correcciones_md_2026.sql'
];

/**
 * Devuelve TRUE si el módulo Ajustes ya está instalado y el admin pudo haber
 * editado el catálogo. En ese caso saltamos re-ejecutar seed_paquetes.sql
 * para no sobrescribir las ediciones del admin.
 */
async function ajustesYaInicializado(client) {
  try {
    const { rows } = await client.query(`
      SELECT to_regclass('public.paquete_version_actual') AS t
    `);
    if (!rows[0].t) return false;
    const { rows: rows2 } = await client.query(
      `SELECT 1 FROM paquete_version_actual LIMIT 1`
    );
    return rows2.length > 0;
  } catch {
    return false;
  }
}

async function runMigrations() {
  const client = await pool.connect();
  try {
    const omitirSeed = await ajustesYaInicializado(client);

    for (const file of migrations) {
      if (file === 'seed_paquetes.sql' && omitirSeed) {
        console.log(`⤳ ${file} omitido (catálogo ya inicializado vía Ajustes)`);
        continue;
      }
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
