-- Migración para el sistema de autenticación

CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    rol VARCHAR(20) DEFAULT 'admin',
    nombre_completo VARCHAR(150),
    activo BOOLEAN DEFAULT TRUE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Nota: El primer usuario 'admin' será creado usando el script de Node.js `createAdmin.js` 
-- para asegurar que la contraseña tenga el hash correcto de bcrypt.
