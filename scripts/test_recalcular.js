/**
 * test_recalcular.js — Prueba de integración del endpoint POST /api/database/recalcular
 *
 * Requisitos: el servidor debe estar corriendo (npm start) apuntando a una BD con
 * atenciones cargadas. Ajusta BASE con la URL del servidor si no es la de por defecto.
 *
 * Uso:
 *   node scripts/test_recalcular.js
 */
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

async function main() {
  // 1. Contar atenciones ANTES (vía periodos) para verificar que NO se borran.
  const periodosAntes = await (await fetch(`${BASE}/api/database/periodos`)).json();
  const totalAntes = (Array.isArray(periodosAntes) ? periodosAntes : [])
    .reduce((acc, p) => acc + (p.atenciones || 0), 0);
  console.log(`Atenciones antes: ${totalAntes}`);

  // 2. Llamar al endpoint de recálculo.
  const resp = await fetch(`${BASE}/api/database/recalcular`, { method: 'POST' });
  const data = await resp.json();
  console.log('Respuesta:', JSON.stringify(data, null, 2));

  // 3. Aserciones.
  const errores = [];
  if (resp.status !== 200) errores.push(`status esperado 200, recibido ${resp.status}`);
  if (data.ok !== true) errores.push(`ok esperado true, recibido ${data.ok}`);
  if (!data.contadores || typeof data.contadores.nuevosAbiertos !== 'number')
    errores.push('contadores ausentes o con forma inesperada');

  // 4. Atenciones DESPUÉS deben ser iguales (no se borró nada).
  const periodosDespues = await (await fetch(`${BASE}/api/database/periodos`)).json();
  const totalDespues = (Array.isArray(periodosDespues) ? periodosDespues : [])
    .reduce((acc, p) => acc + (p.atenciones || 0), 0);
  console.log(`Atenciones después: ${totalDespues}`);
  if (totalDespues !== totalAntes)
    errores.push(`atenciones cambiaron: antes ${totalAntes}, después ${totalDespues}`);

  if (errores.length) {
    console.error('\n✖ FALLÓ:\n  - ' + errores.join('\n  - '));
    process.exit(1);
  }
  console.log('\n✔ OK: recálculo correcto y atenciones intactas.');
}

main().catch((err) => { console.error('✖ Error:', err.message); process.exit(1); });
