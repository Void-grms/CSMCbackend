const jwt = require('jsonwebtoken');

// Clave secreta (debe coincidir con la usada en auth.js)
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_csmc_renacer_2026';

const verifyToken = (req, res, next) => {
  // Ignorar la propia ruta de login
  if (req.path === '/api/auth/login') {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Acceso denegado. Se requiere un token de sesión válido' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // Adjuntar info del usuario a la req para rutas posteriores
    next();
  } catch (err) {
    console.error('Error de token JWT:', err.message);
    res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
  }
};

module.exports = verifyToken;
