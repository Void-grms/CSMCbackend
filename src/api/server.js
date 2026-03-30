/**
 * server.js — Sistema de Monitoreo de Paquetes PP 0131
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Pool } = require('pg');

const {
  getDashboard,
  getProximosAVencer,
  getAvancePaquete,
  getPaquetesPorPaciente,
  getPaquetesPorProfesional,
  getPaquetesPaginados,
} = require('../paquetes/resumenAvance');

const { cargarMaestro } = require('../importacion/cargarMaestros');
const { cargarNominaltrama } = require('../importacion/cargarNominaltrama');

const { getProduccionProfesional, getProfesionales } = require('../reportes/produccionProfesional');

const authRoutes = require('./auth');
const verifyToken = require('../middleware/authMiddleware');

// ── Configuración ─────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  client_encoding: 'utf8',
});
pool.on('error', (err) => console.error('⚠️  Pool error:', err.message));

const app = express();

// ── Helpers ───────────────────────────────────────────────────────────────────
const safeInt = (val, fallback) => {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : fallback;
};

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.set('etag', false);

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Content-Type', 'application/json; charset=utf-8');
  next();
});

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    const cod = res.statusCode;
    const color = cod >= 500 ? '\x1b[31m' : cod >= 400 ? '\x1b[33m' : '\x1b[32m';
    console.log(`  ${req.method} ${req.originalUrl} → ${color}${cod}\x1b[0m (${Date.now() - t0}ms)`);
  });
  next();
});

app.use(express.static(path.join(__dirname, '..', '..', 'public')));

// ── Multer ────────────────────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, file.originalname),
});

const csvFilter = (req, file, cb) => {
  const ok =
    file.mimetype === 'text/csv' ||
    file.mimetype === 'application/vnd.ms-excel' ||
    file.originalname.toLowerCase().endsWith('.csv');
  ok
    ? cb(null, true)
    : cb(new Error(`Tipo no permitido: "${file.originalname}". Solo .csv`));
};

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 }, fileFilter: csvFilter });

// ═════════════════════════════════════════════════════════════════════════════
// RUTAS DE AUTENTICACIÓN Y PROTECCIÓN
// ═════════════════════════════════════════════════════════════════════════════
app.use('/api/auth', authRoutes);

// Proteger todas las rutas /api restantes
app.use('/api', verifyToken);

// ═════════════════════════════════════════════════════════════════════════════
// ENDPOINT 1 — Dashboard
// ═════════════════════════════════════════════════════════════════════════════
app.get('/api/dashboard', async (req, res) => {
  try {
    const anio = req.query.anio;
    res.json(await getDashboard(anio));
  } catch (err) {
    console.error('Error /api/dashboard:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ENDPOINT 2 — Próximos a vencer
// ═════════════════════════════════════════════════════════════════════════════
app.get('/api/paquetes/proximos-a-vencer', async (req, res) => {
  try {
    const dias = safeInt(req.query.dias, 30);
    res.json(await getProximosAVencer(dias));
  } catch (err) {
    console.error('Error /api/paquetes/proximos-a-vencer:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ENDPOINT 3 — Lista de paquetes con filtros
// GET /api/paquetes?estado=abierto&periodo=2026-02&limite=50&offset=0
// ═════════════════════════════════════════════════════════════════════════════
app.get('/api/paquetes', async (req, res) => {
  try {
    // Si estado='todos', pasamos undefined para que no filtre
    const estadoQuery = req.query.estado === 'todos' ? undefined : req.query.estado;
    const { periodo, tipo, campoFecha, fechaDesde, fechaHasta, ordenDias } = req.query;
    const limite = safeInt(req.query.limite, 50);
    const offset = safeInt(req.query.offset, 0);

    const data = await getPaquetesPaginados({
      estado: estadoQuery,
      periodo,
      tipo,
      campoFecha,
      fechaDesde,
      fechaHasta,
      ordenDias,
      limite,
      offset
    });
    res.json(data);
  } catch (err) {
    console.error('Error /api/paquetes:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ENDPOINT 4 — Detalle de un paquete
// ═════════════════════════════════════════════════════════════════════════════
app.get('/api/paquetes/:id', async (req, res) => {
  try {
    const data = await getAvancePaquete(req.params.id);
    if (!data) return res.status(404).json({ ok: false, error: 'Paquete no encontrado' });
    res.json(data);
  } catch (err) {
    console.error(`Error /api/paquetes/${req.params.id}:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ENDPOINT 5 — Buscar pacientes por DNI o nombre
// IMPORTANTE: debe ir ANTES de /api/pacientes/:id/paquetes
// ═════════════════════════════════════════════════════════════════════════════
app.get('/api/pacientes/buscar', async (req, res) => {
  const q = (req.query.q ?? '').trim();
  if (!q) return res.status(400).json({ ok: false, error: 'Parámetro q requerido' });

  try {
    const termino = `%${q}%`;
    const { rows } = await pool.query(
      `SELECT
         id_paciente,
         numero_documento,
         apellido_paterno,
         apellido_materno,
         nombres,
         fecha_nacimiento,
         historia_clinica
       FROM paciente
       WHERE numero_documento ILIKE $1
          OR apellido_paterno  ILIKE $1
          OR apellido_materno  ILIKE $1
          OR nombres           ILIKE $1
          OR CONCAT(apellido_paterno, ' ', apellido_materno, ' ', nombres) ILIKE $1
       ORDER BY apellido_paterno, apellido_materno, nombres
       LIMIT 30`,
      [termino]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error /api/pacientes/buscar:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ENDPOINT 6 — Paquetes de un paciente
// ═════════════════════════════════════════════════════════════════════════════
app.get('/api/pacientes/:id/paquetes', async (req, res) => {
  try {
    const data = await getPaquetesPorPaciente(req.params.id);
    res.json(Array.isArray(data) ? data : []);
  } catch (err) {
    console.error(`Error /api/pacientes/${req.params.id}/paquetes:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ENDPOINT 7 — Paquetes de un profesional
// ═════════════════════════════════════════════════════════════════════════════
app.get('/api/profesional/:id/paquetes', async (req, res) => {
  try {
    const data = await getPaquetesPorProfesional(req.params.id);
    res.json(Array.isArray(data) ? data : []);
  } catch (err) {
    console.error(`Error /api/profesional/${req.params.id}/paquetes:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ENDPOINT 8 — Importar maestros CSV
// ═════════════════════════════════════════════════════════════════════════════
app.post('/api/importar/maestros', upload.single('archivo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No se recibió archivo. Usa el campo "archivo".' });
  }
  const ruta = req.file.path;
  try {
    res.json({ ok: true, resumen: await cargarMaestro(ruta) });
  } catch (err) {
    console.error('Error /api/importar/maestros:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    try { fs.unlinkSync(ruta); } catch (_) { }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ENDPOINT 9 — Importar nominaltrama CSV
// ═════════════════════════════════════════════════════════════════════════════
const NOMBRE_NOMINALTRAMA_RE = /^nominaltrama\d{6}\.csv$/i;

app.post('/api/importar/nominaltrama', upload.single('archivo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No se recibió archivo. Usa el campo "archivo".' });
  }
  const ruta = req.file.path;
  const nombre = req.file.originalname;

  if (!NOMBRE_NOMINALTRAMA_RE.test(nombre)) {
    try { fs.unlinkSync(ruta); } catch (_) { }
    return res.status(400).json({
      ok: false,
      error: `Nombre inválido: "${nombre}". Se esperaba nominaltramaYYYYMM.csv (ej: nominaltrama202602.csv).`,
    });
  }

  try {
    res.json({ ok: true, resumen: await cargarNominaltrama(ruta) });
  } catch (err) {
    console.error('Error /api/importar/nominaltrama:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    try { fs.unlinkSync(ruta); } catch (_) { }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ENDPOINT 10 — Historial de cargas
// ═════════════════════════════════════════════════════════════════════════════
app.get('/api/historial-cargas', async (req, res) => {
  try {
    const limite = safeInt(req.query.limite, 50);
    const { rows } = await pool.query(
      `SELECT id, archivo, tipo, fecha, registros_procesados, usuario
       FROM historial_cargas
       ORDER BY fecha DESC
       LIMIT $1`,
      [limite]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error /api/historial-cargas:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ENDPOINT 10B — Limpiar Base de Datos
// ═════════════════════════════════════════════════════════════════════════════
app.delete('/api/database/limpiar', async (req, res) => {
  try {
    const { clave } = req.body;
    if (clave !== 'Grimes020110') {
      return res.status(401).json({ ok: false, error: 'Clave incorrecta' });
    }

    // Usar CASCADE para asegurar que no haya violaciones de llave foránea
    await pool.query(`
      TRUNCATE TABLE 
        atencion, 
        paciente, 
        profesional, 
        registrador, 
        paquete_paciente, 
        historial_cargas
      CASCADE;
    `);

    res.json({ ok: true, mensaje: 'Base de datos limpia y lista para nueva carga.' });
  } catch (err) {
    console.error('Error /api/database/limpiar:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ENDPOINT 11 — Reporte de Producción por Profesional
// ═════════════════════════════════════════════════════════════════════════════
app.get('/api/reportes/produccion-profesional', async (req, res) => {
  try {
    const filtros = {
      fechaInicio: req.query.fechaInicio,
      fechaFin: req.query.fechaFin,
      idProfesional: req.query.idProfesional,
      qPaciente: req.query.qPaciente,
      codigoItem: req.query.codigoItem,
      limite: safeInt(req.query.limite, 500)
    };
    const data = await getProduccionProfesional(filtros);
    res.json(data);
  } catch (err) {
    console.error('Error /api/reportes/produccion-profesional:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/profesionales', async (req, res) => {
  try {
    const data = await getProfesionales();
    res.json(data);
  } catch (err) {
    console.error('Error /api/profesionales:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Manejador global de errores Multer ────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ ok: false, error: `Error de carga: ${err.message}` });
  }
  if (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
  next();
});

// ── SPA Fallback ──────────────────────────────────────────────────────────────
app.get(/(.*)/, (req, res, next) => {
  if (req.originalUrl.startsWith('/api')) return next();
  const indexPath = path.join(__dirname, '..', '..', 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    next();
  }
});

// ── 404 API ───────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Endpoint no encontrado: ${req.method} ${req.originalUrl}` });
});

// ── Arrancar servidor ─────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`\n🚀 Servidor corriendo en http://localhost:${PORT}\n`);
  console.log('   GET  /api/dashboard');
  console.log('   GET  /api/paquetes?estado=abierto&periodo=2026-02');
  console.log('   GET  /api/paquetes/proximos-a-vencer?dias=30');
  console.log('   GET  /api/paquetes/:id');
  console.log('   GET  /api/pacientes/buscar?q=dni_o_nombre');
  console.log('   GET  /api/pacientes/:id/paquetes');
  console.log('   GET  /api/profesional/:id/paquetes');
  console.log('   POST /api/importar/maestros');
  console.log('   POST /api/importar/nominaltrama');
  console.log('   GET  /api/historial-cargas\n');
});

// ── Cierre ordenado ───────────────────────────────────────────────────────────
const shutdown = async (signal) => {
  console.log(`\n⚠️  ${signal} recibido. Cerrando...`);
  server.close(async () => {
    await pool.end();
    console.log('✔ Servidor detenido.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;