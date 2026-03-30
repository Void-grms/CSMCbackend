-- =============================================================================
-- SCHEMA DDL — Sistema de Monitoreo de Paquetes Terapéuticos PP 0131
-- Base de datos: PostgreSQL
-- Generado para: CSMC RENACER
-- =============================================================================

-- =============================================================================
-- EXTENSIÓN pgcrypto
-- Habilita gen_random_uuid() en versiones de PostgreSQL.
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. paciente
-- Almacena los datos demográficos de cada paciente registrado en el CSMC.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS paciente (
    id_paciente              TEXT PRIMARY KEY,
    id_tipo_documento        TEXT,
    numero_documento         TEXT,
    apellido_paterno         TEXT,
    apellido_materno         TEXT,
    nombres                  TEXT,
    fecha_nacimiento         DATE,
    genero                   TEXT,
    id_etnia                 TEXT,
    historia_clinica         TEXT,
    domicilio_reniec         TEXT,
    domicilio_declarado      TEXT,
    id_establecimiento       TEXT,
    fecha_alta               DATE,
    fecha_modificacion       TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. profesional
-- Personal del CSMC que realiza atenciones.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profesional (
  id_personal           TEXT PRIMARY KEY,
  id_tipo_documento     TEXT,
  numero_documento      TEXT,
  apellido_paterno      TEXT,
  apellido_materno      TEXT,
  nombres               TEXT,
  fecha_nacimiento      DATE,
  id_condicion          TEXT,
  id_profesion          TEXT,
  id_colegio            TEXT,
  numero_colegiatura    TEXT,
  id_establecimiento    TEXT,
  fecha_alta            DATE,
  fecha_baja            DATE,
  estado_activo BOOLEAN GENERATED ALWAYS AS (fecha_baja IS NULL) STORED
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. registrador
-- Digitadores que registran las atenciones.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS registrador (
    id_registrador           TEXT PRIMARY KEY,
    numero_documento         TEXT,
    apellido_paterno         TEXT,
    apellido_materno         TEXT,
    nombres                  TEXT
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. atencion
-- Tabla principal de atenciones importada desde los archivos nominaltrama CSV.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS atencion (
    id_cita                      TEXT        NOT NULL,
    id_correlativo               INT         NOT NULL,
    fecha_atencion               DATE        NOT NULL,
    anio                         INT,
    mes                          INT,
    dia                          INT,
    id_paciente                  TEXT        REFERENCES paciente(id_paciente),
    id_personal                  TEXT        REFERENCES profesional(id_personal),
    id_registrador               TEXT,
    id_ups                       TEXT,
    id_establecimiento           TEXT,
    id_financiador               TEXT,
    id_condicion_establecimiento TEXT,
    id_condicion_servicio        TEXT,
    id_turno                     TEXT,
    codigo_item                  TEXT        NOT NULL,
    tipo_diagnostico             CHAR(1),
    valor_lab                    TEXT,
    id_correlativo_lab           INT,
    edad_reg                     INT,
    tipo_edad                    CHAR(1),
    peso                         NUMERIC(5,2),
    talla                        NUMERIC(5,2),
    hemoglobina                  NUMERIC(4,2),
    fecha_registro               TIMESTAMP,
    fecha_modificacion           TIMESTAMP,
    id_actividad                 TEXT,
    PRIMARY KEY (id_cita, id_correlativo)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. actividad (NUEVA TABLA)
-- Define las actividades principales del PP 0131 (ACT1 a ACT6)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS actividad (
    id_actividad             TEXT PRIMARY KEY,
    codigo                   TEXT NOT NULL,
    nombre                   TEXT NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. paquete_definicion
-- Catálogo de los paquetes terapéuticos con validaciones de edad.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS paquete_definicion (
    id_paquete               TEXT PRIMARY KEY,
    nombre                   TEXT NOT NULL,
    plazo_meses              INT  NOT NULL DEFAULT 8,
    id_actividad             TEXT REFERENCES actividad(id_actividad),
    codigo_paquete           TEXT,    -- Ejemplo: '1.1', '2.1'
    edad_minima              INT,     -- Validaciones de edad en base de datos
    edad_maxima              INT
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. paquete_grupo_dx
-- Códigos CIE-10 que activan cada paquete terapéutico.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS paquete_grupo_dx (
    id_paquete               TEXT REFERENCES paquete_definicion(id_paquete),
    codigo_cie10             TEXT,
    PRIMARY KEY (id_paquete, codigo_cie10)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. paquete_detalle
-- Componentes requeridos por cada paquete y su cantidad mínima.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS paquete_detalle (
    id_paquete               TEXT REFERENCES paquete_definicion(id_paquete),
    tipo_componente          TEXT,
    cantidad_minima          INT  NOT NULL,
    usar_prefijo             BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (id_paquete, tipo_componente)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. paquete_detalle_codigos
-- Códigos válidos para cada componente.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS paquete_detalle_codigos (
    id_paquete               TEXT,
    tipo_componente          TEXT,
    codigo_item              TEXT,
    PRIMARY KEY (id_paquete, tipo_componente, codigo_item),
    FOREIGN KEY (id_paquete, tipo_componente)
        REFERENCES paquete_detalle(id_paquete, tipo_componente)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. paquete_paciente
-- Paquetes terapéuticos asignados a pacientes.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS paquete_paciente (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_paquete               TEXT REFERENCES paquete_definicion(id_paquete),
    id_paciente              TEXT REFERENCES paciente(id_paciente),
    fecha_inicio             DATE NOT NULL,
    fecha_limite             DATE NOT NULL,
    estado                   TEXT NOT NULL CHECK (estado IN ('abierto', 'completado', 'vencido')),
    fecha_cierre             DATE,
    dx_principal             TEXT,
    tipo_diagnostico_dx      CHAR(1),
    valor_lab_dx             TEXT,
    observaciones            TEXT,
    UNIQUE (id_paquete, id_paciente, fecha_inicio)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. componente_profesion_permitida
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS componente_profesion_permitida (
    tipo_componente          TEXT,
    id_profesion             TEXT,
    observaciones            TEXT,
    PRIMARY KEY (tipo_componente, id_profesion)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. historial_cargas
-- Registro auditor de archivos CSV importados.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS historial_cargas (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    archivo                  TEXT,
    tipo                     TEXT,
    fecha                    TIMESTAMP DEFAULT NOW(),
    registros_procesados     INT,
    usuario                  TEXT
);

-- =============================================================================
-- ÍNDICES
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_atencion_id_paciente    ON atencion(id_paciente);
CREATE INDEX IF NOT EXISTS idx_atencion_id_personal    ON atencion(id_personal);
CREATE INDEX IF NOT EXISTS idx_atencion_fecha_atencion ON atencion(fecha_atencion);
CREATE INDEX IF NOT EXISTS idx_atencion_codigo_item    ON atencion(codigo_item);
CREATE INDEX IF NOT EXISTS idx_atencion_id_actividad   ON atencion(id_actividad);
CREATE INDEX IF NOT EXISTS idx_atencion_id_cita        ON atencion(id_cita);

CREATE INDEX IF NOT EXISTS idx_paquete_paciente_id_paciente ON paquete_paciente(id_paciente);
CREATE INDEX IF NOT EXISTS idx_paquete_paciente_estado      ON paquete_paciente(estado);