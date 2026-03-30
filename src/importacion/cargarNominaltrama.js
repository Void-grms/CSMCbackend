/**
 * cargarNominaltrama.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Carga un archivo nominaltramaYYYYMM.csv a la tabla `atencion` con upsert
 * en lotes de 500 filas. Al finalizar registra la carga en `historial_cargas`
 * y llama automáticamente a calcularPaquetes().
 *
 * Estrategia de transacciones:
 *   - Una transacción global (BEGIN / COMMIT) para toda la carga.
 *   - Cada lote se protege con SAVEPOINT / RELEASE SAVEPOINT.
 *   - Si un lote falla: ROLLBACK TO SAVEPOINT, reintentar fila por fila.
 *   - Cada fila del reintento usa su propio SAVEPOINT para no abortar
 *     la transacción si una fila individual falla.
 *   → Esto elimina el error PostgreSQL 25P02.
 *
 * Uso como módulo:
 *   const { cargarNominaltrama } = require('./cargarNominaltrama');
 *   await cargarNominaltrama('C:/ruta/nominaltrama202501.csv');
 *
 * Uso desde CLI:
 *   node cargarNominaltrama.js "C:\ruta\nominaltrama202501.csv"
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { Pool }  = require('pg');
const iconv = require('iconv-lite');

// ── Helper: detectar codificación del archivo ────────────────────────────────
// Si el archivo tiene BOM UTF-8 (0xEF 0xBB 0xBF), se lee como UTF-8.
// De lo contrario, se asume Windows-1252 (codificación estándar del HIS MINSA).
function detectarEncoding(rutaArchivo) {
  const fd = fs.openSync(rutaArchivo, 'r');
  const buf = Buffer.alloc(3);
  fs.readSync(fd, buf, 0, 3, 0);
  fs.closeSync(fd);
  return (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) ? 'utf8' : 'win1252';
}

/** Crea un stream de lectura con la codificación correcta auto-detectada. */
function crearReadStream(rutaArchivo) {
  const enc = detectarEncoding(rutaArchivo);
  console.log(`  ℹ Codificación detectada: ${enc}`);
  const rs = fs.createReadStream(rutaArchivo);
  return enc === 'utf8' ? rs : rs.pipe(iconv.decodeStream(enc));
}

// ── Carga anticipada de calcularPaquetes (Bug #4: evita error silencioso en catch) ──
let calcularPaquetesFn = null;
try {
  const mod = require('../paquetes/calcularPaquetes');
  calcularPaquetesFn = mod.calcularPaquetes;
} catch (err) {
  console.warn(`⚠ calcularPaquetes no disponible al iniciar el módulo: ${err.message}`);
  console.warn('  Los paquetes NO se recalcularán automáticamente tras cada carga.\n');
}

// ── Pool de conexión ─────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  client_encoding: 'utf8',
});

// ── Constantes ───────────────────────────────────────────────────────────────
const BATCH_SIZE    = 500;
const PROGRESS_EACH = 5000;

// ── Regex para validar nombre de archivo ─────────────────────────────────────
const NOMBRE_REGEX = /^nominaltrama(\d{4})(\d{2})\.csv$/i;

// ── Mapeo columnas CSV → columnas BD ─────────────────────────────────────────
const MAPEO_COLUMNAS = [
  { csv: 'Id_Cita',                       bd: 'id_cita' },            // 0
  { csv: 'Id_Correlativo',                bd: 'id_correlativo' },     // 1
  { csv: 'Fecha_Atencion',                bd: 'fecha_atencion' },     // 2
  { csv: 'Anio',                          bd: 'anio' },               // 3
  { csv: 'Mes',                           bd: 'mes' },                // 4
  { csv: 'Dia',                           bd: 'dia' },                // 5
  { csv: 'Id_Paciente',                   bd: 'id_paciente' },        // 6
  { csv: 'Id_Personal',                   bd: 'id_personal' },        // 7
  { csv: 'Id_Registrador',                bd: 'id_registrador' },     // 8
  { csv: 'Id_Ups',                        bd: 'id_ups' },             // 9
  { csv: 'Id_Establecimiento',            bd: 'id_establecimiento' }, // 10
  { csv: 'Id_Financiador',                bd: 'id_financiador' },     // 11
  { csv: 'Id_Condicion_Establecimiento',  bd: 'id_condicion_establecimiento' }, // 12
  { csv: 'Id_Condicion_Servicio',         bd: 'id_condicion_servicio' },        // 13
  { csv: 'Id_Turno',                      bd: 'id_turno' },           // 14
  { csv: 'Codigo_Item',                   bd: 'codigo_item' },        // 15
  { csv: 'Tipo_Diagnostico',              bd: 'tipo_diagnostico' },   // 16
  { csv: 'Valor_Lab',                     bd: 'valor_lab' },          // 17
  { csv: 'Id_Correlativo_Lab',            bd: 'id_correlativo_lab' }, // 18
  { csv: 'Edad_Reg',                      bd: 'edad_reg' },           // 19
  { csv: 'Tipo_Edad',                     bd: 'tipo_edad' },          // 20
  { csv: 'Peso',                          bd: 'peso' },               // 21
  { csv: 'Talla',                         bd: 'talla' },              // 22
  { csv: 'Hemoglobina',                   bd: 'hemoglobina' },        // 23
  { csv: 'Fecha_Registro',                bd: 'fecha_registro' },     // 24
  { csv: 'Fecha_Modificacion',            bd: 'fecha_modificacion' }, // 25
  { csv: null,                            bd: 'id_actividad' },       // 26 — se llena manualmente (APP*)
];

const COLUMNAS_BD  = MAPEO_COLUMNAS.map(m => m.bd);
const NUM_COLS     = COLUMNAS_BD.length;

// Índices de campos críticos (para validación rápida sin búsqueda por nombre)
const IDX_ID_CITA        = 0;
const IDX_ID_CORRELATIVO = 1;
const IDX_FECHA_ATENCION = 2;
const IDX_ID_PACIENTE    = 6;
const IDX_CODIGO_ITEM    = 15;
const IDX_ID_ACTIVIDAD   = MAPEO_COLUMNAS.findIndex(m => m.bd === 'id_actividad');

// Regex para detectar códigos de actividad colectiva/institucional (APP seguido de dígitos)
const ACTIVIDAD_REGEX = /^APP\d+$/i;

// Conjuntos de tipos de columna
const COLS_INT     = new Set(['id_correlativo', 'anio', 'mes', 'dia', 'id_correlativo_lab', 'edad_reg']);
const COLS_NUMERIC = new Set(['peso', 'talla', 'hemoglobina']);
const COLS_FECHA   = new Set(['fecha_atencion', 'fecha_registro', 'fecha_modificacion']);

// ── Regex de validación de fechas ────────────────────────────────────────────
// Acepta: YYYY-MM-DD, YYYY/MM/DD, DD-MM-YYYY, DD/MM/YYYY y variantes con T
const FECHA_DATE_RE      = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/;
const FECHA_DATE_INV_RE  = /^\d{1,2}[-/]\d{1,2}[-/]\d{4}/;
const FECHA_TIMESTAMP_RE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}[T ]\d{1,2}:\d{1,2}/;

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Limpia y convierte un valor según el tipo de columna BD.
 * Nunca lanza excepción: devuelve null si el valor es inválido.
 */
function convertirValor(valor, columnaBD) {
  if (valor === undefined || valor === null) return null;
  const limpio = String(valor).trim();
  if (limpio === '') return null;

  // ── Enteros ──
  if (COLS_INT.has(columnaBD)) {
    // Eliminar caracteres no numéricos (excepto signo negativo al inicio)
    const sanitizado = limpio.replace(/(?!^)-/g, '').replace(/[^\d-]/g, '');
    const n = parseInt(sanitizado, 10);
    return isNaN(n) ? null : n;
  } else

  // ── Decimales ──
  if (COLS_NUMERIC.has(columnaBD)) {
    // Aceptar coma como separador decimal (convención latina)
    const sanitizado = limpio.replace(',', '.');
    const n = parseFloat(sanitizado);
    if (isNaN(n) || !isFinite(n)) return null;
    // Rangos razonables: peso 0-500, talla 0-300, hemoglobina 0-30
    if (columnaBD === 'peso'        && (n < 0 || n > 500))  return null;
    if (columnaBD === 'talla'       && (n < 0 || n > 300))  return null;
    if (columnaBD === 'hemoglobina' && (n < 0 || n > 30))   return null;
    return n;
  } else

  // ── Fechas ──
  if (COLS_FECHA.has(columnaBD)) {
    // Verificar que al menos luce como fecha antes de parsear
    if (!FECHA_DATE_RE.test(limpio) &&
        !FECHA_DATE_INV_RE.test(limpio) &&
        !FECHA_TIMESTAMP_RE.test(limpio)) {
      return null;
    }
    const d = new Date(limpio);
    if (isNaN(d.getTime())) return null;
    // Rango razonable: 1900–2100
    const year = d.getFullYear();
    if (year < 1900 || year > 2100) return null;
    return limpio;
  } else

  // ── Texto (truncar a 500 caracteres como protección) ──
  return limpio.length > 500 ? limpio.substring(0, 500) : limpio;
}

/** Valida el nombre del archivo y extrae año/mes. */
function validarNombre(nombreArchivo) {
  const match = NOMBRE_REGEX.exec(nombreArchivo);
  if (!match) {
    throw new Error(
      `Nombre de archivo inválido: "${nombreArchivo}". ` +
      `Se esperaba el patrón nominaltrama<YYYY><MM>.csv (ej: nominaltrama202501.csv).`
    );
  }
  const anio = parseInt(match[1], 10);
  const mes  = parseInt(match[2], 10);
  if (mes < 1 || mes > 12) {
    throw new Error(`Mes inválido en nombre de archivo: ${mes}. Debe estar entre 01 y 12.`);
  }
  return { anio, mes };
}

/**
 * Valida campos obligatorios de una fila ya convertida.
 * Retorna null si es válida, o un string con el motivo si no.
 */
function validarFila(valores, numFila) {
  if (!valores[IDX_ID_CITA]) {
    return `Fila ${numFila}: id_cita vacío`;
  }
  if (valores[IDX_ID_CORRELATIVO] === null || valores[IDX_ID_CORRELATIVO] === undefined) {
    return `Fila ${numFila}: id_correlativo vacío`;
  }
  if (!valores[IDX_FECHA_ATENCION]) {
    return `Fila ${numFila}: fecha_atencion vacía o inválida`;
  }
  if (!valores[IDX_CODIGO_ITEM]) {
    return `Fila ${numFila}: codigo_item vacío`;
  }

  // Aceptar filas con paciente O con actividad (APP*), pero no ambos vacíos
  const tienePaciente  = !!valores[IDX_ID_PACIENTE];
  const tieneActividad = !!valores[IDX_ID_ACTIVIDAD];
  if (!tienePaciente && !tieneActividad) {
    return `Fila ${numFila}: id_paciente e id_actividad ambos vacíos`;
  }

  return null; // válida
}

/**
 * Construye un SQL multi-row upsert para N filas.
 */
function construirBatchSQL(cantFilas) {
  const valuesRows = [];
  for (let fila = 0; fila < cantFilas; fila++) {
    const offset = fila * NUM_COLS;
    const placeholders = COLUMNAS_BD.map((_, i) => `$${offset + i + 1}`);
    valuesRows.push(`(${placeholders.join(', ')})`);
  }

  const pks = new Set(['id_cita', 'id_correlativo']);
  const colsUpdate = COLUMNAS_BD
    .filter(c => !pks.has(c))
    .map(c => `${c} = EXCLUDED.${c}`);

  return `
    INSERT INTO atencion (${COLUMNAS_BD.join(', ')})
    VALUES ${valuesRows.join(',\n           ')}
    ON CONFLICT (id_cita, id_correlativo) DO UPDATE SET
      ${colsUpdate.join(',\n      ')}
    RETURNING (xmax = 0) AS es_insert
  `;
}

// Pre-construir el SQL de una sola fila (se reutiliza miles de veces en fallback)
const SQL_UNA_FILA = construirBatchSQL(1);

/**
 * Registra un error de fila en consola con toda la información de diagnóstico.
 */
function logErrorFila(fila, err, contexto = '') {
  const id_cita        = fila[IDX_ID_CITA]        || '?';
  const id_correlativo = fila[IDX_ID_CORRELATIVO]  ?? '?';
  console.error(`  ✖ ${contexto}Fila id_cita=${id_cita}, id_correlativo=${id_correlativo}`);
  console.error(`    mensaje:    ${err.message}`);
  if (err.detail)     console.error(`    detalle:    ${err.detail}`);
  if (err.code)       console.error(`    código PG:  ${err.code}`);
  if (err.constraint) console.error(`    constraint: ${err.constraint}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// FLUSH DE LOTE CON SAVEPOINTS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Inserta un lote de filas protegido por SAVEPOINT.
 *
 * Estrategia:
 *   1. SAVEPOINT sp_lote_N
 *   2. Intentar INSERT multi-row del lote completo
 *   3a. Éxito → RELEASE SAVEPOINT (liberar recursos del savepoint)
 *   3b. Error → ROLLBACK TO SAVEPOINT → reintentar fila por fila
 *       Cada fila individual también usa SAVEPOINT / RELEASE / ROLLBACK
 *       para que una fila mala NO aborte la transacción.
 *
 * @param {import('pg').PoolClient} client
 * @param {Array[]} filas       - Array de arrays de valores
 * @param {number}  numLote     - Número secuencial del lote (para nombre del savepoint)
 * @param {object}  contadores  - Referencia mutable a { insertados, actualizados, errores }
 */
async function flushLote(client, filas, numLote, contadores) {
  if (filas.length === 0) return;

  const spName = `sp_lote_${numLote}`;

  await client.query(`SAVEPOINT ${spName}`);

  try {
    const sql    = construirBatchSQL(filas.length);
    const params = filas.flat();
    const result = await client.query(sql, params);

    for (const row of result.rows) {
      if (row.es_insert) contadores.insertados++;
      else contadores.actualizados++;
    }

    // ✅ Éxito — liberar el savepoint para no acumular recursos
    await client.query(`RELEASE SAVEPOINT ${spName}`);

  } catch (err) {
    // ❌ El lote falló — revertir solo este lote
    await client.query(`ROLLBACK TO SAVEPOINT ${spName}`);
    // Liberar el savepoint revertido
    await client.query(`RELEASE SAVEPOINT ${spName}`);

    console.warn(`\n  ⚠ Lote #${numLote} falló (${filas.length} filas): ${err.message}`);
    console.warn(`    Reintentando fila por fila...\n`);

    // ── Reintento fila por fila, cada una con su propio savepoint ──
    for (let i = 0; i < filas.length; i++) {
      const fila   = filas[i];
      const spFila = `sp_fila_${numLote}_${i}`;

      await client.query(`SAVEPOINT ${spFila}`);

      try {
        const result = await client.query(SQL_UNA_FILA, fila);

        if (result.rows[0].es_insert) contadores.insertados++;
        else contadores.actualizados++;

        await client.query(`RELEASE SAVEPOINT ${spFila}`);

      } catch (errFila) {
        await client.query(`ROLLBACK TO SAVEPOINT ${spFila}`);
        await client.query(`RELEASE SAVEPOINT ${spFila}`);

        contadores.errores++;
        logErrorFila(fila, errFila);
      }
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PRE-CARGA DE PROFESIONALES FALTANTES
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Escanea el CSV para extraer Id_Personal únicos e insertarlos en la tabla
 * profesional si no existen aún. Esto evita violaciones de FK al insertar
 * atenciones.
 *
 * Lógica de derivación:
 *   Id_Personal = numero_documento + id_establecimiento
 *   Ej: 1614498736275 → doc=16144987, est=36275
 *
 * @param {import('pg').PoolClient} client
 * @param {string} rutaArchivo - Ruta al CSV nominaltrama
 */
async function upsertProfesionalesFaltantes(client, rutaArchivo) {
  console.log('  ▶ Verificando profesionales referenciados en el CSV...\n');

  // Leer el CSV una vez para extraer profesionales únicos
  const profesionales = await new Promise((resolve, reject) => {
    const mapa = new Map(); // id_personal → id_establecimiento
    const stream = crearReadStream(rutaArchivo)
      .pipe(
        parse({
          columns:            true,
          skip_empty_lines:   true,
          trim:               true,
          bom:                true,
          relax_column_count: true,
        })
      );

    stream.on('data', (row) => {
      const id  = (row['Id_Personal'] || '').trim();
      const est = (row['Id_Establecimiento'] || '').trim();
      if (id && !mapa.has(id)) mapa.set(id, est);
    });
    stream.on('end',   () => resolve(mapa));
    stream.on('error', (err) => reject(err));
  });

  let nuevos = 0;

  for (const [id_personal, id_establecimiento] of profesionales) {
    // Derivar numero_documento quitando el sufijo del establecimiento
    const num_doc = (id_establecimiento && id_personal.endsWith(id_establecimiento))
      ? id_personal.slice(0, -id_establecimiento.length)
      : null;

    const res = await client.query(
      `INSERT INTO profesional (id_personal, numero_documento, id_establecimiento)
       VALUES ($1, $2, $3)
       ON CONFLICT (id_personal) DO NOTHING`,
      [id_personal, num_doc, id_establecimiento]
    );
    if (res.rowCount > 0) nuevos++;
  }

  console.log(`  ✔ Profesionales verificados: ${profesionales.size} únicos, ${nuevos} nuevos registrados.\n`);
}

// ═════════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Carga un archivo nominaltrama CSV a la tabla atencion.
 *
 * @param {string}  rutaArchivo - Ruta absoluta al CSV.
 * @param {string}  [usuario]   - Usuario para historial_cargas.
 * @returns {Promise<object>}   - Resumen de la carga.
 */
async function cargarNominaltrama(rutaArchivo, usuario = 'sistema') {
  // ── 1. Validaciones ──
  const nombreArchivo = path.basename(rutaArchivo);
  const { anio, mes } = validarNombre(nombreArchivo);

  if (!fs.existsSync(rutaArchivo)) {
    throw new Error(`El archivo no existe: ${rutaArchivo}`);
  }

  console.log(`\n▶ Cargando nominaltrama — Periodo: ${anio}-${String(mes).padStart(2, '0')}`);
  console.log(`  Archivo: ${nombreArchivo}\n`);

  // Contadores (objeto mutable para pasar por referencia a flushLote)
  const contadores = {
    total:        0,
    insertados:   0,
    actualizados: 0,
    errores:      0,
    descartadas:  0,  // filas descartadas por validación previa
  };

  let lote    = [];
  let numLote = 0;

  // ── 2. Crear parser streaming ──
  const parser = crearReadStream(rutaArchivo)
    .pipe(
      parse({
        columns:            true,
        skip_empty_lines:   true,
        trim:               true,
        bom:                true,
        relax_column_count: true,
      })
    );

  // ── 3. Procesar con streaming + lotes ──
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Paso previo: asegurar que todos los profesionales del CSV existan en la BD
    await upsertProfesionalesFaltantes(client, rutaArchivo);

    for await (const row of parser) {
      contadores.total++;

      // Mapear columnas CSV → valores convertidos
      const valores = MAPEO_COLUMNAS.map(m => {
        if (m.csv === null) return null; // columnas derivadas (id_actividad)
        return convertirValor(row[m.csv], m.bd);
      });

      // ── Detectar actividades colectivas/institucionales (APP*) ──
      const idPacienteRaw = (row['Id_Paciente'] || '').trim();
      if (ACTIVIDAD_REGEX.test(idPacienteRaw)) {
        valores[IDX_ID_PACIENTE]  = null;          // sin FK a paciente
        valores[IDX_ID_ACTIVIDAD] = idPacienteRaw; // preservar el código APP
      } else {
        valores[IDX_ID_ACTIVIDAD] = null;           // atención individual normal
      }

      // Validar campos obligatorios ANTES de agregar al lote
      const motivo = validarFila(valores, contadores.total);
      if (motivo) {
        contadores.descartadas++;
        // Solo loguear las primeras 20 para no saturar la consola
        if (contadores.descartadas <= 20) {
          console.warn(`  ⚠ ${motivo} — se omite.`);
        } else if (contadores.descartadas === 21) {
          console.warn(`  ⚠ ... se omiten más filas con campos vacíos (log truncado).`);
        }
        continue;
      }

      lote.push(valores);

      // Flush cuando el lote alcanza BATCH_SIZE
      if (lote.length >= BATCH_SIZE) {
        numLote++;
        await flushLote(client, lote, numLote, contadores);
        lote = [];
      }

      // Progreso
      if (contadores.total % PROGRESS_EACH === 0) {
        console.log(`  Procesadas ${contadores.total} filas...`);
      }
    }

    // Flush del último lote parcial
    if (lote.length > 0) {
      numLote++;
      await flushLote(client, lote, numLote, contadores);
      lote = [];
    }

    await client.query('COMMIT');

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // ── 4. Registrar en historial_cargas ──
  const procesados = contadores.insertados + contadores.actualizados;
  await pool.query(
    `INSERT INTO historial_cargas (archivo, tipo, registros_procesados, usuario)
     VALUES ($1, $2, $3, $4)`,
    [nombreArchivo, 'nominaltrama', procesados, usuario]
  );

  // ── 5. Resumen ──
  const resumen = {
    archivo:      nombreArchivo,
    tabla:        'atencion',
    anio,
    mes,
    total:        contadores.total,
    insertados:   contadores.insertados,
    actualizados: contadores.actualizados,
    descartadas:  contadores.descartadas,
    errores:      contadores.errores,
    paquetes_recalculados: false,
    paquetes_error:        null,
  };

  console.log('\n══════════════════════════════════════════════════');
  console.log('  RESUMEN DE CARGA DE NOMINALTRAMA');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Archivo       : ${resumen.archivo}`);
  console.log(`  Periodo       : ${resumen.anio}-${String(resumen.mes).padStart(2, '0')}`);
  console.log(`  Total filas   : ${resumen.total}`);
  console.log(`  Insertadas    : ${resumen.insertados}`);
  console.log(`  Actualizadas  : ${resumen.actualizados}`);
  console.log(`  Descartadas   : ${resumen.descartadas}`);
  console.log(`  Errores BD    : ${resumen.errores}`);
  console.log('══════════════════════════════════════════════════\n');

  // ── 6. Recalcular paquetes automáticamente ──
  if (calcularPaquetesFn) {
    try {
      console.log('▶ Iniciando recálculo de paquetes terapéuticos...\n');
      await calcularPaquetesFn(anio, mes);
      console.log('✔ Recálculo de paquetes finalizado.\n');
      resumen.paquetes_recalculados = true;
      resumen.paquetes_error        = null;
    } catch (err) {
      console.error(`⚠ calcularPaquetes falló: ${err.message}`);
      console.error('  La carga de datos fue exitosa, pero los paquetes no se recalcularon.');
      console.error('  Ejecute calcularPaquetes manualmente cuando esté disponible.\n');
      resumen.paquetes_recalculados = false;
      resumen.paquetes_error        = err.message;
    }
  } else {
    console.warn('⚠ calcularPaquetes no disponible — se omite el recálculo.\n');
    resumen.paquetes_recalculados = false;
    resumen.paquetes_error        = 'Módulo calcularPaquetes no encontrado al iniciar';
  }

  return resumen;
}

// ── Exportar ─────────────────────────────────────────────────────────────────
module.exports = { cargarNominaltrama };

// ── Ejecución directa desde CLI ──────────────────────────────────────────────
// node cargarNominaltrama.js "C:\ruta\nominaltrama202501.csv"
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Uso: node cargarNominaltrama.js <ruta_archivo_csv>');
    process.exit(1);
  }

  cargarNominaltrama(args[0])
    .then(() => {
      console.log('✔ Proceso completo.');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`✖ Error fatal: ${err.message}`);
      process.exit(1);
    });
}