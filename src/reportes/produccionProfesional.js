require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  client_encoding: 'utf8',
});

function parseListaIds(valor) {
  if (!valor) return [];
  return String(valor).split(',').map(s => s.trim()).filter(Boolean);
}

function construirCondiciones(filtros) {
  const {
    fechaInicio, fechaFin, idProfesional, qPaciente, codigoItem, idPaquetes,
  } = filtros;

  const condiciones = [];
  const valores = [];

  if (fechaInicio) {
    valores.push(fechaInicio);
    condiciones.push(`a.fecha_atencion >= $${valores.length}`);
  }
  if (fechaFin) {
    valores.push(fechaFin);
    condiciones.push(`a.fecha_atencion <= $${valores.length}`);
  }
  if (idProfesional) {
    valores.push(idProfesional);
    condiciones.push(`a.id_personal = $${valores.length}`);
  }
  if (qPaciente) {
    valores.push(`%${qPaciente}%`);
    condiciones.push(`(p.numero_documento ILIKE $${valores.length} OR CONCAT(p.apellido_paterno, ' ', p.apellido_materno, ' ', p.nombres) ILIKE $${valores.length})`);
  }
  if (codigoItem) {
    const codigos = String(codigoItem).split(',').map(c => c.trim()).filter(Boolean);
    if (codigos.length === 1) {
      valores.push(`%${codigos[0]}%`);
      condiciones.push(`a.codigo_item ILIKE $${valores.length}`);
    } else if (codigos.length > 1) {
      const placeholders = codigos.map(c => {
        valores.push(`%${c}%`);
        return `a.codigo_item ILIKE $${valores.length}`;
      });
      condiciones.push(`(${placeholders.join(' OR ')})`);
    }
  }

  const paquetesIds = parseListaIds(idPaquetes);
  if (paquetesIds.length > 0) {
    valores.push(paquetesIds);
    const idx = valores.length;
    // Atención pertenece a un paquete si su codigo_item está dentro de:
    //   • el grupo Dx de la versión actual del paquete, o
    //   • los códigos de algún componente de la versión actual del paquete.
    condiciones.push(`a.codigo_item IN (
      SELECT pgdv.codigo_cie10
        FROM paquete_grupo_dx_version pgdv
        JOIN paquete_version_actual pva
          ON pva.id_paquete = pgdv.id_paquete AND pva.version_actual = pgdv.version
       WHERE pgdv.id_paquete = ANY($${idx})
      UNION
      SELECT pdcv.codigo_item
        FROM paquete_detalle_codigos_version pdcv
        JOIN paquete_version_actual pva
          ON pva.id_paquete = pdcv.id_paquete AND pva.version_actual = pdcv.version
       WHERE pdcv.id_paquete = ANY($${idx})
    )`);
  }

  return { condiciones, valores };
}

async function getProduccionProfesional(filtros) {
  const { sinLimite, limite = 500 } = filtros;
  const { condiciones, valores } = construirCondiciones(filtros);
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  let limitClause = '';
  if (!sinLimite) {
    valores.push(limite);
    limitClause = `LIMIT $${valores.length}`;
  }

  const query = `
    SELECT
      a.id_cita,
      a.id_correlativo,
      a.fecha_atencion,
      a.codigo_item,
      a.tipo_diagnostico,
      a.valor_lab,
      a.id_turno,
      a.edad_reg,
      a.tipo_edad,
      a.peso,
      a.talla,
      pr.id_personal,
      pr.id_profesion AS profesion,
      CONCAT(pr.apellido_paterno, ' ', pr.apellido_materno, ' ', pr.nombres) AS nombre_profesional,
      p.numero_documento AS dni_paciente,
      CONCAT(p.apellido_paterno, ' ', p.apellido_materno, ' ', p.nombres) AS nombre_paciente,
      p.domicilio_declarado
    FROM atencion a
    JOIN profesional pr ON a.id_personal = pr.id_personal
    JOIN paciente p ON a.id_paciente = p.id_paciente
    ${where}
    ORDER BY a.fecha_atencion DESC, a.id_cita, a.id_correlativo
    ${limitClause}
  `;

  const { rows } = await pool.query(query, valores);
  return rows;
}

/**
 * Resumen agregado: cantidad de atenciones y citas por profesional,
 * aplicando los mismos filtros que getProduccionProfesional (sin límite).
 */
async function getResumenProduccion(filtros) {
  const { condiciones, valores } = construirCondiciones(filtros);
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const query = `
    SELECT
      pr.id_personal,
      pr.id_profesion AS profesion,
      CONCAT(pr.apellido_paterno, ' ', pr.apellido_materno, ' ', pr.nombres) AS nombre_profesional,
      COUNT(*)::INT                          AS total_atenciones,
      COUNT(DISTINCT a.id_cita)::INT         AS total_citas,
      COUNT(DISTINCT a.id_paciente)::INT     AS total_pacientes,
      MIN(a.fecha_atencion)                  AS primera_atencion,
      MAX(a.fecha_atencion)                  AS ultima_atencion
    FROM atencion a
    JOIN profesional pr ON a.id_personal = pr.id_personal
    JOIN paciente p ON a.id_paciente = p.id_paciente
    ${where}
    GROUP BY pr.id_personal, pr.id_profesion, pr.apellido_paterno, pr.apellido_materno, pr.nombres
    ORDER BY total_atenciones DESC, nombre_profesional
  `;

  const { rows } = await pool.query(query, valores);
  return rows;
}

async function getProfesionales() {
    const query = `
        SELECT id_personal, id_profesion AS profesion, CONCAT(apellido_paterno, ' ', apellido_materno, ' ', nombres) AS nombre_completo
        FROM profesional
        WHERE fecha_baja IS NULL
        ORDER BY apellido_paterno, apellido_materno, nombres
    `;
    const { rows } = await pool.query(query);
    return rows;
}

/**
 * Catálogo ligero de paquetes (versión actual y activa) para alimentar
 * el selector "Tipo de paquete" en el reporte de producción.
 */
async function getPaquetesCatalogo() {
  const query = `
    SELECT
      pdv.id_paquete,
      pdv.nombre,
      pdv.codigo_paquete
    FROM paquete_definicion_version pdv
    JOIN paquete_version_actual pva
      ON pva.id_paquete = pdv.id_paquete
     AND pva.version_actual = pdv.version
    WHERE pdv.activo = TRUE
    ORDER BY pdv.codigo_paquete NULLS LAST, pdv.nombre
  `;
  const { rows } = await pool.query(query);
  return rows;
}

module.exports = {
  getProduccionProfesional,
  getResumenProduccion,
  getProfesionales,
  getPaquetesCatalogo,
};
