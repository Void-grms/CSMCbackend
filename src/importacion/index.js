/**
 * index.js — CLI de importación
 * ─────────────────────────────────────────────────────────────────────────────
 * Punto de entrada único para cargar cualquier CSV del HIS MINSA.
 *
 * Uso:
 *   node src/importacion/index.js <ruta_del_archivo.csv>
 *
 * Ejemplos:
 *   node src/importacion/index.js ./datos/nominaltrama202501.csv
 *   node src/importacion/index.js ./datos/maestro_paciente.csv
 *   node src/importacion/index.js ./datos/maestro_personal_2025.csv
 *   node src/importacion/index.js ./datos/registrador.csv
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config({
  path: require('path').resolve(__dirname, '../../.env')
});

const path = require('path');
const { cargarMaestro }      = require('./cargarMaestros');
const { cargarNominaltrama } = require('./cargarNominaltrama');

// ── Verificar conexión configurada ───────────────────────────────────────────
if (!process.env.DATABASE_URL) {
  console.error('\n✖ ERROR: No se encontró la variable DATABASE_URL en el archivo .env\n');
  console.error('Ejemplo de .env:\n');
  console.error('DATABASE_URL=postgresql://postgres:password@localhost:5432/csmc_paquetes\n');
  process.exit(1);
}

// ── Detectar tipo de archivo ─────────────────────────────────────────────────
function detectarTipo(nombreArchivo) {
  const nombre = nombreArchivo.toLowerCase();

  if (nombre.includes('nominaltrama')) return 'nominaltrama';
  if (nombre.includes('personal')) return 'maestro';
  if (nombre.includes('registrador')) return 'maestro';
  if (nombre.includes('paciente')) return 'maestro';

  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {

  const rutaArchivo = process.argv[2];

  if (!rutaArchivo) {
    console.error('\nUso: node src/importacion/index.js <ruta_del_archivo.csv>\n');
    console.error('Ejemplos:');
    console.error('  node src/importacion/index.js ./datos/nominaltrama202501.csv');
    console.error('  node src/importacion/index.js ./datos/maestro_paciente.csv');
    process.exit(1);
  }

  const rutaAbsoluta  = path.resolve(rutaArchivo);
  const nombreArchivo = path.basename(rutaAbsoluta);
  const tipo          = detectarTipo(nombreArchivo);

  console.log(`\n📂 Archivo: ${nombreArchivo}`);

  if (tipo === 'nominaltrama') {

    console.log('   Tipo detectado: nominaltrama (atenciones mensuales)\n');

    await cargarNominaltrama(rutaAbsoluta);

  } else if (tipo === 'maestro') {

    console.log('   Tipo detectado: maestro (personal / registrador / paciente)\n');

    await cargarMaestro(rutaAbsoluta);

  } else {

    console.error(
      `\n✖ No se reconoce el tipo de archivo "${nombreArchivo}".\n` +
      `El nombre debe contener una de estas palabras clave:\n` +
      `  • "nominaltrama"  → carga de atenciones mensuales\n` +
      `  • "personal"      → maestro de profesionales\n` +
      `  • "registrador"   → maestro de registradores\n` +
      `  • "paciente"      → maestro de pacientes\n`
    );

    process.exit(1);
  }
}

// ── Ejecutar ─────────────────────────────────────────────────────────────────
main()
  .then(() => {
    console.log('\n✔ Importación finalizada correctamente.\n');
    process.exit(0);
  })
  .catch((err) => {
    console.error(`\n✖ Error fatal: ${err.message}\n`);
    process.exit(1);
  });

console.log("ENV:", process.env);