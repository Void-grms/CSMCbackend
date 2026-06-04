/**
 * api/farmacia.js — Endpoints REST del módulo Farmacia.
 *
 * Se monta en server.js con:  app.use('/api/farmacia', farmaciaRoutes);
 * verifyToken ya aplica globalmente a /api, así que aquí req.user está disponible.
 *
 * Permisos:
 *   - Lectura (GET): cualquier usuario autenticado.
 *   - Escritura (PUT): solo rol 'admin' (middleware requireAdmin local).
 *
 * Rutas:
 *   GET /api/farmacia/resumen                                  conteos por estado
 *   GET /api/farmacia/pacientes?estado=&q=&incluirInactivos=   listado con estado
 *   GET /api/farmacia/pacientes/:id                            detalle + historial
 *   GET /api/farmacia/config                                   config global
 *   PUT /api/farmacia/config                                   [admin] editar config global
 *   PUT /api/farmacia/pacientes/:id/intervalo                  [admin] intervalo por paciente
 *   PUT /api/farmacia/dispensaciones/:idCita/:idCorrelativo/nota [admin] nota manual
 */

const express = require('express');
const farmacia = require('../farmacia/farmaciaService');

const router = express.Router();

// ── Middleware: restringe a administradores ───────────────────────────────────
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.rol !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Acceso restringido a administradores' });
  }
  next();
};

// ── Helpers de validación ─────────────────────────────────────────────────────
/** Convierte a entero dentro de [min, max]; devuelve null si no es válido. */
function intEnRango(valor, min, max) {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

// ═════════════════════════════════════════════════════════════════════════════
// LECTURA (todos los usuarios autenticados)
// ═════════════════════════════════════════════════════════════════════════════

// GET /resumen — conteos por estado para las tarjetas.
router.get('/resumen', async (req, res) => {
  try {
    res.json(await farmacia.getResumen());
  } catch (err) {
    console.error('Error GET /farmacia/resumen:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /pacientes — listado con estado calculado.
router.get('/pacientes', async (req, res) => {
  try {
    const data = await farmacia.getPacientes({
      estado: req.query.estado,
      q: req.query.q,
      incluirInactivos: req.query.incluirInactivos === '1' || req.query.incluirInactivos === 'true',
    });
    res.json(data);
  } catch (err) {
    console.error('Error GET /farmacia/pacientes:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /pacientes/:id — detalle + historial de entregas.
router.get('/pacientes/:id', async (req, res) => {
  try {
    const data = await farmacia.getPacienteDetalle(req.params.id);
    if (!data) return res.status(404).json({ ok: false, error: 'Paciente no encontrado' });
    res.json(data);
  } catch (err) {
    console.error('Error GET /farmacia/pacientes/:id:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /config — configuración global.
router.get('/config', async (req, res) => {
  try {
    res.json(await farmacia.getConfigGlobal());
  } catch (err) {
    console.error('Error GET /farmacia/config:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ESCRITURA (solo admin)
// ═════════════════════════════════════════════════════════════════════════════

// PUT /config — editar configuración global.
router.put('/config', requireAdmin, async (req, res) => {
  try {
    const { intervalo_default_dias, ventana_relevancia_dias, dias_aviso_previo } = req.body || {};

    // Validar solo los campos presentes (los ausentes no se tocan).
    const payload = {};
    const errores = [];

    if (intervalo_default_dias !== undefined) {
      const v = intEnRango(intervalo_default_dias, 1, 365);
      if (v === null) errores.push('intervalo_default_dias debe ser entero entre 1 y 365.');
      else payload.intervalo_default_dias = v;
    }
    if (ventana_relevancia_dias !== undefined) {
      const v = intEnRango(ventana_relevancia_dias, 1, 730);
      if (v === null) errores.push('ventana_relevancia_dias debe ser entero entre 1 y 730.');
      else payload.ventana_relevancia_dias = v;
    }
    if (dias_aviso_previo !== undefined) {
      const v = intEnRango(dias_aviso_previo, 0, 60);
      if (v === null) errores.push('dias_aviso_previo debe ser entero entre 0 y 60.');
      else payload.dias_aviso_previo = v;
    }

    if (errores.length) return res.status(400).json({ ok: false, error: errores.join(' ') });

    const config = await farmacia.actualizarConfigGlobal(payload);
    res.json({ ok: true, config });
  } catch (err) {
    console.error('Error PUT /farmacia/config:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /pacientes/:id/intervalo — intervalo personalizado del paciente.
router.put('/pacientes/:id/intervalo', requireAdmin, async (req, res) => {
  try {
    const intervalo = intEnRango(req.body?.intervalo_dias, 1, 365);
    if (intervalo === null) {
      return res.status(400).json({ ok: false, error: 'intervalo_dias debe ser entero entre 1 y 365.' });
    }
    // activo es opcional; por defecto TRUE.
    const activo = req.body?.activo === undefined ? true : !!req.body.activo;

    const data = await farmacia.setIntervaloPaciente(
      req.params.id,
      { intervalo_dias: intervalo, activo },
      req.user?.username
    );
    res.json({ ok: true, data });
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error('Error PUT /farmacia/pacientes/:id/intervalo:', err.message);
    res.status(status).json({ ok: false, error: err.message });
  }
});

// PUT /dispensaciones/:idCita/:idCorrelativo/nota — nota manual de una entrega.
router.put('/dispensaciones/:idCita/:idCorrelativo/nota', requireAdmin, async (req, res) => {
  try {
    const idCorrelativo = intEnRango(req.params.idCorrelativo, 0, 2147483647);
    if (idCorrelativo === null) {
      return res.status(400).json({ ok: false, error: 'id_correlativo inválido.' });
    }

    const { medicamento, cantidad, observaciones } = req.body || {};
    // Truncar a longitudes razonables para evitar abusos.
    const limpiar = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);

    const data = await farmacia.guardarNota(
      req.params.idCita,
      idCorrelativo,
      {
        medicamento:   limpiar(medicamento, 200),
        cantidad:      limpiar(cantidad, 100),
        observaciones: limpiar(observaciones, 1000),
      },
      req.user?.username
    );
    res.json({ ok: true, data });
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error('Error PUT /farmacia/dispensaciones nota:', err.message);
    res.status(status).json({ ok: false, error: err.message });
  }
});

module.exports = router;
