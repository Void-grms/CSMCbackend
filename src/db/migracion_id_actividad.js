/**
 * Migración: agregar columna id_actividad a la tabla atencion.
 * Ejecutar una sola vez: node src/db/migracion_id_actividad.js
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  client_encoding: 'utf8',
});

async function migrar() {
  const client = await pool.connect();
  try {
    console.log('▶ Ejecutando migración: agregar id_actividad a atencion...\n');

    await client.query(`
      ALTER TABLE atencion
        ADD COLUMN IF NOT EXISTS id_actividad TEXT;
    `);
    console.log('  ✔ Columna id_actividad agregada (o ya existía).');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_atencion_id_actividad
        ON atencion(id_actividad);
    `);
    console.log('  ✔ Índice idx_atencion_id_actividad creado (o ya existía).');

    console.log('\n✔ Migración completada exitosamente.');
  } catch (err) {
    console.error(`✖ Error en migración: ${err.message}`);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrar();
