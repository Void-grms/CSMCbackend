/**
 * migracion_paquetes_2026.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Migración de catálogo: alinea los paquetes del sistema con la especificación
 * actualizada del PP 0131 (junio 2026).
 *
 * NO escribe directamente en las tablas base. Usa el servicio de versionado
 * (crearNuevaVersion), por lo que:
 *   • Crea una NUEVA versión de cada paquete modificado.
 *   • Actualiza paquete_version_actual y sincroniza las tablas canónicas.
 *   • Registra cada cambio en auditoria_ajustes.
 *   • Los paquetes YA ABIERTOS (paquete_paciente.version_catalogo) conservan su
 *     versión original y NO se ven afectados; el cambio aplica a aperturas y
 *     cálculos futuros.
 *
 * PRERREQUISITO: haber ejecutado migration_v3_ajustes.sql (versión 1 backfill).
 *
 * Uso:
 *   node scripts/migracion_paquetes_2026.js            # DRY-RUN: muestra diffs y revierte
 *   node scripts/migracion_paquetes_2026.js --apply    # Aplica y commitea
 *   node scripts/migracion_paquetes_2026.js --apply --limpieza-fina
 *
 * Flag --limpieza-fina: activa además las depuraciones "finas" (quitar códigos
 * sobrantes y Dx redundantes que la especificación ya no lista). Ver LIMPIEZA_FINA.
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const { Pool } = require('pg');
const {
  cargarPaqueteCompleto,
  crearNuevaVersion,
  generarDiff,
} = require('../src/ajustes/versionado');
const auditoria = require('../src/ajustes/auditoria');

const APLICAR        = process.argv.includes('--apply');
const LIMPIEZA_FINA  = process.argv.includes('--limpieza-fina');
const ACTOR          = { id: null, username: 'migracion_2026' };
const NOTA           = 'Alineación con especificación PP 0131 (jun-2026)';

// ── Helpers de rangos CIE-10 ────────────────────────────────────────────────
const rango  = (p3)        => Array.from({ length: 10 }, (_, i) => `${p3}${i}`);
const rangoP = (p3, a, b)  => Array.from({ length: b - a + 1 }, (_, i) => `${p3}${a + i}`);

// ═════════════════════════════════════════════════════════════════════════════
// ACTIVIDADES NUEVAS (upsert previo, requerido por FK de paquete_definicion)
//   5005194 — Rehabilitación psicosocial por consumo de alcohol (producto 3000881).
//   El seed original colgó el paquete 4.3 de ACT4 (5006282), que es la actividad
//   de "tratamiento ambulatorio"; la actividad correcta de rehabilitación es 5005194.
// ═════════════════════════════════════════════════════════════════════════════
const ACTIVIDADES_NUEVAS = [
  {
    id: 'ACT4B',
    codigo: '5005194',
    nombre: 'Rehabilitación psicosocial de personas con trastornos del comportamiento debido al consumo de alcohol',
  },
];

// ═════════════════════════════════════════════════════════════════════════════
// DEFINICIÓN DE CAMBIOS POR PAQUETE
//   dxAdd        : códigos CIE-10 a añadir al grupo_dx
//   dxRemove     : códigos a quitar (solo si --limpieza-fina cuando se marca fino)
//   idActividad  : reasigna el paquete a otra actividad (FK)
//   compUpsert   : { tipo_componente: { cantidad?, codigos?, usar_prefijo? } }
//                  si el componente existe se actualiza; si no, se crea
//   compRemove   : tipos de componente a eliminar
//   finoDxRemove / finoComp : cambios "finos" que solo se aplican con --limpieza-fina
// ═════════════════════════════════════════════════════════════════════════════
const CAMBIOS = [
  // ── ACT6 5005197 ──────────────────────────────────────────────────────────
  {
    id: 'PF_REHAB_PSICOSOCIAL',                 // 6.1
    dxAdd: rango('F27'),                        // F270–F279
    // Spec: 06 sesiones de TERAPIA DE REHABILITACIÓN COGNITIVA (96100.05)
    compUpsert: {
      sesiones_rehabilitacion: { cantidad: 6, codigos: ['96100.05'] },
    },
  },
  {
    id: 'PF_REHAB_LABORAL',                     // 6.2
    dxAdd: rango('F27'),
    // Componentes ya coinciden (6× 97537.01)
  },

  // ── ACT5 5005195 ──────────────────────────────────────────────────────────
  {
    id: 'PF_PSICOSIS',                          // 5.1 — espectro / CSMC
    dxAdd: ['F060', 'F061', 'F062', ...rango('F27')],
    // Spec añade terapia cognitiva (6) y TO grupal (4); ya NO lista intervención individual.
    compUpsert: {
      terapia_cognitiva:    { cantidad: 6, codigos: ['96100.05'] },
      otras_terapias_o_to:  { cantidad: 4, codigos: ['97535.01'] }, // TO grupal
    },
    compRemove: ['intervencion_individual'],
    // Fino: la spec restringe intervención familiar a solo C2111.01
    finoComp: {
      intervencion_familiar: { codigos: ['C2111.01'] },
    },
  },
  {
    id: 'PF_PRIMER_EPISODIO',                   // 5.2
    dxAdd: [
      'F060', 'F061', 'F062',
      'F200',
      ...rangoP('F22', 1, 7),                   // F221–F227
      ...rangoP('F25', 3, 7),                   // F253–F257
      ...rango('F27'),                          // F270–F279
    ],
    // Fino: la spec de "primer episodio" NO incluye F323/F333 (esos son del paquete espectro)
    finoDxRemove: ['F323', 'F333'],
    // NOTA ESTRUCTURAL: el sistema tiene además 5.4 (PF_PRIMER_EPISODIO_2) con F060–F062.
    // La spec describe UN solo "primer episodio". Decidir si se fusionan: no se toca 5.4 aquí.
  },
  {
    id: 'PF_DETERIORO_COGNITIVO',               // 5.3 — Alzheimer
    dxAdd: [...rango('G30'), 'G318', 'G328'],   // G300–G309, G318, G328
    // Spec simplifica a 5 componentes:
    compUpsert: {
      consulta_especializada: { cantidad: 4, codigos: ['99215'] },     // ya = 4
      psicoeducacion_familia: { cantidad: 2 },                         // 5 → 2 (interv. familiar, C2111.01)
      visita_o_movilizacion:  { cantidad: 1 },                         // 2 → 1
      terapia_cognitiva:      { cantidad: 6, codigos: ['96100.05'] },  // ya = 6
      otras_terapias_o_to:    { cantidad: 4, codigos: ['97535.01'] },  // TO grupal (quita Z501)
    },
    compRemove: [
      'evaluacion_integral',
      'consulta_sm',
      'psicoterapia',
      'intervencion_individual',
      'psicoeducacion',
      'rehabilitacion_laboral',
    ],
  },

  // ── ACT4 (alcohol y tabaco) ────────────────────────────────────────────────
  { id: 'PF_CONSUMO_PERJUDICIAL',   dxAdd: ['F131'] },          // 4.1
  { id: 'PF_DEPENDENCIA_ALC_TAB',   dxAdd: ['F132', 'F630'] },  // 4.2
  {
    id: 'PF_REHAB_PSICOSOCIAL_ALC',             // 4.3
    dxAdd: ['F630'],
    idActividad: 'ACT4B',                       // 5006282 → 5005194 (actividad correcta)
  },

  // ── ACT3 (afectivos) — falta psicoeducación en suicida y ansiedad ──────────
  {
    id: 'PF_CONDUCTA_SUICIDA',                  // 3.2
    compUpsert: { psicoeducacion: { cantidad: 1, codigos: ['99207.04'] } },
  },
  {
    id: 'PF_ANSIEDAD',                          // 3.3
    compUpsert: { psicoeducacion: { cantidad: 1, codigos: ['99207.04'] } },
  },

  // Fino: depuración de códigos sobrantes en otros paquetes (solo --limpieza-fina)
  {
    id: 'PF_AUTISMO',                           // 2.1
    finoComp: { grupal_to_tl: { codigos: ['99207.02'] } },      // quita 97009, Z507
  },
  {
    id: 'PF_TM_COMPORTAMIENTO',                 // 2.2
    finoComp: { consulta_sm: { codigos: ['99214.06', '99215'] } }, // quita 99207
  },
];

// ── Aplicación de un cambio sobre el payload cargado ────────────────────────
function aplicarCambios(payload, cambio) {
  const after = JSON.parse(JSON.stringify(payload));

  // actividad
  if (cambio.idActividad) after.id_actividad = cambio.idActividad;

  // grupo_dx
  const dx = new Set(after.grupo_dx);
  for (const c of cambio.dxAdd || []) dx.add(c);
  for (const c of cambio.dxRemove || []) dx.delete(c);
  if (LIMPIEZA_FINA) for (const c of cambio.finoDxRemove || []) dx.delete(c);
  after.grupo_dx = [...dx].sort();

  // componentes
  let comps = after.componentes.map(c => ({ ...c }));
  for (const tipo of cambio.compRemove || []) {
    comps = comps.filter(c => c.tipo_componente !== tipo);
  }
  const upserts = { ...(cambio.compUpsert || {}) };
  if (LIMPIEZA_FINA) Object.assign(upserts, cambio.finoComp || {});
  for (const [tipo, spec] of Object.entries(upserts)) {
    const ex = comps.find(c => c.tipo_componente === tipo);
    if (ex) {
      if (spec.cantidad     != null) ex.cantidad_minima = spec.cantidad;
      if (spec.codigos      != null) ex.codigos         = spec.codigos;
      if (spec.usar_prefijo != null) ex.usar_prefijo    = spec.usar_prefijo;
    } else {
      comps.push({
        tipo_componente: tipo,
        cantidad_minima: spec.cantidad,
        usar_prefijo:    !!spec.usar_prefijo,
        orden:           null,
        codigos:         spec.codigos || [],
      });
    }
  }
  after.componentes = comps;
  return after;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    client_encoding: 'utf8',
  });
  const client = await pool.connect();

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   MIGRACIÓN DE PAQUETES PP 0131 — alineación jun-2026          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Modo          : ${APLICAR ? 'APPLY (commit)' : 'DRY-RUN (rollback)'}`);
  console.log(`  Limpieza fina : ${LIMPIEZA_FINA ? 'SÍ' : 'no'}`);

  let conCambios = 0, sinCambios = 0, noEncontrados = 0;

  try {
    await client.query('BEGIN');

    // Upsert de actividades nuevas (FK previa)
    for (const a of ACTIVIDADES_NUEVAS) {
      await client.query(`
        INSERT INTO actividad (id_actividad, codigo, nombre)
        VALUES ($1, $2, $3)
        ON CONFLICT (id_actividad) DO UPDATE
          SET codigo = EXCLUDED.codigo, nombre = EXCLUDED.nombre
      `, [a.id, a.codigo, a.nombre]);
      console.log(`\n  + actividad ${a.id} (${a.codigo}) lista`);
    }

    for (const cambio of CAMBIOS) {
      const antes = await cargarPaqueteCompleto(client, cambio.id);
      if (!antes) {
        console.log(`\n  ⚠ ${cambio.id}: no existe en la BD — se omite`);
        noEncontrados++;
        continue;
      }

      const despues = aplicarCambios(antes, cambio);
      const diff = generarDiff(antes, despues);

      if (diff === 'Sin cambios detectados') {
        sinCambios++;
        continue;
      }

      conCambios++;
      console.log(`\n  ◆ ${cambio.id}  (v${antes.version} → v${antes.version + 1})`);
      console.log(`      ${diff.split(' | ').join('\n      ')}`);

      if (APLICAR) {
        const nuevaVersion = await crearNuevaVersion(client, despues, ACTOR.id, NOTA);
        const finalState = await cargarPaqueteCompleto(client, cambio.id);
        await auditoria.registrar(client, {
          entidad: 'paquete',
          entidadId: cambio.id,
          accion: 'editar',
          antes,
          despues: finalState,
          diffResumen: diff,
          usuario: ACTOR,
        });
        console.log(`      ✔ versión ${nuevaVersion} creada y marcada como actual`);
      }
    }

    if (APLICAR) {
      await client.query('COMMIT');
      console.log('\n  ✔ COMMIT realizado.');
    } else {
      await client.query('ROLLBACK');
      console.log('\n  ↩ ROLLBACK (dry-run). Nada se modificó. Ejecuta con --apply para confirmar.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`\n  ✖ Error — ROLLBACK: ${err.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }

  console.log('\n──────────────────────────────────────────────────────────────');
  console.log(`  Paquetes con cambios : ${conCambios}`);
  console.log(`  Sin cambios          : ${sinCambios}`);
  console.log(`  No encontrados       : ${noEncontrados}`);
  console.log('──────────────────────────────────────────────────────────────\n');
}

main();
