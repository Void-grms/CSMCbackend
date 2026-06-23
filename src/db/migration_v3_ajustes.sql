-- =============================================================================
-- MIGRATION v3 — Módulo "Ajustes" (Admin)
-- Sistema de Monitoreo de Paquetes Terapéuticos PP 0131
-- CSMC RENACER
--
-- Cambios:
--   1. Tablas *_version para versionado inmutable de catálogo
--   2. paquete_regla_especial — reglas hoy hardcodeadas en calcularPaquetes.js
--   3. paquete_paciente.version_catalogo — ancla a una versión del catálogo
--   4. auditoria_ajustes — log de cambios admin
--   5. Columnas adicionales en usuarios para auditar
--   6. Backfill: crea versión 1 de cada paquete existente
--
-- Idempotente: todas las creaciones usan IF NOT EXISTS y los inserts ON CONFLICT.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. VERSIONADO DE CATÁLOGO
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS paquete_definicion_version (
    id_paquete           TEXT      NOT NULL,
    version              INT       NOT NULL,
    nombre               TEXT      NOT NULL,
    plazo_meses          INT       NOT NULL DEFAULT 8,
    id_actividad         TEXT      REFERENCES actividad(id_actividad),
    codigo_paquete       TEXT,
    edad_minima          INT,
    edad_maxima          INT,
    activo               BOOLEAN   NOT NULL DEFAULT TRUE,
    fecha_creacion       TIMESTAMP NOT NULL DEFAULT NOW(),
    creado_por           INT       REFERENCES usuarios(id),
    nota_cambio          TEXT,
    PRIMARY KEY (id_paquete, version)
);

CREATE TABLE IF NOT EXISTS paquete_detalle_version (
    id_paquete           TEXT      NOT NULL,
    version              INT       NOT NULL,
    tipo_componente      TEXT      NOT NULL,
    cantidad_minima      INT       NOT NULL,
    usar_prefijo         BOOLEAN   NOT NULL DEFAULT FALSE,
    orden                INT,
    PRIMARY KEY (id_paquete, version, tipo_componente),
    FOREIGN KEY (id_paquete, version)
        REFERENCES paquete_definicion_version(id_paquete, version) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS paquete_detalle_codigos_version (
    id_paquete           TEXT      NOT NULL,
    version              INT       NOT NULL,
    tipo_componente      TEXT      NOT NULL,
    codigo_item          TEXT      NOT NULL,
    PRIMARY KEY (id_paquete, version, tipo_componente, codigo_item),
    FOREIGN KEY (id_paquete, version, tipo_componente)
        REFERENCES paquete_detalle_version(id_paquete, version, tipo_componente) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS paquete_grupo_dx_version (
    id_paquete           TEXT      NOT NULL,
    version              INT       NOT NULL,
    codigo_cie10         TEXT      NOT NULL,
    PRIMARY KEY (id_paquete, version, codigo_cie10),
    FOREIGN KEY (id_paquete, version)
        REFERENCES paquete_definicion_version(id_paquete, version) ON DELETE CASCADE
);

-- Puntero a versión actual por paquete
CREATE TABLE IF NOT EXISTS paquete_version_actual (
    id_paquete           TEXT PRIMARY KEY,
    version_actual       INT  NOT NULL,
    FOREIGN KEY (id_paquete, version_actual)
        REFERENCES paquete_definicion_version(id_paquete, version)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. REGLAS ESPECIALES POR PAQUETE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS paquete_regla_especial (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_paquete           TEXT NOT NULL,
    version              INT  NOT NULL,
    tipo_regla           TEXT NOT NULL CHECK (tipo_regla IN (
        'CODIGOS_MISMO_MES',
        'CODIGOS_MISMA_CITA',
        'EXIGE_TIPO_DX'
    )),
    parametros           JSONB NOT NULL,
    activa               BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion       TIMESTAMP NOT NULL DEFAULT NOW(),
    FOREIGN KEY (id_paquete, version)
        REFERENCES paquete_definicion_version(id_paquete, version) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_regla_especial_paquete
    ON paquete_regla_especial(id_paquete, version);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. paquete_paciente.version_catalogo
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE paquete_paciente
    ADD COLUMN IF NOT EXISTS version_catalogo INT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. AUDITORÍA DE AJUSTES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auditoria_ajustes (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entidad              TEXT NOT NULL,
    entidad_id           TEXT NOT NULL,
    accion               TEXT NOT NULL CHECK (accion IN ('crear', 'editar', 'eliminar', 'restaurar')),
    estado_antes         JSONB,
    estado_despues       JSONB,
    diff_resumen         TEXT,
    usuario_id           INT REFERENCES usuarios(id),
    usuario_username     TEXT,
    timestamp            TIMESTAMP NOT NULL DEFAULT NOW(),
    ip_origen            TEXT
);

CREATE INDEX IF NOT EXISTS idx_auditoria_entidad ON auditoria_ajustes(entidad, entidad_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_timestamp ON auditoria_ajustes(timestamp DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. AMPLIACIÓN TABLA usuarios (auditoría)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS ultima_modificacion TIMESTAMP,
    ADD COLUMN IF NOT EXISTS creado_por INT REFERENCES usuarios(id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. BACKFILL: crear versión 1 de cada paquete existente
-- ─────────────────────────────────────────────────────────────────────────────

-- 6a. Snapshot inicial de definiciones.
-- Tolerante a re-ejecución: migration_v5 renombra plazo_meses → plazo_dias. En un
-- redeploy esta migración vuelve a correr cuando la columna ya es plazo_dias, así que
-- referenciar plazo_meses rompería el resto de migraciones (incluida v6). Si la
-- columna ya fue renombrada, el backfill ya se hizo en su momento y se omite.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'paquete_definicion_version' AND column_name = 'plazo_meses'
  ) THEN
    INSERT INTO paquete_definicion_version
        (id_paquete, version, nombre, plazo_meses, id_actividad, codigo_paquete,
         edad_minima, edad_maxima, activo, nota_cambio)
    SELECT
        id_paquete, 1, nombre, plazo_meses, id_actividad, codigo_paquete,
        edad_minima, edad_maxima, TRUE, 'Versión inicial (backfill v3)'
    FROM paquete_definicion
    ON CONFLICT (id_paquete, version) DO NOTHING;
  END IF;
END $$;

-- 6b. Snapshot inicial de componentes
INSERT INTO paquete_detalle_version
    (id_paquete, version, tipo_componente, cantidad_minima, usar_prefijo, orden)
SELECT
    id_paquete, 1, tipo_componente, cantidad_minima, usar_prefijo, NULL
FROM paquete_detalle
ON CONFLICT (id_paquete, version, tipo_componente) DO NOTHING;

-- 6c. Snapshot inicial de códigos por componente
INSERT INTO paquete_detalle_codigos_version
    (id_paquete, version, tipo_componente, codigo_item)
SELECT
    id_paquete, 1, tipo_componente, codigo_item
FROM paquete_detalle_codigos
ON CONFLICT (id_paquete, version, tipo_componente, codigo_item) DO NOTHING;

-- 6d. Snapshot inicial de grupo dx
INSERT INTO paquete_grupo_dx_version
    (id_paquete, version, codigo_cie10)
SELECT
    id_paquete, 1, codigo_cie10
FROM paquete_grupo_dx
ON CONFLICT (id_paquete, version, codigo_cie10) DO NOTHING;

-- 6e. Marcar la versión 1 como actual para todos los paquetes
INSERT INTO paquete_version_actual (id_paquete, version_actual)
SELECT id_paquete, 1
FROM paquete_definicion
ON CONFLICT (id_paquete) DO NOTHING;

-- 6f. Backfill version_catalogo en paquete_paciente existentes
UPDATE paquete_paciente
SET version_catalogo = 1
WHERE version_catalogo IS NULL;

-- 6g. Seed de reglas especiales hoy hardcodeadas en calcularPaquetes.js
INSERT INTO paquete_regla_especial
    (id_paquete, version, tipo_regla, parametros, activa)
SELECT 'PF_REHAB_PSICOSOCIAL_ALC', 1, 'CODIGOS_MISMO_MES',
       '{"codigos": ["F102", "Z502"], "tipo_dx_requerido": "D"}'::jsonb, TRUE
WHERE EXISTS (SELECT 1 FROM paquete_definicion WHERE id_paquete = 'PF_REHAB_PSICOSOCIAL_ALC')
  AND NOT EXISTS (
      SELECT 1 FROM paquete_regla_especial
      WHERE id_paquete = 'PF_REHAB_PSICOSOCIAL_ALC' AND version = 1
        AND tipo_regla = 'CODIGOS_MISMO_MES'
  );

INSERT INTO paquete_regla_especial
    (id_paquete, version, tipo_regla, parametros, activa)
SELECT 'PF_CONTINUIDAD_CUIDADOS', 1, 'CODIGOS_MISMA_CITA',
       '{"codigos_adicionales": ["99207.09"]}'::jsonb, TRUE
WHERE EXISTS (SELECT 1 FROM paquete_definicion WHERE id_paquete = 'PF_CONTINUIDAD_CUIDADOS')
  AND NOT EXISTS (
      SELECT 1 FROM paquete_regla_especial
      WHERE id_paquete = 'PF_CONTINUIDAD_CUIDADOS' AND version = 1
        AND tipo_regla = 'CODIGOS_MISMA_CITA'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. ÍNDICES ADICIONALES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pp_version_catalogo
    ON paquete_paciente(id_paquete, version_catalogo);

COMMIT;
