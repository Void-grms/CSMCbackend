/**
 * api/ajustes.js — Endpoints REST del módulo Ajustes (Admin).
 *
 * Todas las rutas requieren rol = 'admin'. Se monta en server.js con:
 *   app.use('/api/ajustes', verifyToken, requireAdmin, ajustesRoutes);
 *
 * Estructura:
 *   /api/ajustes/paquetes                      [CRUD]
 *   /api/ajustes/paquetes/:id/versiones        [historial]
 *   /api/ajustes/paquetes/:id/reglas           [reglas especiales]
 *   /api/ajustes/profesiones                   [listado]
 *   /api/ajustes/componentes                   [tipos únicos en catálogo]
 *   /api/ajustes/profesiones-componentes       [matriz]
 *   /api/ajustes/usuarios                      [CRUD usuarios]
 *   /api/ajustes/auditoria                     [historial cambios]
 */

const express = require('express');
const bcrypt  = require('bcryptjs');
const { Pool } = require('pg');

const versionado  = require('../ajustes/versionado');
const auditoria   = require('../ajustes/auditoria');

const router = express.Router();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  client_encoding: 'utf8',
});

const ID_PAQUETE_RE = /^[A-Z][A-Z0-9_]{1,49}$/;
const TIPOS_REGLA_VALIDOS = ['CODIGOS_MISMO_MES', 'CODIGOS_MISMA_CITA', 'EXIGE_TIPO_DX'];

function getIp(req) {
  return req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
}

function validarPaquetePayload(p) {
  const errores = [];
  if (!p.id_paquete || !ID_PAQUETE_RE.test(p.id_paquete)) {
    errores.push('id_paquete inválido (mayúsculas/dígitos/guión bajo, 2-50 chars).');
  }
  if (!p.nombre || !p.nombre.trim()) errores.push('Nombre requerido.');
  if (!Number.isInteger(p.plazo_dias) || p.plazo_dias < 1 || p.plazo_dias > 1000) {
    errores.push('plazo_dias debe ser entero entre 1 y 1000.');
  }
  if (p.edad_minima != null && (!Number.isInteger(p.edad_minima) || p.edad_minima < 0 || p.edad_minima > 120)) {
    errores.push('edad_minima fuera de rango.');
  }
  if (p.edad_maxima != null && (!Number.isInteger(p.edad_maxima) || p.edad_maxima < 0 || p.edad_maxima > 120)) {
    errores.push('edad_maxima fuera de rango.');
  }
  if (p.edad_minima != null && p.edad_maxima != null && p.edad_minima > p.edad_maxima) {
    errores.push('edad_minima debe ser ≤ edad_maxima.');
  }

  if (Array.isArray(p.componentes)) {
    const vistos = new Set();
    for (const c of p.componentes) {
      if (!c.tipo_componente || !c.tipo_componente.trim()) {
        errores.push('Componente sin tipo_componente.');
        continue;
      }
      if (vistos.has(c.tipo_componente)) {
        errores.push(`Componente duplicado: ${c.tipo_componente}`);
      }
      vistos.add(c.tipo_componente);
      if (!Number.isInteger(c.cantidad_minima) || c.cantidad_minima < 1) {
        errores.push(`${c.tipo_componente}: cantidad_minima debe ser entero ≥ 1.`);
      }
      const codigos = c.codigos || [];
      if (!Array.isArray(codigos) || codigos.length === 0) {
        errores.push(`${c.tipo_componente}: debe tener al menos un código válido.`);
      } else if (new Set(codigos).size !== codigos.length) {
        errores.push(`${c.tipo_componente}: hay códigos duplicados.`);
      }
    }
  }

  if (Array.isArray(p.reglas_especiales)) {
    for (const r of p.reglas_especiales) {
      if (!TIPOS_REGLA_VALIDOS.includes(r.tipo_regla)) {
        errores.push(`Regla especial con tipo desconocido: ${r.tipo_regla}`);
      }
      if (r.parametros == null || typeof r.parametros !== 'object') {
        errores.push(`Regla ${r.tipo_regla} sin parámetros válidos.`);
      }
    }
  }

  return errores;
}

// ═════════════════════════════════════════════════════════════════════════════
// PAQUETES — CRUD
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/ajustes/paquetes — lista resumida (versión actual de cada paquete)
router.get('/paquetes', async (req, res) => {
  try {
    const incluirEliminados = req.query.incluirEliminados === '1';
    const where = incluirEliminados ? '' : 'WHERE pdv.activo = TRUE';

    const { rows } = await pool.query(`
      SELECT
        pdv.id_paquete,
        pdv.version            AS version_actual,
        pdv.nombre,
        pdv.codigo_paquete,
        pdv.plazo_dias,
        pdv.id_actividad,
        pdv.edad_minima,
        pdv.edad_maxima,
        pdv.activo,
        pdv.fecha_creacion,
        u.username             AS ultima_edicion_por,
        (SELECT COUNT(*)::INT FROM paquete_detalle_version
           WHERE id_paquete = pdv.id_paquete AND version = pdv.version) AS componentes_count,
        (SELECT COUNT(*)::INT FROM paquete_grupo_dx_version
           WHERE id_paquete = pdv.id_paquete AND version = pdv.version) AS dx_count,
        (SELECT COUNT(*)::INT FROM paquete_paciente
           WHERE id_paquete = pdv.id_paquete AND estado = 'abierto')    AS abiertos_count
      FROM paquete_definicion_version pdv
      JOIN paquete_version_actual pva
        ON pva.id_paquete = pdv.id_paquete
       AND pva.version_actual = pdv.version
      LEFT JOIN usuarios u ON u.id = pdv.creado_por
      ${where}
      ORDER BY pdv.codigo_paquete NULLS LAST, pdv.id_paquete
    `);
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('Error GET /paquetes:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/ajustes/paquetes/:id — detalle versión actual
router.get('/paquetes/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const paquete = await versionado.cargarPaqueteCompleto(client, req.params.id);
    if (!paquete) return res.status(404).json({ ok: false, error: 'Paquete no encontrado' });
    res.json({ ok: true, data: paquete });
  } catch (err) {
    console.error(`Error GET /paquetes/${req.params.id}:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/ajustes/paquetes/:id/versiones — lista versiones históricas
router.get('/paquetes/:id/versiones', async (req, res) => {
  const client = await pool.connect();
  try {
    const versiones = await versionado.listarVersiones(client, req.params.id);
    res.json({ ok: true, data: versiones });
  } catch (err) {
    console.error('Error GET /versiones:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/ajustes/paquetes/:id/versiones/:n — snapshot de versión n
router.get('/paquetes/:id/versiones/:n', async (req, res) => {
  const client = await pool.connect();
  try {
    const version = parseInt(req.params.n, 10);
    if (!Number.isInteger(version) || version < 1) {
      return res.status(400).json({ ok: false, error: 'Versión inválida' });
    }
    const data = await versionado.cargarVersion(client, req.params.id, version);
    if (!data) return res.status(404).json({ ok: false, error: 'Versión no encontrada' });
    res.json({ ok: true, data });
  } catch (err) {
    console.error('Error GET versión:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/ajustes/paquetes — crear paquete nuevo (versión 1)
router.post('/paquetes', async (req, res) => {
  const errores = validarPaquetePayload(req.body || {});
  if (errores.length) return res.status(400).json({ ok: false, error: errores.join(' ') });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ¿Ya existe?
    const existe = await client.query(
      `SELECT 1 FROM paquete_definicion_version WHERE id_paquete = $1 LIMIT 1`,
      [req.body.id_paquete]
    );
    if (existe.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'Ya existe un paquete con ese id_paquete' });
    }

    const version = await versionado.crearNuevaVersion(
      client,
      { ...req.body, activo: true },
      req.user?.id,
      'Creación inicial'
    );

    const completo = await versionado.cargarPaqueteCompleto(client, req.body.id_paquete);

    await auditoria.registrar(client, {
      entidad: 'paquete',
      entidadId: req.body.id_paquete,
      accion: 'crear',
      antes: null,
      despues: completo,
      diffResumen: versionado.generarDiff(null, completo),
      usuario: req.user,
      ip: getIp(req),
    });

    await client.query('COMMIT');
    res.status(201).json({ ok: true, data: completo, version });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error POST /paquetes:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/ajustes/paquetes/:id — editar (crea nueva versión)
router.put('/paquetes/:id', async (req, res) => {
  const id = req.params.id;
  const payload = { ...req.body, id_paquete: id };
  const errores = validarPaquetePayload(payload);
  if (errores.length) return res.status(400).json({ ok: false, error: errores.join(' ') });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const antes = await versionado.cargarPaqueteCompleto(client, id);
    if (!antes) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Paquete no encontrado' });
    }

    // Conservar el estado activo previo (no se cambia desde PUT — usar DELETE/restaurar).
    payload.activo = antes.activo;

    const version = await versionado.crearNuevaVersion(
      client,
      payload,
      req.user?.id,
      req.body.nota_cambio || null
    );
    const despues = await versionado.cargarPaqueteCompleto(client, id);

    await auditoria.registrar(client, {
      entidad: 'paquete',
      entidadId: id,
      accion: 'editar',
      antes,
      despues,
      diffResumen: versionado.generarDiff(antes, despues),
      usuario: req.user,
      ip: getIp(req),
    });

    await client.query('COMMIT');
    res.json({ ok: true, data: despues, version });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`Error PUT /paquetes/${id}:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/ajustes/paquetes/:id — soft delete (activo=false)
router.delete('/paquetes/:id', async (req, res) => {
  const id = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const antes = await versionado.cargarPaqueteCompleto(client, id);
    if (!antes) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Paquete no encontrado' });
    }
    if (!antes.activo) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'El paquete ya está eliminado' });
    }

    const version = await versionado.crearNuevaVersion(
      client,
      { ...antes, activo: false },
      req.user?.id,
      'Eliminación (soft delete)'
    );
    const despues = await versionado.cargarPaqueteCompleto(client, id);

    await auditoria.registrar(client, {
      entidad: 'paquete',
      entidadId: id,
      accion: 'eliminar',
      antes,
      despues,
      diffResumen: 'Paquete marcado como eliminado',
      usuario: req.user,
      ip: getIp(req),
    });

    await client.query('COMMIT');
    res.json({ ok: true, data: despues, version });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`Error DELETE /paquetes/${id}:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/ajustes/paquetes/:id/restaurar — reactiva un paquete eliminado
router.post('/paquetes/:id/restaurar', async (req, res) => {
  const id = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const antes = await versionado.cargarPaqueteCompleto(client, id);
    if (!antes) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Paquete no encontrado' });
    }
    if (antes.activo) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'El paquete ya está activo' });
    }

    const version = await versionado.crearNuevaVersion(
      client, { ...antes, activo: true }, req.user?.id, 'Restauración'
    );
    const despues = await versionado.cargarPaqueteCompleto(client, id);

    await auditoria.registrar(client, {
      entidad: 'paquete',
      entidadId: id,
      accion: 'restaurar',
      antes,
      despues,
      diffResumen: 'Paquete restaurado',
      usuario: req.user,
      ip: getIp(req),
    });
    await client.query('COMMIT');
    res.json({ ok: true, data: despues, version });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`Error POST /restaurar:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// PROFESIONALES — estado activo/inactivo (corrección manual de fecha_baja)
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/ajustes/profesionales?estado=activo|inactivo|todos&q=texto&limite=N
router.get('/profesionales', async (req, res) => {
  try {
    const estado = req.query.estado || 'todos';
    const q = (req.query.q ?? '').trim();
    const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 1000, 1), 5000);

    const condiciones = [];
    const valores = [];
    if (estado === 'activo') condiciones.push(`fecha_baja IS NULL`);
    else if (estado === 'inactivo') condiciones.push(`fecha_baja IS NOT NULL`);

    if (q) {
      valores.push(`%${q}%`);
      condiciones.push(`(
        numero_documento ILIKE $${valores.length}
        OR apellido_paterno ILIKE $${valores.length}
        OR apellido_materno ILIKE $${valores.length}
        OR nombres ILIKE $${valores.length}
        OR CONCAT(apellido_paterno, ' ', apellido_materno, ' ', nombres) ILIKE $${valores.length}
      )`);
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    valores.push(limite);

    const { rows } = await pool.query(`
      SELECT
        id_personal,
        numero_documento,
        apellido_paterno,
        apellido_materno,
        nombres,
        CONCAT(apellido_paterno, ' ', apellido_materno, ' ', nombres) AS nombre_completo,
        id_profesion,
        id_establecimiento,
        fecha_alta,
        fecha_baja,
        (fecha_baja IS NULL) AS activo
      FROM profesional
      ${where}
      ORDER BY (fecha_baja IS NULL) DESC, apellido_paterno, apellido_materno, nombres
      LIMIT $${valores.length}
    `, valores);

    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('Error GET /profesionales:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/ajustes/profesionales/:id/activar  — limpia fecha_baja
router.put('/profesionales/:id/activar', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: antesRows } = await client.query(
      `SELECT id_personal, fecha_baja FROM profesional WHERE id_personal = $1`,
      [req.params.id]
    );
    if (antesRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Profesional no encontrado' });
    }
    if (antesRows[0].fecha_baja === null) {
      await client.query('ROLLBACK');
      return res.json({ ok: true, data: antesRows[0], mensaje: 'Ya estaba activo' });
    }

    const { rows } = await client.query(`
      UPDATE profesional
      SET fecha_baja = NULL
      WHERE id_personal = $1
      RETURNING id_personal, numero_documento, apellido_paterno, apellido_materno,
                nombres, id_profesion, fecha_alta, fecha_baja
    `, [req.params.id]);

    await auditoria.registrar(client, {
      entidad: 'profesional',
      entidadId: req.params.id,
      accion: 'editar',
      antes: antesRows[0],
      despues: rows[0],
      diffResumen: `Profesional reactivado (fecha_baja: ${antesRows[0].fecha_baja} → NULL). Será sobreescrito por el próximo import de maestro_profesional.`,
      usuario: req.user,
      ip: getIp(req),
    });
    await client.query('COMMIT');
    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error PUT /profesionales/:id/activar:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/ajustes/profesionales/:id/desactivar  — fija fecha_baja = hoy
router.put('/profesionales/:id/desactivar', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: antesRows } = await client.query(
      `SELECT id_personal, fecha_baja FROM profesional WHERE id_personal = $1`,
      [req.params.id]
    );
    if (antesRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Profesional no encontrado' });
    }
    if (antesRows[0].fecha_baja !== null) {
      await client.query('ROLLBACK');
      return res.json({ ok: true, data: antesRows[0], mensaje: 'Ya estaba inactivo' });
    }

    const { rows } = await client.query(`
      UPDATE profesional
      SET fecha_baja = CURRENT_DATE
      WHERE id_personal = $1
      RETURNING id_personal, numero_documento, apellido_paterno, apellido_materno,
                nombres, id_profesion, fecha_alta, fecha_baja
    `, [req.params.id]);

    await auditoria.registrar(client, {
      entidad: 'profesional',
      entidadId: req.params.id,
      accion: 'editar',
      antes: antesRows[0],
      despues: rows[0],
      diffResumen: `Profesional dado de baja manualmente (fecha_baja: NULL → ${rows[0].fecha_baja}).`,
      usuario: req.user,
      ip: getIp(req),
    });
    await client.query('COMMIT');
    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error PUT /profesionales/:id/desactivar:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// PROFESIONES Y COMPONENTES
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/ajustes/profesiones — id_profesion únicos
router.get('/profesiones', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT id_profesion
      FROM profesional
      WHERE id_profesion IS NOT NULL AND id_profesion <> ''
      ORDER BY id_profesion
    `);
    res.json({ ok: true, data: rows.map(r => r.id_profesion) });
  } catch (err) {
    console.error('Error GET /profesiones:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/ajustes/componentes — tipo_componente únicos del catálogo
router.get('/componentes', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT tipo_componente
      FROM paquete_detalle_version
      WHERE tipo_componente IS NOT NULL
      ORDER BY tipo_componente
    `);
    res.json({ ok: true, data: rows.map(r => r.tipo_componente) });
  } catch (err) {
    console.error('Error GET /componentes:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/ajustes/profesiones-componentes — matriz
router.get('/profesiones-componentes', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT tipo_componente, id_profesion, observaciones
      FROM componente_profesion_permitida
      ORDER BY tipo_componente, id_profesion
    `);
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('Error GET /profesiones-componentes:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/ajustes/profesiones-componentes — reemplaza matriz completa
router.put('/profesiones-componentes', async (req, res) => {
  const matriz = req.body?.matriz;
  if (!Array.isArray(matriz)) {
    return res.status(400).json({ ok: false, error: 'Se esperaba { matriz: [...] }' });
  }
  for (const m of matriz) {
    if (!m.tipo_componente || !m.id_profesion) {
      return res.status(400).json({ ok: false, error: 'Cada entrada requiere tipo_componente e id_profesion' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: antesRows } = await client.query(
      `SELECT tipo_componente, id_profesion, observaciones FROM componente_profesion_permitida`
    );
    await client.query(`DELETE FROM componente_profesion_permitida`);
    for (const m of matriz) {
      await client.query(`
        INSERT INTO componente_profesion_permitida (tipo_componente, id_profesion, observaciones)
        VALUES ($1, $2, $3)
        ON CONFLICT (tipo_componente, id_profesion)
        DO UPDATE SET observaciones = EXCLUDED.observaciones
      `, [m.tipo_componente, m.id_profesion, m.observaciones || null]);
    }

    await auditoria.registrar(client, {
      entidad: 'profesion_componente',
      entidadId: 'matriz',
      accion: 'editar',
      antes: antesRows,
      despues: matriz,
      diffResumen: `${matriz.length} pares componente-profesión activos`,
      usuario: req.user,
      ip: getIp(req),
    });
    await client.query('COMMIT');
    res.json({ ok: true, data: matriz });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error PUT /profesiones-componentes:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// USUARIOS — CRUD
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/ajustes/usuarios
router.get('/usuarios', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, username, rol, nombre_completo, activo,
             creado_en, ultima_modificacion, creado_por
      FROM usuarios
      ORDER BY activo DESC, username
    `);
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('Error GET /usuarios:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/ajustes/usuarios
router.post('/usuarios', async (req, res) => {
  const { username, password, nombre_completo, rol } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'username y password son requeridos' });
  }
  if (password.length < 6) {
    return res.status(400).json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres' });
  }
  if (rol && !['admin', 'usuario'].includes(rol)) {
    return res.status(400).json({ ok: false, error: 'rol debe ser admin o usuario' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existe = await client.query(`SELECT 1 FROM usuarios WHERE username = $1`, [username]);
    if (existe.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'Ya existe un usuario con ese username' });
    }
    const hash = await bcrypt.hash(password, 10);
    const { rows: insertados } = await client.query(`
      INSERT INTO usuarios (username, password_hash, nombre_completo, rol, activo, creado_por, ultima_modificacion)
      VALUES ($1, $2, $3, $4, TRUE, $5, NOW())
      RETURNING id, username, rol, nombre_completo, activo, creado_en
    `, [username, hash, nombre_completo || null, rol || 'usuario', req.user?.id]);

    const nuevo = insertados[0];
    await auditoria.registrar(client, {
      entidad: 'usuario',
      entidadId: String(nuevo.id),
      accion: 'crear',
      antes: null,
      despues: nuevo,
      diffResumen: `Usuario ${username} creado con rol ${nuevo.rol}`,
      usuario: req.user,
      ip: getIp(req),
    });

    await client.query('COMMIT');
    res.status(201).json({ ok: true, data: nuevo });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error POST /usuarios:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/ajustes/usuarios/:id — editar nombre, rol, activo
router.put('/usuarios/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: 'id inválido' });

  const { nombre_completo, rol, activo } = req.body || {};
  if (rol && !['admin', 'usuario'].includes(rol)) {
    return res.status(400).json({ ok: false, error: 'rol inválido' });
  }
  if (id === req.user.id && activo === false) {
    return res.status(400).json({ ok: false, error: 'No puedes desactivar tu propia cuenta' });
  }
  if (id === req.user.id && rol && rol !== 'admin') {
    return res.status(400).json({ ok: false, error: 'No puedes cambiar tu propio rol a no-admin' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: prev } = await client.query(
      `SELECT id, username, rol, nombre_completo, activo FROM usuarios WHERE id = $1`, [id]
    );
    if (!prev.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }

    const camposActualizar = [];
    const valores = [];
    if (nombre_completo !== undefined) {
      valores.push(nombre_completo);
      camposActualizar.push(`nombre_completo = $${valores.length}`);
    }
    if (rol !== undefined) {
      valores.push(rol);
      camposActualizar.push(`rol = $${valores.length}`);
    }
    if (activo !== undefined) {
      valores.push(activo);
      camposActualizar.push(`activo = $${valores.length}`);
    }
    if (!camposActualizar.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'Sin cambios a aplicar' });
    }
    camposActualizar.push(`ultima_modificacion = NOW()`);
    valores.push(id);

    const { rows: actualizados } = await client.query(`
      UPDATE usuarios SET ${camposActualizar.join(', ')}
      WHERE id = $${valores.length}
      RETURNING id, username, rol, nombre_completo, activo
    `, valores);

    await auditoria.registrar(client, {
      entidad: 'usuario',
      entidadId: String(id),
      accion: 'editar',
      antes: prev[0],
      despues: actualizados[0],
      diffResumen: `Actualizó usuario ${prev[0].username}`,
      usuario: req.user,
      ip: getIp(req),
    });

    await client.query('COMMIT');
    res.json({ ok: true, data: actualizados[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error PUT /usuarios/:id:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/ajustes/usuarios/:id/password
router.put('/usuarios/:id/password', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { password } = req.body || {};
  if (!password || password.length < 6) {
    return res.status(400).json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: prev } = await client.query(`SELECT id, username FROM usuarios WHERE id = $1`, [id]);
    if (!prev.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }
    const hash = await bcrypt.hash(password, 10);
    await client.query(
      `UPDATE usuarios SET password_hash = $1, ultima_modificacion = NOW() WHERE id = $2`,
      [hash, id]
    );

    await auditoria.registrar(client, {
      entidad: 'usuario',
      entidadId: String(id),
      accion: 'editar',
      antes: { id, username: prev[0].username, password_changed: false },
      despues: { id, username: prev[0].username, password_changed: true },
      diffResumen: `Contraseña cambiada para ${prev[0].username}`,
      usuario: req.user,
      ip: getIp(req),
    });

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error PUT password:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/ajustes/usuarios/:id — soft delete (activo=false)
router.delete('/usuarios/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) {
    return res.status(400).json({ ok: false, error: 'No puedes eliminar tu propia cuenta' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: prev } = await client.query(
      `SELECT id, username, rol, nombre_completo, activo FROM usuarios WHERE id = $1`, [id]
    );
    if (!prev.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }
    await client.query(
      `UPDATE usuarios SET activo = FALSE, ultima_modificacion = NOW() WHERE id = $1`, [id]
    );

    await auditoria.registrar(client, {
      entidad: 'usuario',
      entidadId: String(id),
      accion: 'eliminar',
      antes: prev[0],
      despues: { ...prev[0], activo: false },
      diffResumen: `Usuario ${prev[0].username} desactivado`,
      usuario: req.user,
      ip: getIp(req),
    });

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error DELETE /usuarios:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// AUDITORÍA
// ═════════════════════════════════════════════════════════════════════════════

router.get('/auditoria', async (req, res) => {
  try {
    const filtros = {
      entidad: req.query.entidad,
      entidadId: req.query.entidad_id,
      usuarioId: req.query.usuario_id ? parseInt(req.query.usuario_id, 10) : undefined,
      desde: req.query.desde,
      hasta: req.query.hasta,
      limite: req.query.limite ? Math.min(parseInt(req.query.limite, 10), 500) : 100,
      offset: req.query.offset ? parseInt(req.query.offset, 10) : 0,
    };
    const data = await auditoria.listar(pool, filtros);
    res.json({ ok: true, data });
  } catch (err) {
    console.error('Error GET /auditoria:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/auditoria/:id', async (req, res) => {
  try {
    const entrada = await auditoria.obtener(pool, req.params.id);
    if (!entrada) return res.status(404).json({ ok: false, error: 'Entrada no encontrada' });
    res.json({ ok: true, data: entrada });
  } catch (err) {
    console.error('Error GET /auditoria/:id:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
