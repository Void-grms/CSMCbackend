-- ─────────────────────────────────────────────────────────────────────────────
-- migration_v4_farmacia.sql
-- Módulo Farmacia: seguimiento de la dispensación de medicamentos (código 99199.05).
--
-- El evento de entrega vive en la tabla `atencion` (codigo_item = '99199.05'); aquí
-- solo se agregan las tablas para lo que NO viene del HIS:
--   1. Configuración global (default de intervalo, ventana de relevancia, aviso previo).
--   2. Intervalo personalizado por paciente.
--   3. Notas manuales por entrega (medicamento, cantidad, observaciones).
--
-- Idempotente (IF NOT EXISTS). Se ejecuta automáticamente al arrancar el server
-- vía src/db/migrate.js.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Configuración global (fila única). NO se trunca al limpiar la BD:
--    es una preferencia del sistema, no datos de pacientes.
CREATE TABLE IF NOT EXISTS farmacia_config_global (
    id                      INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    intervalo_default_dias  INT NOT NULL DEFAULT 30 CHECK (intervalo_default_dias >= 1),
    ventana_relevancia_dias INT NOT NULL DEFAULT 45 CHECK (ventana_relevancia_dias >= 1),
    dias_aviso_previo       INT NOT NULL DEFAULT 5  CHECK (dias_aviso_previo >= 0)
);

INSERT INTO farmacia_config_global (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 2. Intervalo por paciente (override del default global). Se reinicia al limpiar
--    la BD: el TRUNCATE de `paciente` con CASCADE la vacía por la FK.
CREATE TABLE IF NOT EXISTS farmacia_paciente_config (
    id_paciente     TEXT PRIMARY KEY REFERENCES paciente(id_paciente) ON DELETE CASCADE,
    intervalo_dias  INT NOT NULL CHECK (intervalo_dias >= 1),
    activo          BOOLEAN NOT NULL DEFAULT TRUE,   -- FALSE = pausar alertas de este paciente
    actualizado_en  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    actualizado_por TEXT
);

-- 3. Nota manual por entrega, vinculada a la atención (id_cita, id_correlativo).
--    Se reinicia al limpiar la BD: el TRUNCATE de `atencion` con CASCADE la vacía.
--    Una recarga upsert normal del mismo periodo conserva la nota (la PK de
--    atencion no cambia).
CREATE TABLE IF NOT EXISTS farmacia_dispensacion_nota (
    id_cita        TEXT,
    id_correlativo INT,
    medicamento    TEXT,
    cantidad       TEXT,
    observaciones  TEXT,
    creado_en      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    creado_por     TEXT,
    PRIMARY KEY (id_cita, id_correlativo),
    FOREIGN KEY (id_cita, id_correlativo)
        REFERENCES atencion(id_cita, id_correlativo) ON DELETE CASCADE
);

-- Índice parcial para acelerar la detección de dispensaciones por paciente/fecha.
CREATE INDEX IF NOT EXISTS idx_atencion_dispensacion
    ON atencion (id_paciente, fecha_atencion)
    WHERE codigo_item = '99199.05';
