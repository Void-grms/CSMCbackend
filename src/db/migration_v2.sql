-- =============================================================================
-- MIGRATION v2 — Agrupación por Actividad + Restricciones de Edad
-- Sistema de Monitoreo de Paquetes Terapéuticos PP 0131
-- CSMC RENACER
--
-- Ejecutar ANTES de seed_paquetes_v2.sql.
-- Todos los ALTER son idempotentes (IF NOT EXISTS / IF EXISTS).
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TABLA actividad
--    Agrupa los paquetes terapéuticos tal como los organiza GERESA/DIRESA.
--    Cada actividad tiene un código presupuestal y un nombre oficial.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS actividad (
    id_actividad  TEXT PRIMARY KEY,           -- Ej: 'ACT1', 'ACT2'
    codigo        TEXT NOT NULL,              -- Código presupuestal GERESA
    nombre        TEXT NOT NULL              -- Nombre oficial de la actividad
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. COLUMNAS NUEVAS en paquete_definicion
-- ─────────────────────────────────────────────────────────────────────────────

-- FK hacia actividad (agrupación GERESA)
ALTER TABLE paquete_definicion
    ADD COLUMN IF NOT EXISTS id_actividad   TEXT REFERENCES actividad(id_actividad);

-- Código de orden dentro de la actividad (Ej: '1.1', '2.3', '5.2')
ALTER TABLE paquete_definicion
    ADD COLUMN IF NOT EXISTS codigo_paquete TEXT;

-- Rango de edad válido para apertura automática del paquete.
-- NULL = sin restricción de ese extremo.
-- edad_maxima = 17 → solo menores de 18 años
-- edad_minima = 18 → solo adultos (18 años o más)
ALTER TABLE paquete_definicion
    ADD COLUMN IF NOT EXISTS edad_minima INT;   -- inclusive (>=)

ALTER TABLE paquete_definicion
    ADD COLUMN IF NOT EXISTS edad_maxima INT;   -- inclusive (<=)

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ÍNDICE de soporte para filtros por actividad
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_paquete_def_actividad
    ON paquete_definicion(id_actividad);

COMMIT;