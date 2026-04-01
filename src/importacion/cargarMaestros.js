/**
 * cargarMaestros.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo de importación de archivos CSV maestros (personal, registrador,
 * paciente) hacia PostgreSQL con upsert (ON CONFLICT ... DO UPDATE).
 *
 * Uso como módulo:
 *   const { cargarMaestro } = require('./cargarMaestros');
 *   await cargarMaestro('C:/ruta/al/MaestroPersonal_2025.csv');
 *
 * Uso desde CLI:
 *   node cargarMaestros.js "C:\ruta\al\archivo.csv"
 *
 * Requisitos:
 *   - .env con DATABASE_URL
 *   - Tablas profesional, registrador, paciente e historial_cargas creadas
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { Pool } = require('pg');
const iconv = require('iconv-lite');

// ── Helper: detectar codificación del archivo ────────────────────────────────
function detectarEncoding(rutaArchivo) {
  const fd = fs.openSync(rutaArchivo, 'r');
  const buf = Buffer.alloc(3);
  fs.readSync(fd, buf, 0, 3, 0);
  fs.closeSync(fd);
  return (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) ? 'utf8' : 'win1252';
}

function crearReadStream(rutaArchivo) {
  const enc = detectarEncoding(rutaArchivo);
  console.log(`  ℹ Codificación detectada: ${enc}`);
  const rs = fs.createReadStream(rutaArchivo);
  return enc === 'utf8' ? rs : rs.pipe(iconv.decodeStream(enc));
}

// ── Pool de conexión (singleton del módulo) ──────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  client_encoding: 'utf8',
});

// ── Definiciones de mapeo CSV → tabla por tipo de archivo ────────────────────
// Clave objeto columnas:  NombreColumnaCSV → nombre_columna_bd
const DEFINICIONES = {
  personal: {
    tabla: 'profesional',
    pk: 'id_personal',
    columnas: {
      Id_Personal: 'id_personal',
      Id_Tipo_Documento: 'id_tipo_documento',   // ← AÑADIR
      Numero_Documento: 'numero_documento',
      Apellido_Paterno_Personal: 'apellido_paterno',
      Apellido_Materno_Personal: 'apellido_materno',
      Nombres_Personal: 'nombres',
      Fecha_Nacimiento: 'fecha_nacimiento',
      Id_Condicion: 'id_condicion',        // ← AÑADIR
      Id_Profesion: 'id_profesion',
      Id_Colegio: 'id_colegio',          // ← AÑADIR
      Numero_Colegiatura: 'numero_colegiatura',  // ← AÑADIR
      Id_Establecimiento: 'id_establecimiento',
      Fecha_Alta: 'fecha_alta',
      Fecha_Baja: 'fecha_baja',
    },
  },
  registrador: {
    tabla: 'registrador',
    pk: 'id_registrador',
    columnas: {
      Id_Registrador: 'id_registrador',
      Numero_Documento: 'numero_documento',
      Apellido_Paterno_Registrador: 'apellido_paterno',
      Apellido_Materno_Registrador: 'apellido_materno',
      Nombres_Registrador: 'nombres',
    },
  },
  paciente: {
    tabla: 'paciente',
    pk: 'id_paciente',
    columnas: {
      Id_Paciente: 'id_paciente',
      Id_Tipo_Documento: 'id_tipo_documento',
      Numero_Documento: 'numero_documento',
      Apellido_Paterno_Paciente: 'apellido_paterno',
      Apellido_Materno_Paciente: 'apellido_materno',
      Nombres_Paciente: 'nombres',
      Fecha_Nacimiento: 'fecha_nacimiento',
      Genero: 'genero',
      Id_Etnia: 'id_etnia',
      Historia_Clinica: 'historia_clinica',
      domicilio_reniec: 'domicilio_reniec',
      domicilio_declarado: 'domicilio_declarado',
      Id_Establecimiento: 'id_establecimiento',
      Fecha_Alta: 'fecha_alta',
      Fecha_Modificacion: 'fecha_modificacion',
    },
  },
};

// ── Detectar tipo de maestro por nombre de archivo ───────────────────────────
function detectarTipo(nombreArchivo) {
  const nombre = nombreArchivo.toLowerCase();
  if (nombre.includes('personal')) return 'personal';
  if (nombre.includes('registrador')) return 'registrador';
  if (nombre.includes('paciente')) return 'paciente';
  return null;
}

// ── Construir sentencia SQL de upsert ────────────────────────────────────────
function construirUpsertSQL(def) {
  const columnasBD = Object.values(def.columnas);
  const placeholders = columnasBD.map((_, i) => `$${i + 1}`);

  // Columnas a actualizar = todas menos la PK (y columnas GENERATED)
  const colsUpdate = columnasBD
    .filter(c => c !== def.pk && c !== 'estado_activo')   // estado_activo es GENERATED
    .map(c => `${c} = EXCLUDED.${c}`);

  return `
    INSERT INTO ${def.tabla} (${columnasBD.join(', ')})
    VALUES (${placeholders.join(', ')})
    ON CONFLICT (${def.pk}) DO UPDATE SET
      ${colsUpdate.join(',\n      ')}
    RETURNING (xmax = 0) AS es_insert
  `;
}

// ── Limpiar valor: vacío → null, trim ────────────────────────────────────────
function limpiarValor(valor) {
  if (valor === undefined || valor === null) return null;
  const limpio = valor.trim();
  return limpio === '' ? null : limpio;
}

const COLUMNAS_FECHA = new Set([
  'Fecha_Nacimiento', 'Fecha_Alta', 'Fecha_Baja', 'Fecha_Modificacion',
]);

function parseFecha(valor) {
  if (!valor) return valor;
  const match = valor.match(/^(\d{1,2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return valor;
  const [, dia, mes, anio, hora, min] = match;
  const iso = `${anio}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  return hora ? `${iso} ${hora.padStart(2, '0')}:${min}` : iso;
}

// ── Función principal ────────────────────────────────────────────────────────
/**
 * Lee un archivo CSV de maestro y lo carga a PostgreSQL con upsert.
 *
 * @param {string}  rutaArchivo - Ruta absoluta al archivo CSV.
 * @param {string}  [usuario]   - Nombre del usuario (para historial_cargas).
 * @returns {Promise<object>}   - Resumen: { archivo, tabla, total, insertados, actualizados, errores }
 */
async function cargarMaestro(rutaArchivo, usuario = 'sistema') {
  // ── 1. Validar archivo y detectar tipo ──
  const nombreArchivo = path.basename(rutaArchivo);
  const tipo = detectarTipo(nombreArchivo);

  if (!tipo) {
    throw new Error(
      `No se pudo determinar el tipo de maestro para el archivo "${nombreArchivo}". ` +
      `El nombre debe contener "personal", "registrador" o "paciente".`
    );
  }

  if (!fs.existsSync(rutaArchivo)) {
    throw new Error(`El archivo no existe: ${rutaArchivo}`);
  }

  const def = DEFINICIONES[tipo];
  const sql = construirUpsertSQL(def);
  const columnasCSV = Object.keys(def.columnas);
  const columnasBD = Object.values(def.columnas);
  const indicePK = columnasBD.indexOf(def.pk);

  // Contadores
  let total = 0;
  let insertados = 0;
  let actualizados = 0;
  let errores = 0;

  // ── 2. Crear parser como iterable asíncrono (streaming con contrapresión) ──
  const parser = crearReadStream(rutaArchivo)
    .pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,     // ignorar BOM de archivos exportados desde Excel
        relax_column_count: true,   // tolerar filas con columnas de más/menos
      })
    );

  // ── 3. Procesar fila a fila con for-await (gestión de contrapresión) ──
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for await (const row of parser) {
      total++;

      // ← NUEVO: savepoint por fila
      await client.query('SAVEPOINT fila_sp');

      try {
        const valores = columnasCSV.map(colCSV => {
          const v = limpiarValor(row[colCSV]);
          return COLUMNAS_FECHA.has(colCSV) ? parseFecha(v) : v;
        });

        if (!valores[indicePK]) {
          errores++;
          await client.query('RELEASE SAVEPOINT fila_sp'); // liberar igual
          console.warn(` ⚠ Fila ${total}: PK "${def.pk}" vacía — se omite.`);
          continue;
        }

        const result = await client.query(sql, valores);
        await client.query('RELEASE SAVEPOINT fila_sp'); // ← confirmar savepoint

        if (result.rows[0].es_insert) {
          insertados++;
        } else {
          actualizados++;
        }

      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT fila_sp'); // ← revertir solo esta fila
        errores++;
        console.error(` ✖ Fila ${total}: ${err.message}`);
      }
    }


    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // ── 4. Registrar en historial_cargas ──
  await pool.query(
    `INSERT INTO historial_cargas (archivo, tipo, registros_procesados, usuario)
     VALUES ($1, $2, $3, $4)`,
    [nombreArchivo, tipo, total - errores, usuario]
  );

  // ── 5. Resumen ──
  const resumen = { archivo: nombreArchivo, tabla: def.tabla, total, insertados, actualizados, errores };

  console.log('\n══════════════════════════════════════════════════');
  console.log('  RESUMEN DE CARGA DE MAESTRO');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Archivo       : ${resumen.archivo}`);
  console.log(`  Tabla destino : ${resumen.tabla}`);
  console.log(`  Total filas   : ${resumen.total}`);
  console.log(`  Insertados    : ${resumen.insertados}`);
  console.log(`  Actualizados  : ${resumen.actualizados}`);
  console.log(`  Errores       : ${resumen.errores}`);
  console.log('══════════════════════════════════════════════════\n');

  return resumen;
}

// ── Exportar ─────────────────────────────────────────────────────────────────
module.exports = { cargarMaestro };

// ── Ejecución directa desde CLI ──────────────────────────────────────────────
// node cargarMaestros.js "C:\ruta\al\archivo.csv"
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Uso: node cargarMaestros.js <ruta_archivo_csv>');
    process.exit(1);
  }

  cargarMaestro(args[0])
    .then(() => {
      console.log('✔ Carga finalizada exitosamente.');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`✖ Error fatal: ${err.message}`);
      process.exit(1);
    });
}
