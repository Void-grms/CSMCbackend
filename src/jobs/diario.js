/**
 * diario.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Job diario de mantenimiento de paquetes terapéuticos PP 0131.
 *
 * Recalcula estados: detecta paquetes que pasaron a vencidos y actualiza
 * completados con las atenciones más recientes.
 *
 * Ejecución manual:
 *   node src/jobs/diario.js
 *
 * Como tarea programada (ver comentario al final del archivo).
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config({
  path: require('path').resolve(__dirname, '../../.env'),
});

const { calcularPaquetes } = require('../paquetes/calcularPaquetes');

async function main() {
  const inicio = new Date();
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              JOB DIARIO — PP 0131                          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Inicio: ${inicio.toISOString()}\n`);

  const resultado = await calcularPaquetes();

  const fin = new Date();
  const duracionSeg = ((fin - inicio) / 1000).toFixed(2);

  console.log('──────────────────────────────────────────────────────────────');
  console.log(`  Fin:      ${fin.toISOString()}`);
  console.log(`  Duración: ${duracionSeg} segundos`);
  console.log('──────────────────────────────────────────────────────────────');
  console.log('  Resumen de cambios:');
  console.log(`    Paquetes abiertos revisados : ${resultado.paquetesAbiertosEncontrados}`);
  console.log(`    Nuevos paquetes abiertos    : ${resultado.nuevosAbiertos}`);
  console.log(`    Pasaron a completado        : ${resultado.pasaronCompletado}`);
  console.log(`    Pasaron a vencido           : ${resultado.pasaronVencido}`);
  console.log(`    Errores individuales        : ${resultado.errores}`);
  console.log('──────────────────────────────────────────────────────────────\n');
}

main()
  .then(() => {
    console.log('✔ Job diario finalizado correctamente.\n');
    process.exit(0);
  })
  .catch((err) => {
    console.error(`\n✖ Error fatal en job diario: ${err.message}\n`);
    process.exit(1);
  });

// ─────────────────────────────────────────────────────────────────────────────
// CRON (Linux/Mac):
//   0 6 * * * cd /ruta/al/proyecto && node src/jobs/diario.js >> logs/diario.log 2>&1
//
// Programador de tareas (Windows):
//   schtasks /create /tn "PP0131 Job Diario" /tr "node C:\ruta\al\proyecto\src\jobs\diario.js" /sc daily /st 06:00
// ─────────────────────────────────────────────────────────────────────────────
