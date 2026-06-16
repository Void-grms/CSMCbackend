/**
 * api/salvavidas.js — Endpoints REST del módulo "Salvavidas" (Admin).
 *
 * Se monta en server.js (después de verifyToken) con:
 *   app.use('/api/salvavidas', requireAdmin, salvavidasRoutes);
 *
 * Rutas (solo lectura):
 *   GET /api/salvavidas/paquetes?anio=&umbral=         → botones con conteos
 *   GET /api/salvavidas/:idPaquete/salvables?anio=&umbral=
 *   GET /api/salvavidas/:idPaquete/corregibles?anio=
 */

const express = require('express');
const {
  listarConteos,
  listarSalvables,
  listarCorregibles,
} = require('../salvavidas/salvavidasService');

const router = express.Router();

/** Parseo seguro de entero con valor por defecto. */
function intParam(valor, def) {
  const n = parseInt(valor, 10);
  return Number.isInteger(n) ? n : def;
}

/** Año a analizar: el de la query o el año en curso. */
function anioParam(valor) {
  return intParam(valor, new Date().getFullYear());
}

// ── Botones: un paquete por fila con sus conteos ──
router.get('/paquetes', async (req, res) => {
  try {
    const anio   = anioParam(req.query.anio);
    const umbral = intParam(req.query.umbral, 2);
    res.json(await listarConteos(anio, umbral));
  } catch (err) {
    console.error('Error /api/salvavidas/paquetes:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Salvables (abiertos cercanos a completarse) ──
router.get('/:idPaquete/salvables', async (req, res) => {
  try {
    const anio   = anioParam(req.query.anio);
    const umbral = intParam(req.query.umbral, 2);
    res.json(await listarSalvables(req.params.idPaquete, anio, umbral));
  } catch (err) {
    console.error('Error /api/salvavidas/salvables:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Corregibles (vencidos con atención mal codificada) ──
router.get('/:idPaquete/corregibles', async (req, res) => {
  try {
    const anio = anioParam(req.query.anio);
    res.json(await listarCorregibles(req.params.idPaquete, anio));
  } catch (err) {
    console.error('Error /api/salvavidas/corregibles:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
