/**
 * reglasEspeciales.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Evaluador genérico de "reglas especiales" definidas en BD.
 *
 * Reemplaza el código hardcodeado que existía para:
 *   - PF_REHAB_PSICOSOCIAL_ALC: requiere F102 + Z502 en mismo mes
 *   - PF_CONTINUIDAD_CUIDADOS:  requiere código adicional (99207.09) en misma cita
 *
 * Tipos de regla soportados:
 *   - CODIGOS_MISMO_MES:   { codigos: ['X','Y'], tipo_dx_requerido?: 'D'|'P' }
 *   - CODIGOS_MISMA_CITA:  { codigos_adicionales: ['Z'] }
 *   - EXIGE_TIPO_DX:       { tipos_validos: ['D'] }
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Obtiene las reglas especiales activas para un paquete (en la versión actual).
 */
async function cargarReglasVersionActual(client, idPaquete) {
  const { rows } = await client.query(`
    SELECT pre.tipo_regla, pre.parametros
    FROM paquete_regla_especial pre
    JOIN paquete_version_actual pva
      ON pre.id_paquete = pva.id_paquete
     AND pre.version    = pva.version_actual
    WHERE pre.id_paquete = $1
      AND pre.activa     = TRUE
  `, [idPaquete]);
  return rows;
}

/**
 * Evalúa todas las reglas especiales de un paquete contra una atención candidata.
 * Devuelve true si TODAS las reglas pasan (o no hay reglas), false si alguna falla.
 */
async function evaluarReglas(client, idPaquete, atencion) {
  const reglas = await cargarReglasVersionActual(client, idPaquete);
  if (!reglas.length) return true;

  for (const r of reglas) {
    const ok = await evaluarUna(client, r.tipo_regla, r.parametros, atencion);
    if (!ok) return false;
  }
  return true;
}

async function evaluarUna(client, tipoRegla, params, atencion) {
  switch (tipoRegla) {
    case 'CODIGOS_MISMO_MES':
      return await reglaCodigosMismoMes(client, params, atencion);
    case 'CODIGOS_MISMA_CITA':
      return await reglaCodigosMismaCita(client, params, atencion);
    case 'EXIGE_TIPO_DX':
      return reglaExigeTipoDx(params, atencion);
    default:
      console.warn(`  ⚠️  Regla especial desconocida: ${tipoRegla}`);
      return true; // Si no la entendemos, no bloqueamos.
  }
}

/**
 * CODIGOS_MISMO_MES
 * Exige que el paciente tenga TODOS los códigos listados con tipo_dx_requerido
 * dentro del mismo mes calendario.
 */
async function reglaCodigosMismoMes(client, params, atencion) {
  const codigos = params.codigos || [];
  const tipoDxReq = params.tipo_dx_requerido || 'D';
  if (codigos.length < 2) return true; // Sin sentido con 0 o 1 código

  const { rows } = await client.query(`
    SELECT COUNT(DISTINCT codigo_item)::INT AS cuantos
    FROM atencion
    WHERE id_paciente = $1
      AND codigo_item = ANY($2)
      AND tipo_diagnostico = $3
      AND DATE_TRUNC('month', fecha_atencion) =
          DATE_TRUNC('month', $4::DATE)
  `, [atencion.id_paciente, codigos, tipoDxReq, atencion.fecha_atencion]);

  return rows[0].cuantos >= codigos.length;
}

/**
 * CODIGOS_MISMA_CITA
 * Exige que dentro de la misma id_cita exista al menos uno de los códigos adicionales.
 */
async function reglaCodigosMismaCita(client, params, atencion) {
  const codigos = params.codigos_adicionales || [];
  if (!codigos.length) return true;

  const { rows } = await client.query(`
    SELECT 1 FROM atencion
    WHERE id_cita     = $1
      AND id_paciente = $2
      AND codigo_item = ANY($3)
    LIMIT 1
  `, [atencion.id_cita, atencion.id_paciente, codigos]);

  return rows.length > 0;
}

/**
 * EXIGE_TIPO_DX
 * Restringe la apertura del paquete a tipos_diagnostico específicos.
 */
function reglaExigeTipoDx(params, atencion) {
  const tipos = params.tipos_validos || ['D'];
  return tipos.includes(atencion.tipo_diagnostico);
}

module.exports = {
  evaluarReglas,
  cargarReglasVersionActual,
};
