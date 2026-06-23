-- =============================================================================
-- MIGRATION v6 — Correcciones de catálogo según Paquetes_Salud_Mental_Ministerio.md
-- CSMC RENACER
--
-- Se ejecuta en CADA arranque (migrate.js). Es idempotente.
-- A diferencia del seed (que migrate.js omite si el catálogo ya existe), esta
-- migración SIEMPRE corre, por lo que aplica las correcciones también en bases
-- de datos ya inicializadas (p. ej. Railway entre despliegues).
--
-- Paso 1: corrige las tablas base (catálogo canónico).
-- Paso 2: espeja las tablas base hacia las tablas *_version de la VERSIÓN ACTUAL
--         de cada paquete afectado (que es lo que lee el motor de cálculo).
--
-- ⚠️  Como el .md es la fuente de verdad, esto SOBRESCRIBE en cada deploy el
--     contenido (componentes y diagnósticos) de los paquetes afectados en su
--     versión actual. Si se editan estos paquetes desde el módulo Ajustes,
--     el cambio se revertirá en el siguiente despliegue.
-- =============================================================================

BEGIN;

-- ── PASO 1: TABLAS BASE ──────────────────────────────────────────────────────

-- ── B. DIAGNÓSTICOS (paquete_grupo_dx) ──────────────────────────────────────

-- Quitar códigos inexistentes (no están en CIE-10 ni en las tramas del HIS)
DELETE FROM paquete_grupo_dx WHERE id_paquete='PF_MALTRATO_NNA'       AND codigo_cie10 IN ('T7411','T7412');
DELETE FROM paquete_grupo_dx WHERE id_paquete='PF_VIOLENCIA_FAMILIAR' AND codigo_cie10 IN ('T7411','T7412','T747');

-- Agregar diagnósticos faltantes (idempotente)
INSERT INTO paquete_grupo_dx (id_paquete, codigo_cie10) VALUES
    ('PF_CONSUMO_PERJUDICIAL','F131'),
    ('PF_DEPENDENCIA_ALC_TAB','F132'),
    ('PF_DEPENDENCIA_ALC_TAB','F630'),
    ('PF_REHAB_PSICOSOCIAL_ALC','F630'),
    ('PF_PSICOSIS','F060'),
    ('PF_PSICOSIS','F061'),
    ('PF_PSICOSIS','F062'),
    ('PF_PSICOSIS','F24X'),
    ('PF_PSICOSIS','F28X'),
    ('PF_PSICOSIS','F29X'),
    ('PF_PSICOSIS','F270'),
    ('PF_PSICOSIS','F271'),
    ('PF_PSICOSIS','F272'),
    ('PF_PSICOSIS','F273'),
    ('PF_PSICOSIS','F274'),
    ('PF_PSICOSIS','F275'),
    ('PF_PSICOSIS','F276'),
    ('PF_PSICOSIS','F277'),
    ('PF_PSICOSIS','F278'),
    ('PF_PSICOSIS','F279'),
    ('PF_DETERIORO_COGNITIVO','G300'),
    ('PF_DETERIORO_COGNITIVO','G301'),
    ('PF_DETERIORO_COGNITIVO','G302'),
    ('PF_DETERIORO_COGNITIVO','G303'),
    ('PF_DETERIORO_COGNITIVO','G304'),
    ('PF_DETERIORO_COGNITIVO','G305'),
    ('PF_DETERIORO_COGNITIVO','G306'),
    ('PF_DETERIORO_COGNITIVO','G307'),
    ('PF_DETERIORO_COGNITIVO','G308'),
    ('PF_DETERIORO_COGNITIVO','G309'),
    ('PF_DETERIORO_COGNITIVO','G318'),
    ('PF_DETERIORO_COGNITIVO','G328'),
    ('PF_REHAB_PSICOSOCIAL','F270'),
    ('PF_REHAB_PSICOSOCIAL','F271'),
    ('PF_REHAB_PSICOSOCIAL','F272'),
    ('PF_REHAB_PSICOSOCIAL','F273'),
    ('PF_REHAB_PSICOSOCIAL','F274'),
    ('PF_REHAB_PSICOSOCIAL','F275'),
    ('PF_REHAB_PSICOSOCIAL','F276'),
    ('PF_REHAB_PSICOSOCIAL','F277'),
    ('PF_REHAB_PSICOSOCIAL','F278'),
    ('PF_REHAB_PSICOSOCIAL','F279'),
    ('PF_REHAB_LABORAL','F270'),
    ('PF_REHAB_LABORAL','F271'),
    ('PF_REHAB_LABORAL','F272'),
    ('PF_REHAB_LABORAL','F273'),
    ('PF_REHAB_LABORAL','F274'),
    ('PF_REHAB_LABORAL','F275'),
    ('PF_REHAB_LABORAL','F276'),
    ('PF_REHAB_LABORAL','F277'),
    ('PF_REHAB_LABORAL','F278'),
    ('PF_REHAB_LABORAL','F279'),
    ('PF_PRIMER_EPISODIO','F060'),
    ('PF_PRIMER_EPISODIO','F061'),
    ('PF_PRIMER_EPISODIO','F062'),
    ('PF_PRIMER_EPISODIO','F200'),
    ('PF_PRIMER_EPISODIO','F201'),
    ('PF_PRIMER_EPISODIO','F202'),
    ('PF_PRIMER_EPISODIO','F203'),
    ('PF_PRIMER_EPISODIO','F204'),
    ('PF_PRIMER_EPISODIO','F205'),
    ('PF_PRIMER_EPISODIO','F206'),
    ('PF_PRIMER_EPISODIO','F207'),
    ('PF_PRIMER_EPISODIO','F208'),
    ('PF_PRIMER_EPISODIO','F209'),
    ('PF_PRIMER_EPISODIO','F21X'),
    ('PF_PRIMER_EPISODIO','F220'),
    ('PF_PRIMER_EPISODIO','F221'),
    ('PF_PRIMER_EPISODIO','F222'),
    ('PF_PRIMER_EPISODIO','F223'),
    ('PF_PRIMER_EPISODIO','F224'),
    ('PF_PRIMER_EPISODIO','F225'),
    ('PF_PRIMER_EPISODIO','F226'),
    ('PF_PRIMER_EPISODIO','F227'),
    ('PF_PRIMER_EPISODIO','F228'),
    ('PF_PRIMER_EPISODIO','F229'),
    ('PF_PRIMER_EPISODIO','F230'),
    ('PF_PRIMER_EPISODIO','F231'),
    ('PF_PRIMER_EPISODIO','F232'),
    ('PF_PRIMER_EPISODIO','F233'),
    ('PF_PRIMER_EPISODIO','F234'),
    ('PF_PRIMER_EPISODIO','F235'),
    ('PF_PRIMER_EPISODIO','F236'),
    ('PF_PRIMER_EPISODIO','F237'),
    ('PF_PRIMER_EPISODIO','F238'),
    ('PF_PRIMER_EPISODIO','F239'),
    ('PF_PRIMER_EPISODIO','F24X'),
    ('PF_PRIMER_EPISODIO','F250'),
    ('PF_PRIMER_EPISODIO','F251'),
    ('PF_PRIMER_EPISODIO','F252'),
    ('PF_PRIMER_EPISODIO','F253'),
    ('PF_PRIMER_EPISODIO','F254'),
    ('PF_PRIMER_EPISODIO','F255'),
    ('PF_PRIMER_EPISODIO','F256'),
    ('PF_PRIMER_EPISODIO','F257'),
    ('PF_PRIMER_EPISODIO','F258'),
    ('PF_PRIMER_EPISODIO','F259'),
    ('PF_PRIMER_EPISODIO','F270'),
    ('PF_PRIMER_EPISODIO','F271'),
    ('PF_PRIMER_EPISODIO','F272'),
    ('PF_PRIMER_EPISODIO','F273'),
    ('PF_PRIMER_EPISODIO','F274'),
    ('PF_PRIMER_EPISODIO','F275'),
    ('PF_PRIMER_EPISODIO','F276'),
    ('PF_PRIMER_EPISODIO','F277'),
    ('PF_PRIMER_EPISODIO','F278'),
    ('PF_PRIMER_EPISODIO','F279'),
    ('PF_PRIMER_EPISODIO','F28X'),
    ('PF_PRIMER_EPISODIO','F29X'),
    ('PF_PRIMER_EPISODIO','F312'),
    ('PF_PRIMER_EPISODIO','F315'),
    ('PF_PRIMER_EPISODIO','F531'),
    ('PF_PRIMER_EPISODIO','F105'),
    ('PF_PRIMER_EPISODIO','F115'),
    ('PF_PRIMER_EPISODIO','F125'),
    ('PF_PRIMER_EPISODIO','F135'),
    ('PF_PRIMER_EPISODIO','F145'),
    ('PF_PRIMER_EPISODIO','F155'),
    ('PF_PRIMER_EPISODIO','F165'),
    ('PF_PRIMER_EPISODIO','F175'),
    ('PF_PRIMER_EPISODIO','F185'),
    ('PF_PRIMER_EPISODIO','F195')
ON CONFLICT DO NOTHING;

-- ── A. COMPONENTES (paquete_detalle / paquete_detalle_codigos) ──────────────

-- PF_REHAB_PSICOSOCIAL: 6 sesiones de rehabilitación cognitiva (96100.05)
UPDATE paquete_detalle SET cantidad_minima=6 WHERE id_paquete='PF_REHAB_PSICOSOCIAL' AND tipo_componente='sesiones_rehabilitacion';
DELETE FROM paquete_detalle_codigos WHERE id_paquete='PF_REHAB_PSICOSOCIAL' AND tipo_componente='sesiones_rehabilitacion' AND codigo_item='99207';
INSERT INTO paquete_detalle_codigos (id_paquete,tipo_componente,codigo_item) VALUES
    ('PF_REHAB_PSICOSOCIAL','sesiones_rehabilitacion','96100.05')
ON CONFLICT DO NOTHING;

-- PF_PSICOSIS: quitar intervencion_individual; agregar terapia cognitiva y TO grupal
DELETE FROM paquete_detalle_codigos WHERE id_paquete='PF_PSICOSIS' AND tipo_componente='intervencion_individual';
DELETE FROM paquete_detalle WHERE id_paquete='PF_PSICOSIS' AND tipo_componente='intervencion_individual';
INSERT INTO paquete_detalle (id_paquete,tipo_componente,cantidad_minima) VALUES
    ('PF_PSICOSIS','terapia_cognitiva',6),
    ('PF_PSICOSIS','otras_terapias_o_to',4)
ON CONFLICT DO NOTHING;
INSERT INTO paquete_detalle_codigos (id_paquete,tipo_componente,codigo_item) VALUES
    ('PF_PSICOSIS','terapia_cognitiva','96100.05'),
    ('PF_PSICOSIS','otras_terapias_o_to','97535.01')
ON CONFLICT DO NOTHING;

-- PF_DETERIORO_COGNITIVO: reducir al paquete del .md
DELETE FROM paquete_detalle_codigos WHERE id_paquete='PF_DETERIORO_COGNITIVO'
  AND tipo_componente IN ('evaluacion_integral','consulta_sm','psicoterapia','intervencion_individual','psicoeducacion','rehabilitacion_laboral','psicoeducacion_familia');
DELETE FROM paquete_detalle WHERE id_paquete='PF_DETERIORO_COGNITIVO'
  AND tipo_componente IN ('evaluacion_integral','consulta_sm','psicoterapia','intervencion_individual','psicoeducacion','rehabilitacion_laboral','psicoeducacion_familia');
INSERT INTO paquete_detalle (id_paquete,tipo_componente,cantidad_minima) VALUES
    ('PF_DETERIORO_COGNITIVO','intervencion_familiar',2)
ON CONFLICT DO NOTHING;
INSERT INTO paquete_detalle_codigos (id_paquete,tipo_componente,codigo_item) VALUES
    ('PF_DETERIORO_COGNITIVO','intervencion_familiar','C2111.01')
ON CONFLICT DO NOTHING;
UPDATE paquete_detalle SET cantidad_minima=1 WHERE id_paquete='PF_DETERIORO_COGNITIVO' AND tipo_componente='visita_o_movilizacion';

-- PF_CONDUCTA_SUICIDA y PF_ANSIEDAD: agregar psicoeducación (99207.04)
INSERT INTO paquete_detalle (id_paquete,tipo_componente,cantidad_minima) VALUES
    ('PF_CONDUCTA_SUICIDA','psicoeducacion',1),
    ('PF_ANSIEDAD','psicoeducacion',1)
ON CONFLICT DO NOTHING;
INSERT INTO paquete_detalle_codigos (id_paquete,tipo_componente,codigo_item) VALUES
    ('PF_CONDUCTA_SUICIDA','psicoeducacion','99207.04'),
    ('PF_ANSIEDAD','psicoeducacion','99207.04')
ON CONFLICT DO NOTHING;

-- ── PASO 2: PROPAGAR A LAS TABLAS *_version (versión actual) ─────────────────
DO $$
DECLARE
  afectados TEXT[] := ARRAY['PF_REHAB_PSICOSOCIAL','PF_REHAB_LABORAL','PF_PSICOSIS','PF_DETERIORO_COGNITIVO','PF_CONDUCTA_SUICIDA','PF_ANSIEDAD','PF_CONSUMO_PERJUDICIAL','PF_DEPENDENCIA_ALC_TAB','PF_REHAB_PSICOSOCIAL_ALC','PF_PRIMER_EPISODIO','PF_MALTRATO_NNA','PF_VIOLENCIA_FAMILIAR'];
BEGIN
  -- grupo_dx
  DELETE FROM paquete_grupo_dx_version v
    USING paquete_version_actual pva
    WHERE v.id_paquete = pva.id_paquete AND v.version = pva.version_actual
      AND v.id_paquete = ANY(afectados);
  INSERT INTO paquete_grupo_dx_version (id_paquete, version, codigo_cie10)
    SELECT b.id_paquete, pva.version_actual, b.codigo_cie10
    FROM paquete_grupo_dx b
    JOIN paquete_version_actual pva ON pva.id_paquete = b.id_paquete
    WHERE b.id_paquete = ANY(afectados)
    ON CONFLICT DO NOTHING;

  -- detalle_codigos (borrar antes que detalle por la FK)
  DELETE FROM paquete_detalle_codigos_version v
    USING paquete_version_actual pva
    WHERE v.id_paquete = pva.id_paquete AND v.version = pva.version_actual
      AND v.id_paquete = ANY(afectados);
  DELETE FROM paquete_detalle_version v
    USING paquete_version_actual pva
    WHERE v.id_paquete = pva.id_paquete AND v.version = pva.version_actual
      AND v.id_paquete = ANY(afectados);
  INSERT INTO paquete_detalle_version (id_paquete, version, tipo_componente, cantidad_minima, usar_prefijo, orden)
    SELECT b.id_paquete, pva.version_actual, b.tipo_componente, b.cantidad_minima, b.usar_prefijo, NULL
    FROM paquete_detalle b
    JOIN paquete_version_actual pva ON pva.id_paquete = b.id_paquete
    WHERE b.id_paquete = ANY(afectados)
    ON CONFLICT DO NOTHING;
  INSERT INTO paquete_detalle_codigos_version (id_paquete, version, tipo_componente, codigo_item)
    SELECT b.id_paquete, pva.version_actual, b.tipo_componente, b.codigo_item
    FROM paquete_detalle_codigos b
    JOIN paquete_version_actual pva ON pva.id_paquete = b.id_paquete
    WHERE b.id_paquete = ANY(afectados)
    ON CONFLICT DO NOTHING;
END $$;

COMMIT;
