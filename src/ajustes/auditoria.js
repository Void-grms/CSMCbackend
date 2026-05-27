/**
 * auditoria.js — Registro inmutable de cambios del módulo Ajustes.
 *
 * Cada operación CRUD del admin se registra en la tabla auditoria_ajustes.
 * La tabla no tiene endpoint de borrado: el historial es inmutable.
 */

/**
 * Registra una entrada de auditoría.
 *
 * @param {object} client - pg client (debe estar en transacción)
 * @param {object} args
 * @param {string} args.entidad - 'paquete' | 'regla_especial' | 'usuario' | 'profesion_componente'
 * @param {string} args.entidadId - id de la entidad afectada
 * @param {string} args.accion - 'crear' | 'editar' | 'eliminar' | 'restaurar'
 * @param {object|null} args.antes - estado previo (JSON serializable) o null si era crear
 * @param {object|null} args.despues - estado nuevo o null si era eliminar
 * @param {string} [args.diffResumen] - resumen humano legible
 * @param {object} args.usuario - { id, username } del actor
 * @param {string} [args.ip] - IP del request
 */
async function registrar(client, {
  entidad, entidadId, accion, antes, despues, diffResumen, usuario, ip
}) {
  await client.query(`
    INSERT INTO auditoria_ajustes
      (entidad, entidad_id, accion, estado_antes, estado_despues,
       diff_resumen, usuario_id, usuario_username, ip_origen)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
  `, [
    entidad,
    String(entidadId),
    accion,
    antes ? JSON.stringify(antes) : null,
    despues ? JSON.stringify(despues) : null,
    diffResumen || null,
    usuario?.id || null,
    usuario?.username || null,
    ip || null,
  ]);
}

/**
 * Lista entradas de auditoría con filtros.
 */
async function listar(pool, { entidad, entidadId, usuarioId, desde, hasta, limite = 100, offset = 0 } = {}) {
  const condiciones = [];
  const valores = [];

  if (entidad) {
    valores.push(entidad);
    condiciones.push(`entidad = $${valores.length}`);
  }
  if (entidadId) {
    valores.push(entidadId);
    condiciones.push(`entidad_id = $${valores.length}`);
  }
  if (usuarioId) {
    valores.push(usuarioId);
    condiciones.push(`usuario_id = $${valores.length}`);
  }
  if (desde) {
    valores.push(desde);
    condiciones.push(`timestamp >= $${valores.length}::timestamp`);
  }
  if (hasta) {
    valores.push(hasta);
    condiciones.push(`timestamp <= $${valores.length}::timestamp`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  valores.push(limite);
  const idxLim = valores.length;
  valores.push(offset);
  const idxOff = valores.length;

  const { rows } = await pool.query(`
    SELECT id, entidad, entidad_id, accion, diff_resumen,
           usuario_id, usuario_username, timestamp, ip_origen
    FROM auditoria_ajustes
    ${where}
    ORDER BY timestamp DESC
    LIMIT $${idxLim} OFFSET $${idxOff}
  `, valores);

  return rows;
}

/**
 * Devuelve una entrada completa (con before/after JSON).
 */
async function obtener(pool, id) {
  const { rows } = await pool.query(`
    SELECT * FROM auditoria_ajustes WHERE id = $1
  `, [id]);
  return rows[0] || null;
}

module.exports = { registrar, listar, obtener };
