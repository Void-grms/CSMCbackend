/**
 * server.js — Sistema de Monitoreo de Paquetes PP 0131
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Pool } = require('pg');
const cors = require('cors');

const {
  getDashboard,
  getDetalleAcpDashboard,
  getProximosAVencer,
  getAvancePaquete,
  getPaquetesPorPaciente,
  getPaquetesPorProfesional,
  getPaquetesPaginados,
} = require('../paquetes/resumenAvance');

const { cargarMaestro } = require('../importacion/cargarMaestros');
const { cargarNominaltrama } = require('../importacion/cargarNominaltrama');
const { calcularPaquetes } = require('../paquetes/calcularPaquetes');

const {
  getProduccionProfesional,
  getResumenProduccion,
  getProfesionales,
  getPaquetesCatalogo,
} = require('../reportes/produccionProfesional');

const { buscarPacienteDocumentos, generarConstanciaSimple } = require('../documentos/generarDocumentos');
const { generarPaqueteDocx } = require('../documentos/generarPaqueteDocx');
const { generarReporteAtenciones } = require('../documentos/generarReporteAtenciones');
const { verificarCodificacion, generarReporteCodificacion } = require('../documentos/verificarCodificacion');

const { getReporteHIS, generarExcelHIS } = require('../reportes/reporteHIS');
const { getReporteHISDiario, generarExcelHISDiario } = require('../reportes/reporteHISDiario');

const authRoutes = require('./auth');
const ajustesRoutes = require('./ajustes');
const farmaciaRoutes = require('./farmacia');
const salvavidasRoutes = require('./salvavidas');
const verifyToken = require('../middleware/authMiddleware');
const runMigrations = require('../db/migrate');

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

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

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

// ── Módulo Farmacia (lectura: todos; escritura: admin, controlado en el router) ──
app.use('/api/farmacia', farmaciaRoutes);

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

app.get('/api/dashboard/acp-detalle', async (req, res) => {
  try {
    const registros = await getDetalleAcpDashboard(req.query.anio, req.query.mes);
    res.json({ total: registros.length, registros });
  } catch (err) {
    console.error('Error /api/dashboard/acp-detalle:', err.message);
    res.status(400).json({ ok: false, error: err.message });
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
    const { periodo, anio, mes, tipo, dx, campoFecha, fechaDesde, fechaHasta, ordenDias } = req.query;
    const limite = safeInt(req.query.limite, 50);
    const offset = safeInt(req.query.offset, 0);

    const data = await getPaquetesPaginados({
      estado: estadoQuery,
      periodo,
      anio,
      mes,
      tipo,
      dx,
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

// Descargar el resumen del paquete en .docx (disponible para usuarios autenticados).
app.get('/api/paquetes/:id/documento', async (req, res) => {
  try {
    const result = await generarPaqueteDocx(req.params.id);
    if (!result) return res.status(404).json({ ok: false, error: 'Paquete no encontrado' });

    // Override del Content-Type (el middleware global pone application/json).
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.set('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
  } catch (err) {
    console.error(`Error /api/paquetes/${req.params.id}/documento:`, err.message);
    res.status(500).json({ ok: false, error: 'Error al generar el documento' });
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

    // Usar CASCADE para asegurar que no haya violaciones de llave foránea.
    // Las tablas farmacia_paciente_config y farmacia_dispensacion_nota se incluyen
    // explícitamente (también caerían por CASCADE): la config por paciente y las
    // notas manuales se reinician junto con los datos. farmacia_config_global NO se
    // toca: es preferencia del sistema, no datos de pacientes.
    await pool.query(`
      TRUNCATE TABLE
        atencion,
        paciente,
        profesional,
        registrador,
        paquete_paciente,
        historial_cargas,
        farmacia_paciente_config,
        farmacia_dispensacion_nota
      CASCADE;
    `);

    res.json({ ok: true, mensaje: 'Base de datos limpia y lista para nueva carga.' });
  } catch (err) {
    console.error('Error /api/database/limpiar:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ENDPOINT 10C — Periodos cargados (meses con datos en `atencion`)
// ═════════════════════════════════════════════════════════════════════════════
// Lista los meses presentes en la tabla `atencion` para poder borrarlos de forma
// selectiva. Usa las columnas anio/mes (las mismas que trae cada nominaltrama).
app.get('/api/database/periodos', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        anio,
        mes,
        COUNT(*)::int                    AS atenciones,
        COUNT(DISTINCT id_cita)::int     AS citas,
        COUNT(DISTINCT id_paciente)::int AS pacientes
      FROM atencion
      WHERE anio IS NOT NULL AND mes IS NOT NULL
      GROUP BY anio, mes
      ORDER BY anio DESC, mes DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error /api/database/periodos:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ENDPOINT 10D — Borrar datos por periodo (mes)
// ═════════════════════════════════════════════════════════════════════════════
// Borra las atenciones de uno o varios meses (anio/mes) sin tocar los maestros
// (paciente/profesional/registrador), que pueden tener atenciones en otros meses.
// Las notas de farmacia caen por la FK ON DELETE CASCADE. Tras borrar se reconstruye
// `paquete_paciente` desde cero, porque calcularPaquetes es aditivo y no elimina los
// paquetes que quedarían huérfanos ni revierte estados.
app.delete('/api/database/limpiar-periodo', async (req, res) => {
  const { clave, periodos } = req.body || {};

  if (clave !== 'Grimes020110') {
    return res.status(401).json({ ok: false, error: 'Clave incorrecta' });
  }

  // Validar y normalizar la lista de periodos: [{ anio, mes }]
  if (!Array.isArray(periodos) || periodos.length === 0) {
    return res.status(400).json({ ok: false, error: 'Debes indicar al menos un periodo (anio/mes) a borrar.' });
  }

  const limpios = [];
  for (const p of periodos) {
    const anio = parseInt(p?.anio, 10);
    const mes = parseInt(p?.mes, 10);
    if (!Number.isInteger(anio) || anio < 1900 || anio > 2100 ||
        !Number.isInteger(mes) || mes < 1 || mes > 12) {
      return res.status(400).json({ ok: false, error: `Periodo inválido: ${JSON.stringify(p)}` });
    }
    limpios.push({ anio, mes });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Borrar atenciones de los periodos seleccionados (las notas de farmacia
    //    caen por CASCADE). Construimos un VALUES con los pares (anio, mes).
    const valores = [];
    const placeholders = limpios.map((p, i) => {
      valores.push(p.anio, p.mes);
      return `($${i * 2 + 1}::int, $${i * 2 + 2}::int)`;
    });

    const delAtenciones = await client.query(
      `DELETE FROM atencion
       WHERE (anio, mes) IN (${placeholders.join(', ')})`,
      valores
    );

    // 2. Borrar las filas de historial_cargas de esos nominaltrama (nominaltramaYYYYMM.csv)
    const archivos = limpios.map((p) => `nominaltrama${p.anio}${String(p.mes).padStart(2, '0')}.csv`);
    const delHistorial = await client.query(
      `DELETE FROM historial_cargas
       WHERE tipo = 'nominaltrama' AND lower(archivo) = ANY($1::text[])`,
      [archivos.map((a) => a.toLowerCase())]
    );

    // 3. Reconstruir paquete_paciente desde cero (calcularPaquetes es aditivo:
    //    sin este TRUNCATE quedarían paquetes huérfanos del periodo borrado).
    await client.query('TRUNCATE TABLE paquete_paciente CASCADE');

    await client.query('COMMIT');

    // 4. Recalcular paquetes con las atenciones restantes (fuera de la transacción;
    //    calcularPaquetes gestiona sus propias transacciones).
    let paquetesError = null;
    try {
      await calcularPaquetes();
    } catch (err) {
      paquetesError = err.message;
      console.error('⚠ Recálculo de paquetes tras borrado por periodo falló:', err.message);
    }

    res.json({
      ok: true,
      periodos: limpios,
      atenciones_borradas: delAtenciones.rowCount,
      cargas_borradas: delHistorial.rowCount,
      paquetes_recalculados: paquetesError === null,
      paquetes_error: paquetesError,
      mensaje: `Se borraron ${delAtenciones.rowCount} atenciones de ${limpios.length} periodo(s).`,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* noop */ }
    console.error('Error /api/database/limpiar-periodo:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ENDPOINT 10E — Recalcular paquetes (sin borrar atenciones)
// ═════════════════════════════════════════════════════════════════════════════
// Reconstruye `paquete_paciente` desde cero a partir de las atenciones ya cargadas
// y el catálogo ACTUAL. Útil tras actualizar el catálogo: aplica los cambios sin
// tener que borrar atenciones ni volver a subir los CSV. No toca `atencion`,
// `historial_cargas` ni los maestros.
app.post('/api/database/recalcular', async (req, res) => {
  const client = await pool.connect();
  try {
    // 1. Vaciar los paquetes derivados (calcularPaquetes es aditivo: sin este
    //    TRUNCATE quedarían paquetes con la versión vieja del catálogo).
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE paquete_paciente CASCADE');
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* noop */ }
    console.error('Error /api/database/recalcular (truncate):', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }

  // 2. Reconstruir paquetes con las atenciones restantes (operación aparte;
  //    calcularPaquetes gestiona sus propias transacciones).
  let contadores = null;
  let paquetesError = null;
  try {
    contadores = await calcularPaquetes();
  } catch (err) {
    paquetesError = err.message;
    console.error('⚠ Recálculo de paquetes falló:', err.message);
  }

  res.json({
    ok: paquetesError === null,
    contadores,
    paquetes_error: paquetesError,
    mensaje: paquetesError
      ? `El recálculo falló: ${paquetesError}`
      : 'Paquetes recalculados a partir de las atenciones cargadas.',
  });
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
      idPaquetes: req.query.idPaquetes,
      limite: safeInt(req.query.limite, 500),
      sinLimite: req.query.sinLimite === '1' || req.query.sinLimite === 'true',
    };
    const data = await getProduccionProfesional(filtros);
    res.json(data);
  } catch (err) {
    console.error('Error /api/reportes/produccion-profesional:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Resumen agregado por profesional (cantidad de atenciones), usa los mismos filtros.
app.get('/api/reportes/produccion-profesional/resumen', async (req, res) => {
  try {
    const filtros = {
      fechaInicio: req.query.fechaInicio,
      fechaFin: req.query.fechaFin,
      idProfesional: req.query.idProfesional,
      qPaciente: req.query.qPaciente,
      codigoItem: req.query.codigoItem,
      idPaquetes: req.query.idPaquetes,
    };
    const data = await getResumenProduccion(filtros);
    res.json(data);
  } catch (err) {
    console.error('Error /api/reportes/produccion-profesional/resumen:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Catálogo ligero de paquetes para el selector del reporte (sin auth admin).
app.get('/api/reportes/paquetes-catalogo', async (req, res) => {
  try {
    const data = await getPaquetesCatalogo();
    res.json(data);
  } catch (err) {
    console.error('Error /api/reportes/paquetes-catalogo:', err.message);
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

// ═════════════════════════════════════════════════════════════════════════════
// ENDPOINT 12 — Módulo de Documentos (solo administrador)
// ═════════════════════════════════════════════════════════════════════════════

/** Middleware: restringe el acceso a usuarios con rol 'admin' */
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.rol !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Acceso restringido a administradores' });
  }
  next();
};

// ── Módulo Ajustes (admin) ──
app.use('/api/ajustes', requireAdmin, ajustesRoutes);

// ── Módulo Salvavidas (admin) ──
app.use('/api/salvavidas', requireAdmin, salvavidasRoutes);

// Buscar pacientes para el módulo de documentos
app.get('/api/documentos/buscar-paciente', requireAdmin, async (req, res) => {
  const q = (req.query.q ?? '').trim();
  if (!q) return res.status(400).json({ ok: false, error: 'Parámetro q requerido' });

  try {
    const data = await buscarPacienteDocumentos(q);
    res.json(data);
  } catch (err) {
    console.error('Error /api/documentos/buscar-paciente:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Generar constancia simple (.docx)
app.get('/api/documentos/constancia-simple/:pacienteId', requireAdmin, async (req, res) => {
  try {
    const result = await generarConstanciaSimple(req.params.pacienteId);

    if (!result) {
      return res.status(404).json({ ok: false, error: 'Paciente no encontrado' });
    }

    // Override del Content-Type (el middleware global pone application/json)
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.set('Content-Disposition', `attachment; filename="constancia_${result.dni}.docx"`);
    res.send(result.buffer);
  } catch (err) {
    console.error('Error /api/documentos/constancia-simple:', err.message);
    res.status(500).json({ ok: false, error: 'Error al generar el documento' });
  }
});

// Reporte de atenciones de varios pacientes (.docx)
app.post('/api/documentos/reporte-atenciones', requireAdmin, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) {
      return res.status(400).json({ ok: false, error: 'Debe enviar al menos un paciente.' });
    }

    const result = await generarReporteAtenciones(ids);
    if (!result) {
      return res.status(404).json({ ok: false, error: 'No se encontraron pacientes válidos.' });
    }

    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.set('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
  } catch (err) {
    console.error('Error /api/documentos/reporte-atenciones:', err.message);
    res.status(500).json({ ok: false, error: 'Error al generar el reporte' });
  }
});

// Verificación de codificación de usuarios nuevos (datos para la tabla en pantalla)
app.get('/api/documentos/verificacion-codificacion', requireAdmin, async (req, res) => {
  try {
    const anio = safeInt(req.query.anio, null);
    const mes = safeInt(req.query.mes, null);
    if (!anio || !mes) {
      return res.status(400).json({ ok: false, error: 'Parámetros anio y mes requeridos.' });
    }
    const data = await verificarCodificacion({ anio, mes });
    res.json(data);
  } catch (err) {
    console.error('Error /api/documentos/verificacion-codificacion:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Verificación de codificación de usuarios nuevos (.docx descargable)
app.get('/api/documentos/verificacion-codificacion/descargar', requireAdmin, async (req, res) => {
  try {
    const anio = safeInt(req.query.anio, null);
    const mes = safeInt(req.query.mes, null);
    if (!anio || !mes) {
      return res.status(400).json({ ok: false, error: 'Parámetros anio y mes requeridos.' });
    }
    const result = await generarReporteCodificacion({ anio, mes });
    if (!result) {
      return res.status(404).json({ ok: false, error: 'No hay usuarios nuevos en el periodo seleccionado.' });
    }
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.set('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
  } catch (err) {
    console.error('Error /api/documentos/verificacion-codificacion/descargar:', err.message);
    res.status(500).json({ ok: false, error: 'Error al generar el reporte' });
  }
});

// Actualizar domicilio del paciente
app.put('/api/pacientes/:id/domicilio', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { domicilio } = req.body;

  if (!domicilio || !domicilio.trim()) {
    return res.status(400).json({ ok: false, error: 'El domicilio es requerido' });
  }

  try {
    const result = await pool.query(
      'UPDATE paciente SET domicilio_declarado = $1, fecha_modificacion = NOW() WHERE id_paciente = $2',
      [domicilio.trim(), id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Paciente no encontrado' });
    }

    res.json({ ok: true, mensaje: 'Domicilio actualizado correctamente' });
  } catch (err) {
    console.error(`Error /api/pacientes/${id}/domicilio:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ENDPOINT 13 — Reporte de Producción HIS (solo administrador)
// ═════════════════════════════════════════════════════════════════════════════

// 13a. Datos JSON (previsualización en tabla)
app.get('/api/documentos/reporte-his', requireAdmin, async (req, res) => {
  const { id_personal, fecha_inicio, fecha_fin } = req.query;

  if (!id_personal || !fecha_inicio || !fecha_fin) {
    return res.status(400).json({
      ok: false,
      error: 'Se requieren: id_personal, fecha_inicio y fecha_fin (YYYY-MM-DD).',
    });
  }

  try {
    const datos = await getReporteHIS(id_personal, fecha_inicio, fecha_fin);
    res.json({ ok: true, datos });
  } catch (err) {
    console.error('Error /api/documentos/reporte-his:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 13b. Exportación Excel (.xlsx)
app.get('/api/documentos/reporte-his/exportar', requireAdmin, async (req, res) => {
  const { id_personal, fecha_inicio, fecha_fin } = req.query;

  if (!id_personal || !fecha_inicio || !fecha_fin) {
    return res.status(400).json({
      ok: false,
      error: 'Se requieren: id_personal, fecha_inicio y fecha_fin (YYYY-MM-DD).',
    });
  }

  try {
    const { buffer, filename } = await generarExcelHIS(
      id_personal,
      fecha_inicio,
      fecha_fin
    );

    // Override del Content-Type (el middleware global pone application/json)
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Error /api/documentos/reporte-his/exportar:', err.message);
    res.status(500).json({ ok: false, error: 'Error al generar el reporte Excel' });
  }
});

// 13c. Datos JSON (previsualización en tabla) - Diario
app.get('/api/documentos/reporte-his-diario', requireAdmin, async (req, res) => {
  const { id_personal, fecha_inicio } = req.query;

  if (!id_personal || !fecha_inicio) {
    return res.status(400).json({
      ok: false,
      error: 'Se requieren: id_personal y fecha_inicio (YYYY-MM-DD).',
    });
  }

  // Validar formato de fecha
  if (isNaN(new Date(fecha_inicio).getTime())) {
    return res.status(400).json({
      ok: false,
      error: 'fecha_inicio debe ser una fecha válida (YYYY-MM-DD).',
    });
  }

  try {
    const datos = await getReporteHISDiario(id_personal, fecha_inicio);
    res.json({ ok: true, datos });
  } catch (err) {
    console.error('Error /api/documentos/reporte-his-diario:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 13d. Exportación Excel (.xlsx) - Diario
app.get('/api/documentos/reporte-his-diario/exportar', requireAdmin, async (req, res) => {
  const { id_personal, fecha_inicio } = req.query;

  if (!id_personal || !fecha_inicio) {
    return res.status(400).json({
      ok: false,
      error: 'Se requieren: id_personal y fecha_inicio (YYYY-MM-DD).',
    });
  }

  if (isNaN(new Date(fecha_inicio).getTime())) {
    return res.status(400).json({
      ok: false,
      error: 'fecha_inicio debe ser una fecha válida (YYYY-MM-DD).',
    });
  }

  try {
    const { buffer, filename } = await generarExcelHISDiario(
      id_personal,
      fecha_inicio
    );

    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Error /api/documentos/reporte-his-diario/exportar:', err.message);
    res.status(500).json({ ok: false, error: 'Error al generar el reporte Excel Diario' });
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
app.get('/{*path}', (req, res, next) => {
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

/**
 * Función de cierre ordenado para liberar recursos.
 */
const shutdown = async (signal, server) => {
  console.log(`\n⚠️  ${signal} recibido. Cerrando...`);
  if (server) {
    server.close(async () => {
      await pool.end();
      console.log('✔ Servidor detenido y pool de base de datos cerrado.');
      process.exit(0);
    });
  } else {
    await pool.end();
    process.exit(0);
  }
};

// ── Arrancar servidor ─────────────────────────────────────────────────────────
runMigrations()
  .then(() => {
    const server = app.listen(PORT, () => {
      console.log(`\n🚀 Servidor corriendo en http://localhost:${PORT}\n`);
      console.log('   APIs listas para recibir peticiones.');
    });

    // Escuchar señales de terminación
    process.on('SIGTERM', () => shutdown('SIGTERM', server));
    process.on('SIGINT',  () => shutdown('SIGINT',  server));
  })
  .catch((err) => {
    console.error('\n✖ ERROR FATAL AL INICIAR EL SERVIDOR:');
    console.error(`  ${err.message}\n`);
    console.error('  Verifica que DATABASE_URL sea correcta y');
    console.error('  que la base de datos PostgreSQL esté activa.');
    process.exit(1);
  });

module.exports = app;
