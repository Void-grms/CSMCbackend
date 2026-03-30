require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  client_encoding: 'utf8',
});

async function getProduccionProfesional(filtros) {
  const { fechaInicio, fechaFin, idProfesional, qPaciente, codigoItem, limite = 500 } = filtros;
  
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
    // Soporta múltiples códigos separados por coma: "F32,90806,99207"
    const codigos = codigoItem.split(',').map(c => c.trim()).filter(Boolean);
    if (codigos.length === 1) {
      valores.push(`%${codigos[0]}%`);
      condiciones.push(`a.codigo_item ILIKE $${valores.length}`);
    } else if (codigos.length > 1) {
      const placeholders = codigos.map((c, i) => {
        valores.push(`%${c}%`);
        return `a.codigo_item ILIKE $${valores.length}`;
      });
      condiciones.push(`(${placeholders.join(' OR ')})`);
    }
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  valores.push(limite);

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
    LIMIT $${valores.length}
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

module.exports = {
  getProduccionProfesional,
  getProfesionales
};
