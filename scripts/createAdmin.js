const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function createAdmin() {
  try {
    // 1. Crear tabla si no existe
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
          id SERIAL PRIMARY KEY,
          username VARCHAR(100) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          rol VARCHAR(20) DEFAULT 'admin',
          nombre_completo VARCHAR(150),
          activo BOOLEAN DEFAULT TRUE,
          creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Tabla usuarios lista.');

    // 2. Verificar si el admin ya existe
    const res = await pool.query('SELECT * FROM usuarios WHERE username = $1', ['PatrickIsla']);
    if (res.rows.length > 0) {
      console.log('El usuario "PatrickIsla" ya existe. No se hicieron cambios.');
      return;
    }

    // 3. Crear usuario
    const passwordHash = await bcrypt.hash('Grms0110*', 10);
    await pool.query(
      'INSERT INTO usuarios (username, password_hash, rol, nombre_completo) VALUES ($1, $2, $3, $4)',
      ['PatrickIsla', passwordHash, 'admin', 'Patrick Isla']
    );

    console.log('Usuario "PatrickIsla" creado con éxito. Contraseña: "Grms0110*"');
  } catch (err) {
    console.error('Error creando admin:', err);
  } finally {
    await pool.end();
  }
}

createAdmin();
