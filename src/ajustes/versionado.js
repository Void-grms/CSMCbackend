/**
 * versionado.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Servicio de versionado para el catálogo de paquetes.
 *
 * Cada edición/creación/eliminación de un paquete genera una nueva versión
 * inmutable en paquete_definicion_version (+ tablas hijas).
 *
 * También sincroniza las tablas "canónicas" (paquete_definicion, paquete_detalle,
 * paquete_detalle_codigos, paquete_grupo_dx) para que las queries existentes
 * sigan funcionando como espejo de la versión actual.
 *
 * Los paquetes ya abiertos (paquete_paciente.version_catalogo) no se ven
 * afectados — siguen evaluándose con su versión original.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Carga el snapshot completo de la versión actual de un paquete.
 * Devuelve null si no existe.
 */
async function cargarPaqueteCompleto(client, idPaquete) {
  const { rows: defRows } = await client.query(`
    SELECT pdv.*
    FROM paquete_definicion_version pdv
    JOIN paquete_version_actual pva
      ON pva.id_paquete = pdv.id_paquete
     AND pva.version_actual = pdv.version
    WHERE pdv.id_paquete = $1
  `, [idPaquete]);
  if (!defRows.length) return null;
  const def = defRows[0];

  const { rows: componentes } = await client.query(`
    SELECT pdv.tipo_componente, pdv.cantidad_minima, pdv.usar_prefijo, pdv.orden,
           COALESCE(ARRAY_AGG(pdcv.codigo_item ORDER BY pdcv.codigo_item)
             FILTER (WHERE pdcv.codigo_item IS NOT NULL), '{}') AS codigos
    FROM paquete_detalle_version pdv
    LEFT JOIN paquete_detalle_codigos_version pdcv
      ON  pdcv.id_paquete = pdv.id_paquete
      AND pdcv.version    = pdv.version
      AND pdcv.tipo_componente = pdv.tipo_componente
    WHERE pdv.id_paquete = $1 AND pdv.version = $2
    GROUP BY pdv.tipo_componente, pdv.cantidad_minima, pdv.usar_prefijo, pdv.orden
    ORDER BY COALESCE(pdv.orden, 9999), pdv.tipo_componente
  `, [idPaquete, def.version]);

  const { rows: grupoDx } = await client.query(`
    SELECT codigo_cie10
    FROM paquete_grupo_dx_version
    WHERE id_paquete = $1 AND version = $2
    ORDER BY codigo_cie10
  `, [idPaquete, def.version]);

  const { rows: reglas } = await client.query(`
    SELECT id, tipo_regla, parametros, activa
    FROM paquete_regla_especial
    WHERE id_paquete = $1 AND version = $2
    ORDER BY tipo_regla
  `, [idPaquete, def.version]);

  return {
    id_paquete:     def.id_paquete,
    version:        def.version,
    nombre:         def.nombre,
    plazo_dias:     def.plazo_dias,
    id_actividad:   def.id_actividad,
    codigo_paquete: def.codigo_paquete,
    edad_minima:    def.edad_minima,
    edad_maxima:    def.edad_maxima,
    activo:         def.activo,
    fecha_creacion: def.fecha_creacion,
    creado_por:     def.creado_por,
    nota_cambio:    def.nota_cambio,
    componentes:    componentes.map(c => ({
      tipo_componente: c.tipo_componente,
      cantidad_minima: c.cantidad_minima,
      usar_prefijo:    c.usar_prefijo,
      orden:           c.orden,
      codigos:         c.codigos || [],
    })),
    grupo_dx:       grupoDx.map(r => r.codigo_cie10),
    reglas_especiales: reglas.map(r => ({
      id:         r.id,
      tipo_regla: r.tipo_regla,
      parametros: r.parametros,
      activa:     r.activa,
    })),
  };
}

/**
 * Carga el snapshot de una versión específica (histórica).
 */
async function cargarVersion(client, idPaquete, version) {
  const { rows: defRows } = await client.query(`
    SELECT * FROM paquete_definicion_version
    WHERE id_paquete = $1 AND version = $2
  `, [idPaquete, version]);
  if (!defRows.length) return null;
  const def = defRows[0];

  const { rows: componentes } = await client.query(`
    SELECT pdv.tipo_componente, pdv.cantidad_minima, pdv.usar_prefijo, pdv.orden,
           COALESCE(ARRAY_AGG(pdcv.codigo_item ORDER BY pdcv.codigo_item)
             FILTER (WHERE pdcv.codigo_item IS NOT NULL), '{}') AS codigos
    FROM paquete_detalle_version pdv
    LEFT JOIN paquete_detalle_codigos_version pdcv
      ON  pdcv.id_paquete = pdv.id_paquete
      AND pdcv.version    = pdv.version
      AND pdcv.tipo_componente = pdv.tipo_componente
    WHERE pdv.id_paquete = $1 AND pdv.version = $2
    GROUP BY pdv.tipo_componente, pdv.cantidad_minima, pdv.usar_prefijo, pdv.orden
    ORDER BY COALESCE(pdv.orden, 9999), pdv.tipo_componente
  `, [idPaquete, version]);

  const { rows: grupoDx } = await client.query(`
    SELECT codigo_cie10 FROM paquete_grupo_dx_version
    WHERE id_paquete = $1 AND version = $2 ORDER BY codigo_cie10
  `, [idPaquete, version]);

  const { rows: reglas } = await client.query(`
    SELECT id, tipo_regla, parametros, activa
    FROM paquete_regla_especial
    WHERE id_paquete = $1 AND version = $2
    ORDER BY tipo_regla
  `, [idPaquete, version]);

  return {
    id_paquete:     def.id_paquete,
    version:        def.version,
    nombre:         def.nombre,
    plazo_dias:     def.plazo_dias,
    id_actividad:   def.id_actividad,
    codigo_paquete: def.codigo_paquete,
    edad_minima:    def.edad_minima,
    edad_maxima:    def.edad_maxima,
    activo:         def.activo,
    fecha_creacion: def.fecha_creacion,
    creado_por:     def.creado_por,
    nota_cambio:    def.nota_cambio,
    componentes:    componentes.map(c => ({
      tipo_componente: c.tipo_componente,
      cantidad_minima: c.cantidad_minima,
      usar_prefijo:    c.usar_prefijo,
      orden:           c.orden,
      codigos:         c.codigos || [],
    })),
    grupo_dx:       grupoDx.map(r => r.codigo_cie10),
    reglas_especiales: reglas.map(r => ({
      id:         r.id,
      tipo_regla: r.tipo_regla,
      parametros: r.parametros,
      activa:     r.activa,
    })),
  };
}

/**
 * Devuelve la próxima versión disponible para un paquete.
 */
async function siguienteVersion(client, idPaquete) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS siguiente
     FROM paquete_definicion_version WHERE id_paquete = $1`,
    [idPaquete]
  );
  return rows[0].siguiente;
}

/**
 * Sincroniza las tablas "canónicas" con la versión actual del catálogo:
 *   - Borra filas obsoletas de paquete_detalle / paquete_detalle_codigos / paquete_grupo_dx
 *   - Sobrescribe paquete_definicion con los valores nuevos
 *   - Reinserta detalles y códigos según el payload
 *
 * Solo se llama al guardar una nueva versión.
 */
async function sincronizarTablasCanonicas(client, idPaquete, payload) {
  // Borrar dependencias en orden FK seguro
  await client.query(
    `DELETE FROM paquete_detalle_codigos WHERE id_paquete = $1`, [idPaquete]
  );
  await client.query(
    `DELETE FROM paquete_detalle WHERE id_paquete = $1`, [idPaquete]
  );
  await client.query(
    `DELETE FROM paquete_grupo_dx WHERE id_paquete = $1`, [idPaquete]
  );

  // Upsert en paquete_definicion
  await client.query(`
    INSERT INTO paquete_definicion (id_paquete, nombre, plazo_dias, id_actividad,
                                    codigo_paquete, edad_minima, edad_maxima)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (id_paquete) DO UPDATE SET
      nombre = EXCLUDED.nombre,
      plazo_dias = EXCLUDED.plazo_dias,
      id_actividad = EXCLUDED.id_actividad,
      codigo_paquete = EXCLUDED.codigo_paquete,
      edad_minima = EXCLUDED.edad_minima,
      edad_maxima = EXCLUDED.edad_maxima
  `, [
    payload.id_paquete, payload.nombre, payload.plazo_dias,
    payload.id_actividad || null, payload.codigo_paquete || null,
    payload.edad_minima, payload.edad_maxima
  ]);

  // Reinsertar componentes
  for (const c of payload.componentes || []) {
    await client.query(`
      INSERT INTO paquete_detalle (id_paquete, tipo_componente, cantidad_minima, usar_prefijo)
      VALUES ($1, $2, $3, $4)
    `, [payload.id_paquete, c.tipo_componente, c.cantidad_minima, !!c.usar_prefijo]);

    for (const cod of c.codigos || []) {
      await client.query(`
        INSERT INTO paquete_detalle_codigos (id_paquete, tipo_componente, codigo_item)
        VALUES ($1, $2, $3)
      `, [payload.id_paquete, c.tipo_componente, cod]);
    }
  }

  // Reinsertar grupo dx
  for (const codigo of payload.grupo_dx || []) {
    await client.query(`
      INSERT INTO paquete_grupo_dx (id_paquete, codigo_cie10)
      VALUES ($1, $2) ON CONFLICT DO NOTHING
    `, [payload.id_paquete, codigo]);
  }
}

/**
 * Crea una nueva versión a partir de un payload completo.
 * Devuelve el número de versión generado.
 *
 * Debe ejecutarse dentro de una transacción (caller lo gestiona).
 */
async function crearNuevaVersion(client, payload, usuarioId, notaCambio = null) {
  const idPaquete = payload.id_paquete;
  const version = await siguienteVersion(client, idPaquete);

  await client.query(`
    INSERT INTO paquete_definicion_version
      (id_paquete, version, nombre, plazo_dias, id_actividad, codigo_paquete,
       edad_minima, edad_maxima, activo, creado_por, nota_cambio)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
  `, [
    idPaquete, version, payload.nombre, payload.plazo_dias,
    payload.id_actividad || null, payload.codigo_paquete || null,
    payload.edad_minima, payload.edad_maxima,
    payload.activo !== false, usuarioId, notaCambio
  ]);

  for (const c of payload.componentes || []) {
    await client.query(`
      INSERT INTO paquete_detalle_version
        (id_paquete, version, tipo_componente, cantidad_minima, usar_prefijo, orden)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [idPaquete, version, c.tipo_componente, c.cantidad_minima,
        !!c.usar_prefijo, c.orden ?? null]);

    for (const cod of c.codigos || []) {
      await client.query(`
        INSERT INTO paquete_detalle_codigos_version
          (id_paquete, version, tipo_componente, codigo_item)
        VALUES ($1,$2,$3,$4)
      `, [idPaquete, version, c.tipo_componente, cod]);
    }
  }

  for (const codigo of payload.grupo_dx || []) {
    await client.query(`
      INSERT INTO paquete_grupo_dx_version (id_paquete, version, codigo_cie10)
      VALUES ($1,$2,$3) ON CONFLICT DO NOTHING
    `, [idPaquete, version, codigo]);
  }

  for (const r of payload.reglas_especiales || []) {
    await client.query(`
      INSERT INTO paquete_regla_especial
        (id_paquete, version, tipo_regla, parametros, activa)
      VALUES ($1,$2,$3,$4,$5)
    `, [idPaquete, version, r.tipo_regla, r.parametros, r.activa !== false]);
  }

  // Marcar como versión actual
  await client.query(`
    INSERT INTO paquete_version_actual (id_paquete, version_actual)
    VALUES ($1, $2)
    ON CONFLICT (id_paquete) DO UPDATE SET version_actual = EXCLUDED.version_actual
  `, [idPaquete, version]);

  // Sincronizar tablas canónicas (compatibilidad con queries existentes)
  if (payload.activo !== false) {
    await sincronizarTablasCanonicas(client, idPaquete, payload);
  } else {
    // Soft delete: borrar de tablas canónicas para que no abra nuevos paquetes
    await client.query(`DELETE FROM paquete_detalle_codigos WHERE id_paquete = $1`, [idPaquete]);
    await client.query(`DELETE FROM paquete_detalle WHERE id_paquete = $1`, [idPaquete]);
    await client.query(`DELETE FROM paquete_grupo_dx WHERE id_paquete = $1`, [idPaquete]);
    // No borramos de paquete_definicion porque paquete_paciente lo referencia.
  }

  return version;
}

/**
 * Lista de versiones de un paquete (metadatos, sin payload completo).
 */
async function listarVersiones(client, idPaquete) {
  const { rows } = await client.query(`
    SELECT pdv.version, pdv.fecha_creacion, pdv.nota_cambio, pdv.activo,
           u.username AS creado_por_username,
           u.nombre_completo AS creado_por_nombre,
           CASE WHEN pva.version_actual = pdv.version THEN TRUE ELSE FALSE END AS es_actual
    FROM paquete_definicion_version pdv
    LEFT JOIN usuarios u ON u.id = pdv.creado_por
    LEFT JOIN paquete_version_actual pva ON pva.id_paquete = pdv.id_paquete
    WHERE pdv.id_paquete = $1
    ORDER BY pdv.version DESC
  `, [idPaquete]);
  return rows;
}

/**
 * Genera un resumen textual del diff entre dos versiones (antes/después).
 * Usado en auditoría.
 */
function generarDiff(antes, despues) {
  if (!antes) return 'Creación inicial';
  if (!despues) return 'Eliminación';

  const cambios = [];
  const camposSimples = [
    ['nombre', 'nombre'],
    ['plazo_dias', 'plazo (días)'],
    ['id_actividad', 'actividad'],
    ['codigo_paquete', 'código'],
    ['edad_minima', 'edad mínima'],
    ['edad_maxima', 'edad máxima'],
    ['activo', 'activo'],
  ];
  for (const [k, label] of camposSimples) {
    if (antes[k] !== despues[k]) {
      cambios.push(`${label}: ${antes[k] ?? '—'} → ${despues[k] ?? '—'}`);
    }
  }

  // Comparar grupo_dx
  const dxAntes = new Set(antes.grupo_dx || []);
  const dxDespues = new Set(despues.grupo_dx || []);
  const dxAgregados = [...dxDespues].filter(x => !dxAntes.has(x));
  const dxQuitados = [...dxAntes].filter(x => !dxDespues.has(x));
  if (dxAgregados.length) cambios.push(`CIE-10 agregados: ${dxAgregados.join(', ')}`);
  if (dxQuitados.length) cambios.push(`CIE-10 quitados: ${dxQuitados.join(', ')}`);

  // Comparar componentes
  const compAntes = Object.fromEntries((antes.componentes || []).map(c => [c.tipo_componente, c]));
  const compDespues = Object.fromEntries((despues.componentes || []).map(c => [c.tipo_componente, c]));

  for (const tipo of Object.keys(compDespues)) {
    if (!compAntes[tipo]) {
      cambios.push(`Componente agregado: ${tipo}`);
    } else {
      const a = compAntes[tipo], d = compDespues[tipo];
      if (a.cantidad_minima !== d.cantidad_minima) {
        cambios.push(`${tipo} cantidad_minima: ${a.cantidad_minima} → ${d.cantidad_minima}`);
      }
      if (a.usar_prefijo !== d.usar_prefijo) {
        cambios.push(`${tipo} usar_prefijo: ${a.usar_prefijo} → ${d.usar_prefijo}`);
      }
      const codigosA = new Set(a.codigos || []);
      const codigosD = new Set(d.codigos || []);
      const codAgregados = [...codigosD].filter(x => !codigosA.has(x));
      const codQuitados = [...codigosA].filter(x => !codigosD.has(x));
      if (codAgregados.length) cambios.push(`${tipo} códigos agregados: ${codAgregados.join(', ')}`);
      if (codQuitados.length) cambios.push(`${tipo} códigos quitados: ${codQuitados.join(', ')}`);
    }
  }
  for (const tipo of Object.keys(compAntes)) {
    if (!compDespues[tipo]) cambios.push(`Componente eliminado: ${tipo}`);
  }

  return cambios.length ? cambios.join(' | ') : 'Sin cambios detectados';
}

module.exports = {
  cargarPaqueteCompleto,
  cargarVersion,
  siguienteVersion,
  crearNuevaVersion,
  listarVersiones,
  sincronizarTablasCanonicas,
  generarDiff,
};
