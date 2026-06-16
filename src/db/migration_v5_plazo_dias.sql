-- =============================================================================
-- migration_v5_plazo_dias.sql
-- -----------------------------------------------------------------------------
-- Cambia la unidad del plazo de los paquetes de MESES a DÍAS.
--
--   • Renombra plazo_meses → plazo_dias en paquete_definicion y
--     paquete_definicion_version (DEFAULT 8 → DEFAULT 269).
--   • Fija el plazo: 269 días para todos los paquetes; 209 para PF_PSICOSIS.
--   • Recalcula fecha_limite de los paquetes ya abiertos
--     (fecha_inicio + plazo_dias días) según la definición vigente.
--   • Re-evalúa el estado de los paquetes NO completados (abierto / vencido).
--
-- Idempotente: puede ejecutarse varias veces sin error.
-- =============================================================================

-- ── 1. Renombrar columna en paquete_definicion ──────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'paquete_definicion' AND column_name = 'plazo_meses'
  ) THEN
    ALTER TABLE paquete_definicion RENAME COLUMN plazo_meses TO plazo_dias;
  END IF;
END $$;

ALTER TABLE paquete_definicion ALTER COLUMN plazo_dias SET DEFAULT 269;

-- ── 2. Renombrar columna en paquete_definicion_version ──────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'paquete_definicion_version' AND column_name = 'plazo_meses'
  ) THEN
    ALTER TABLE paquete_definicion_version RENAME COLUMN plazo_meses TO plazo_dias;
  END IF;
END $$;

ALTER TABLE paquete_definicion_version ALTER COLUMN plazo_dias SET DEFAULT 269;

-- ── 3. Fijar valores del plazo (en días) ────────────────────────────────────
-- Catálogo vigente (paquete_definicion)
UPDATE paquete_definicion
   SET plazo_dias = 269
 WHERE id_paquete <> 'PF_PSICOSIS';

UPDATE paquete_definicion
   SET plazo_dias = 209
 WHERE id_paquete = 'PF_PSICOSIS';

-- Versiones vigentes (solo la versión apuntada por paquete_version_actual)
UPDATE paquete_definicion_version pdv
   SET plazo_dias = CASE WHEN pdv.id_paquete = 'PF_PSICOSIS' THEN 209 ELSE 269 END
  FROM paquete_version_actual pva
 WHERE pva.id_paquete     = pdv.id_paquete
   AND pva.version_actual = pdv.version;

-- ── 4. Recalcular fecha_limite de los paquetes ya abiertos ──────────────────
-- Usa el plazo vigente (269 / 209) por id_paquete, desde la fecha de diagnóstico.
UPDATE paquete_paciente pp
   SET fecha_limite = pp.fecha_inicio + (pd.plazo_dias || ' days')::INTERVAL
  FROM paquete_definicion pd
 WHERE pd.id_paquete = pp.id_paquete;

-- ── 5. Re-evaluar estado de los paquetes NO completados ─────────────────────
-- Los 'completado' se respetan (dependen del avance real de componentes).
UPDATE paquete_paciente
   SET estado = CASE
                  WHEN fecha_limite < CURRENT_DATE THEN 'vencido'
                  ELSE 'abierto'
                END,
       fecha_cierre = CASE
                        WHEN fecha_limite < CURRENT_DATE THEN fecha_cierre
                        ELSE NULL
                      END
 WHERE estado <> 'completado';
