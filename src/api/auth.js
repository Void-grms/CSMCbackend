const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  client_encoding: 'utf8',
});

// Clave secreta para JWT (idealmente en .env)
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_csmc_renacer_2026';

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/auth/login
// ═════════════════════════════════════════════════════════════════════════════
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'Usuario y contraseña son requeridos' });
    }

    // Buscar usuario en la base de datos
    const userRes = await pool.query('SELECT * FROM usuarios WHERE username = $1 AND activo = TRUE', [username]);
    
    if (userRes.rows.length === 0) {
      return res.status(401).json({ ok: false, error: 'Credenciales inválidas o usuario inactivo' });
    }

    const user = userRes.rows[0];

    // Verificar contraseña
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
    }

    // Generar Token JWT
    const token = jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        rol: user.rol 
      },
      JWT_SECRET,
      { expiresIn: '8h' } // Expira en 8 horas
    );

    res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        nombre_completo: user.nombre_completo,
        rol: user.rol
      }
    });

  } catch (err) {
    console.error('Error /api/auth/login:', err.message);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/auth/me - Verifica el token actual y devuelve al usuario
// ═════════════════════════════════════════════════════════════════════════════
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ ok: false, error: 'No autorizado. Se requiere token.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    // Buscar que el usuario todavía exista y esté activo
    const userRes = await pool.query('SELECT id, username, rol, nombre_completo, activo FROM usuarios WHERE id = $1', [decoded.id]);
    
    if (userRes.rows.length === 0 || !userRes.rows[0].activo) {
      return res.status(401).json({ ok: false, error: 'Usuario ya no existe o está inactivo' });
    }

    const user = userRes.rows[0];

    res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        nombre_completo: user.nombre_completo,
        rol: user.rol
      }
    });
  } catch (err) {
    console.error('Error /api/auth/me:', err.message);
    res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
  }
});

module.exports = router;
