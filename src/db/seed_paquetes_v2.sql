-- =============================================================================
-- SEED v2 — Catálogo completo de Actividades y Paquetes PP 0131
-- CSMC RENACER
--
-- ¡PRERREQUISITO! Ejecutar migration_v2.sql antes.
-- Este seed es ADITIVO e IDEMPOTENTE:
--   • Usa ON CONFLICT DO NOTHING para inserts de catálogo.
--   • Usa ON CONFLICT DO UPDATE para actualizar metadatos en paquetes existentes.
--   • No elimina ni modifica datos de pacientes (paquete_paciente).
--
-- Organización igual a la de GERESA/PP0131:
--   ACT1 – 5005189  Tratamiento de personas con problemas psicosociales
--   ACT2 – 5006281  Tratamiento ambulatorio NNA trastornos mentales/psicosociales
--   ACT3 – 5005190  Tratamiento ambulatorio trastornos afectivos (depresión/suicida/ansiedad)
--   ACT4 – 5006282  Tratamiento ambulatorio consumo de alcohol y tabaco
--   ACT5 – 5005195  Tratamiento ambulatorio síndrome/trastorno psicótico
--   ACT6 – 5005197  Rehabilitación psicosocial síndrome esquizofrénico
-- =============================================================================

BEGIN;

-- =============================================================================
-- SECCIÓN 0 — ACTIVIDADES
-- =============================================================================

INSERT INTO actividad (id_actividad, codigo, nombre) VALUES
    ('ACT1', '5005189', 'Tratamiento de personas con problemas psicosociales'),
    ('ACT2', '5006281', 'Tratamiento ambulatorio de niños y niñas de 0 a 17 años con trastornos mentales y del comportamiento y/o problemas psicosociales propios de la infancia y la adolescencia'),
    ('ACT3', '5005190', 'Tratamiento ambulatorio de personas con trastornos afectivos (depresión y conducta suicida) y de ansiedad'),
    ('ACT4', '5006282', 'Tratamiento ambulatorio de personas con trastorno del comportamiento debido al consumo de alcohol y tabaco'),
    ('ACT5', '5005195', 'Tratamiento ambulatorio de personas con síndrome o trastorno psicótico'),
    ('ACT6', '5005197', 'Rehabilitación psicosocial de personas con síndrome o trastorno esquizofrénico')
ON CONFLICT (id_actividad) DO NOTHING;

-- =============================================================================
-- SECCIÓN 1 — PAQUETE_DEFINICION
--   • Paquetes existentes: se actualiza id_actividad, codigo_paquete, edad_minima/maxima.
--   • Paquetes nuevos: INSERT con todos los campos.
-- =============================================================================

-- ── Actualizar paquetes existentes con agrupación y restricciones de edad ──

-- ACT1
UPDATE paquete_definicion SET
    id_actividad   = 'ACT1',
    codigo_paquete = '1.1',
    edad_minima    = 18,
    edad_maxima    = NULL
WHERE id_paquete = 'PF_VIOLENCIA_FAMILIAR';

UPDATE paquete_definicion SET
    id_actividad   = 'ACT1',
    codigo_paquete = '1.2',
    edad_minima    = 18,
    edad_maxima    = NULL
WHERE id_paquete = 'PF_VIOLENCIA_SEXUAL';

-- ACT2
UPDATE paquete_definicion SET
    id_actividad   = 'ACT2',
    codigo_paquete = '2.1',
    edad_minima    = NULL,
    edad_maxima    = 17
WHERE id_paquete = 'PF_AUTISMO';

UPDATE paquete_definicion SET
    id_actividad   = 'ACT2',
    codigo_paquete = '2.2',
    edad_minima    = NULL,
    edad_maxima    = 17
WHERE id_paquete = 'PF_TM_COMPORTAMIENTO';

-- ACT3
UPDATE paquete_definicion SET id_actividad = 'ACT3', codigo_paquete = '3.1'
WHERE id_paquete = 'PF_DEPRESION';

UPDATE paquete_definicion SET id_actividad = 'ACT3', codigo_paquete = '3.2'
WHERE id_paquete = 'PF_CONDUCTA_SUICIDA';

UPDATE paquete_definicion SET id_actividad = 'ACT3', codigo_paquete = '3.3'
WHERE id_paquete = 'PF_ANSIEDAD';

-- ACT4
UPDATE paquete_definicion SET id_actividad = 'ACT4', codigo_paquete = '4.1'
WHERE id_paquete = 'PF_CONSUMO_PERJUDICIAL';

UPDATE paquete_definicion SET id_actividad = 'ACT4', codigo_paquete = '4.2'
WHERE id_paquete = 'PF_DEPENDENCIA_ALC_TAB';

UPDATE paquete_definicion SET id_actividad = 'ACT4', codigo_paquete = '4.3'
WHERE id_paquete = 'PF_REHAB_PSICOSOCIAL_ALC';

-- ACT5
UPDATE paquete_definicion SET id_actividad = 'ACT5', codigo_paquete = '5.1'
WHERE id_paquete = 'PF_PSICOSIS';

UPDATE paquete_definicion SET id_actividad = 'ACT5', codigo_paquete = '5.3'
WHERE id_paquete = 'PF_DETERIORO_COGNITIVO';

-- ACT6
UPDATE paquete_definicion SET id_actividad = 'ACT6', codigo_paquete = '6.1'
WHERE id_paquete = 'PF_REHAB_PSICOSOCIAL';

UPDATE paquete_definicion SET id_actividad = 'ACT6', codigo_paquete = '6.2'
WHERE id_paquete = 'PF_REHAB_LABORAL';

-- ── Insertar paquetes NUEVOS ──────────────────────────────────────────────────

INSERT INTO paquete_definicion (id_paquete, nombre, plazo_meses, id_actividad, codigo_paquete, edad_minima, edad_maxima) VALUES
    -- 1.3 – Maltrato infantil NNA (<18 años). Mismos Dx que PF_VIOLENCIA_FAMILIAR.
    ('PF_MALTRATO_NNA',
     'Tratamiento de niños, niñas y adolescentes afectados por maltrato infantil',
     8, 'ACT1', '1.3', NULL, 17),

    -- 1.4 – Violencia sexual NNA (<18 años). Mismos Dx que PF_VIOLENCIA_SEXUAL.
    ('PF_VS_NNA',
     'Tratamiento especializado de niños, niñas y adolescentes afectados por violencia sexual',
     8, 'ACT1', '1.4', NULL, 17),

    -- 5.2 – Primer episodio psicótico. Dx = espectro esquizofrénico (F20-F29, F312, F315, F323, F333…).
    ('PF_PRIMER_EPISODIO',
     'Tratamiento ambulatorio de personas con primer episodio psicótico',
     8, 'ACT5', '5.2', NULL, NULL),

    -- 5.4 – Primer episodio psicótico (variante con Dx orgánicos F060-F062).
    ('PF_PRIMER_EPISODIO_2',
     'Tratamiento ambulatorio de personas con primer episodio psicótico (con trastornos orgánicos)',
     8, 'ACT5', '5.4', NULL, NULL),

    -- 5.5 – Continuidad de cuidados. Sin componentes fijos; apertura MANUAL.
    --       No se incluyen códigos en paquete_grupo_dx para evitar apertura automática.
    ('PF_CONTINUIDAD_CUIDADOS',
     'Continuidad de cuidados a personas con trastorno mental grave',
     8, 'ACT5', '5.5', NULL, NULL)

ON CONFLICT (id_paquete) DO NOTHING;

-- =============================================================================
-- SECCIÓN 2 — PAQUETE_GRUPO_DX
--   Solo se agregan los diagnósticos de los paquetes nuevos.
--   Los paquetes existentes ya tienen sus Dx en el seed original.
-- =============================================================================

-- ── 1.3 PF_MALTRATO_NNA — mismos CIE-10 que PF_VIOLENCIA_FAMILIAR ───────────
INSERT INTO paquete_grupo_dx (id_paquete, codigo_cie10) VALUES
    ('PF_MALTRATO_NNA', 'T740'), ('PF_MALTRATO_NNA', 'T741'),
    ('PF_MALTRATO_NNA', 'T743'), ('PF_MALTRATO_NNA', 'T748'),
    ('PF_MALTRATO_NNA', 'T749'),
    ('PF_MALTRATO_NNA', 'Y040'), ('PF_MALTRATO_NNA', 'Y041'),
    ('PF_MALTRATO_NNA', 'Y042'), ('PF_MALTRATO_NNA', 'Y043'),
    ('PF_MALTRATO_NNA', 'Y044'), ('PF_MALTRATO_NNA', 'Y045'),
    ('PF_MALTRATO_NNA', 'Y046'), ('PF_MALTRATO_NNA', 'Y047'),
    ('PF_MALTRATO_NNA', 'Y048'), ('PF_MALTRATO_NNA', 'Y049'),
    ('PF_MALTRATO_NNA', 'Y060'), ('PF_MALTRATO_NNA', 'Y061'),
    ('PF_MALTRATO_NNA', 'Y062'), ('PF_MALTRATO_NNA', 'Y068'),
    ('PF_MALTRATO_NNA', 'Y069'),
    ('PF_MALTRATO_NNA', 'Y070'), ('PF_MALTRATO_NNA', 'Y071'),
    ('PF_MALTRATO_NNA', 'Y072'), ('PF_MALTRATO_NNA', 'Y073'),
    ('PF_MALTRATO_NNA', 'Y078'), ('PF_MALTRATO_NNA', 'Y079'),
    ('PF_MALTRATO_NNA', 'Y080'), ('PF_MALTRATO_NNA', 'Y081'),
    ('PF_MALTRATO_NNA', 'Y082'), ('PF_MALTRATO_NNA', 'Y083'),
    ('PF_MALTRATO_NNA', 'Y084'), ('PF_MALTRATO_NNA', 'Y085'),
    ('PF_MALTRATO_NNA', 'Y086'), ('PF_MALTRATO_NNA', 'Y087'),
    ('PF_MALTRATO_NNA', 'Y088'), ('PF_MALTRATO_NNA', 'Y089')
ON CONFLICT DO NOTHING;

-- ── 1.4 PF_VS_NNA — mismos CIE-10 que PF_VIOLENCIA_SEXUAL ──────────────────
INSERT INTO paquete_grupo_dx (id_paquete, codigo_cie10) VALUES
    ('PF_VS_NNA', 'T742'),
    ('PF_VS_NNA', 'Y050'), ('PF_VS_NNA', 'Y051'), ('PF_VS_NNA', 'Y052'),
    ('PF_VS_NNA', 'Y053'), ('PF_VS_NNA', 'Y054'), ('PF_VS_NNA', 'Y055'),
    ('PF_VS_NNA', 'Y056'), ('PF_VS_NNA', 'Y057'), ('PF_VS_NNA', 'Y058'),
    ('PF_VS_NNA', 'Y059')
ON CONFLICT DO NOTHING;

-- ── 5.2 PF_PRIMER_EPISODIO — espectro esquizofrénico igual que PF_PSICOSIS ──
INSERT INTO paquete_grupo_dx (id_paquete, codigo_cie10) VALUES
    ('PF_PRIMER_EPISODIO', 'F201'), ('PF_PRIMER_EPISODIO', 'F202'),
    ('PF_PRIMER_EPISODIO', 'F203'), ('PF_PRIMER_EPISODIO', 'F204'),
    ('PF_PRIMER_EPISODIO', 'F205'), ('PF_PRIMER_EPISODIO', 'F206'),
    ('PF_PRIMER_EPISODIO', 'F207'), ('PF_PRIMER_EPISODIO', 'F208'),
    ('PF_PRIMER_EPISODIO', 'F209'), ('PF_PRIMER_EPISODIO', 'F21X'),
    ('PF_PRIMER_EPISODIO', 'F220'), ('PF_PRIMER_EPISODIO', 'F228'),
    ('PF_PRIMER_EPISODIO', 'F229'),
    ('PF_PRIMER_EPISODIO', 'F230'), ('PF_PRIMER_EPISODIO', 'F231'),
    ('PF_PRIMER_EPISODIO', 'F232'), ('PF_PRIMER_EPISODIO', 'F233'),
    ('PF_PRIMER_EPISODIO', 'F238'), ('PF_PRIMER_EPISODIO', 'F239'),
    ('PF_PRIMER_EPISODIO', 'F24X'),
    ('PF_PRIMER_EPISODIO', 'F250'), ('PF_PRIMER_EPISODIO', 'F251'),
    ('PF_PRIMER_EPISODIO', 'F252'), ('PF_PRIMER_EPISODIO', 'F258'),
    ('PF_PRIMER_EPISODIO', 'F259'),
    ('PF_PRIMER_EPISODIO', 'F28X'), ('PF_PRIMER_EPISODIO', 'F29X'),
    ('PF_PRIMER_EPISODIO', 'F312'), ('PF_PRIMER_EPISODIO', 'F315'),
    ('PF_PRIMER_EPISODIO', 'F323'), ('PF_PRIMER_EPISODIO', 'F333'),
    ('PF_PRIMER_EPISODIO', 'F531'),
    ('PF_PRIMER_EPISODIO', 'F105'), ('PF_PRIMER_EPISODIO', 'F115'),
    ('PF_PRIMER_EPISODIO', 'F125'), ('PF_PRIMER_EPISODIO', 'F135'),
    ('PF_PRIMER_EPISODIO', 'F145'), ('PF_PRIMER_EPISODIO', 'F155'),
    ('PF_PRIMER_EPISODIO', 'F165'), ('PF_PRIMER_EPISODIO', 'F175'),
    ('PF_PRIMER_EPISODIO', 'F185'), ('PF_PRIMER_EPISODIO', 'F195')
ON CONFLICT DO NOTHING;

-- ── 5.4 PF_PRIMER_EPISODIO_2 — igual a 5.2 pero con F060-F062 en vez de F323/F333
INSERT INTO paquete_grupo_dx (id_paquete, codigo_cie10) VALUES
    ('PF_PRIMER_EPISODIO_2', 'F201'), ('PF_PRIMER_EPISODIO_2', 'F202'),
    ('PF_PRIMER_EPISODIO_2', 'F203'), ('PF_PRIMER_EPISODIO_2', 'F204'),
    ('PF_PRIMER_EPISODIO_2', 'F205'), ('PF_PRIMER_EPISODIO_2', 'F206'),
    ('PF_PRIMER_EPISODIO_2', 'F207'), ('PF_PRIMER_EPISODIO_2', 'F208'),
    ('PF_PRIMER_EPISODIO_2', 'F209'), ('PF_PRIMER_EPISODIO_2', 'F21X'),
    ('PF_PRIMER_EPISODIO_2', 'F220'), ('PF_PRIMER_EPISODIO_2', 'F228'),
    ('PF_PRIMER_EPISODIO_2', 'F229'),
    ('PF_PRIMER_EPISODIO_2', 'F230'), ('PF_PRIMER_EPISODIO_2', 'F231'),
    ('PF_PRIMER_EPISODIO_2', 'F232'), ('PF_PRIMER_EPISODIO_2', 'F233'),
    ('PF_PRIMER_EPISODIO_2', 'F238'), ('PF_PRIMER_EPISODIO_2', 'F239'),
    ('PF_PRIMER_EPISODIO_2', 'F24X'),
    ('PF_PRIMER_EPISODIO_2', 'F250'), ('PF_PRIMER_EPISODIO_2', 'F251'),
    ('PF_PRIMER_EPISODIO_2', 'F252'), ('PF_PRIMER_EPISODIO_2', 'F258'),
    ('PF_PRIMER_EPISODIO_2', 'F259'),
    ('PF_PRIMER_EPISODIO_2', 'F28X'), ('PF_PRIMER_EPISODIO_2', 'F29X'),
    ('PF_PRIMER_EPISODIO_2', 'F312'), ('PF_PRIMER_EPISODIO_2', 'F315'),
    -- F060, F061, F062 (trastornos orgánicos con síntomas psicóticos)
    ('PF_PRIMER_EPISODIO_2', 'F060'), ('PF_PRIMER_EPISODIO_2', 'F061'),
    ('PF_PRIMER_EPISODIO_2', 'F062'),
    ('PF_PRIMER_EPISODIO_2', 'F531'),
    ('PF_PRIMER_EPISODIO_2', 'F105'), ('PF_PRIMER_EPISODIO_2', 'F115'),
    ('PF_PRIMER_EPISODIO_2', 'F125'), ('PF_PRIMER_EPISODIO_2', 'F135'),
    ('PF_PRIMER_EPISODIO_2', 'F145'), ('PF_PRIMER_EPISODIO_2', 'F155'),
    ('PF_PRIMER_EPISODIO_2', 'F165'), ('PF_PRIMER_EPISODIO_2', 'F175'),
    ('PF_PRIMER_EPISODIO_2', 'F185'), ('PF_PRIMER_EPISODIO_2', 'F195')
ON CONFLICT DO NOTHING;

-- ── 5.5 PF_CONTINUIDAD_CUIDADOS — apertura MANUAL, sin grupo_dx automático ──
-- No se registran códigos en paquete_grupo_dx.
-- El profesional asigna este paquete directamente desde la interfaz.

-- =============================================================================
-- SECCIÓN 3 — PAQUETE_DETALLE
--   Componentes requeridos de los paquetes nuevos.
-- =============================================================================

-- ── 1.3 PF_MALTRATO_NNA — idéntico a PF_VIOLENCIA_FAMILIAR ──────────────────
INSERT INTO paquete_detalle (id_paquete, tipo_componente, cantidad_minima) VALUES
    ('PF_MALTRATO_NNA', 'consulta_especializada',    2),
    ('PF_MALTRATO_NNA', 'psicoterapia_individual',   6),
    ('PF_MALTRATO_NNA', 'intervencion_familiar',     2),
    ('PF_MALTRATO_NNA', 'visita_domiciliaria_o_red', 1)
ON CONFLICT DO NOTHING;

-- ── 1.4 PF_VS_NNA — idéntico a PF_VIOLENCIA_SEXUAL ─────────────────────────
INSERT INTO paquete_detalle (id_paquete, tipo_componente, cantidad_minima) VALUES
    ('PF_VS_NNA', 'consulta_especializada',           2),
    ('PF_VS_NNA', 'intervencion_o_psicoterapia_ind',  6),
    ('PF_VS_NNA', 'intervencion_familiar',            2),
    ('PF_VS_NNA', 'visita_domiciliaria_o_red',        1)
ON CONFLICT DO NOTHING;

-- ── 5.2 PF_PRIMER_EPISODIO ───────────────────────────────────────────────────
INSERT INTO paquete_detalle (id_paquete, tipo_componente, cantidad_minima) VALUES
    ('PF_PRIMER_EPISODIO', 'consulta_medica_especializada', 3),
    ('PF_PRIMER_EPISODIO', 'psicoterapia_individual',       6),
    ('PF_PRIMER_EPISODIO', 'intervencion_familiar',         5),
    ('PF_PRIMER_EPISODIO', 'visita_domiciliaria_o_red',     2)
ON CONFLICT DO NOTHING;

-- ── 5.4 PF_PRIMER_EPISODIO_2 — mismos componentes que 5.2 ───────────────────
INSERT INTO paquete_detalle (id_paquete, tipo_componente, cantidad_minima) VALUES
    ('PF_PRIMER_EPISODIO_2', 'consulta_medica_especializada', 3),
    ('PF_PRIMER_EPISODIO_2', 'psicoterapia_individual',       6),
    ('PF_PRIMER_EPISODIO_2', 'intervencion_familiar',         5),
    ('PF_PRIMER_EPISODIO_2', 'visita_domiciliaria_o_red',     2)
ON CONFLICT DO NOTHING;

-- ── 5.5 PF_CONTINUIDAD_CUIDADOS — sin componentes fijos ─────────────────────
-- Según la necesidad del usuario. El avance y cierre son manuales.

-- =============================================================================
-- SECCIÓN 4 — PAQUETE_DETALLE_CODIGOS
--   Códigos válidos por componente para los paquetes nuevos.
-- =============================================================================

-- ── 1.3 PF_MALTRATO_NNA ──────────────────────────────────────────────────────
INSERT INTO paquete_detalle_codigos (id_paquete, tipo_componente, codigo_item) VALUES
    -- consulta_especializada
    ('PF_MALTRATO_NNA', 'consulta_especializada',    '99215'),
    -- psicoterapia_individual
    ('PF_MALTRATO_NNA', 'psicoterapia_individual',   '90806'),
    ('PF_MALTRATO_NNA', 'psicoterapia_individual',   '90834'),
    ('PF_MALTRATO_NNA', 'psicoterapia_individual',   '90860'),
    -- intervencion_familiar
    ('PF_MALTRATO_NNA', 'intervencion_familiar',     'C2111.01'),
    ('PF_MALTRATO_NNA', 'intervencion_familiar',     '96100.01'),
    ('PF_MALTRATO_NNA', 'intervencion_familiar',     '90847'),
    -- visita_domiciliaria_o_red
    ('PF_MALTRATO_NNA', 'visita_domiciliaria_o_red', 'C0011'),
    ('PF_MALTRATO_NNA', 'visita_domiciliaria_o_red', 'C1043')
ON CONFLICT DO NOTHING;

-- ── 1.4 PF_VS_NNA ────────────────────────────────────────────────────────────
INSERT INTO paquete_detalle_codigos (id_paquete, tipo_componente, codigo_item) VALUES
    -- consulta_especializada
    ('PF_VS_NNA', 'consulta_especializada',           '99215'),
    -- intervencion_o_psicoterapia_ind
    ('PF_VS_NNA', 'intervencion_o_psicoterapia_ind',  '99207.01'),
    ('PF_VS_NNA', 'intervencion_o_psicoterapia_ind',  '90806'),
    ('PF_VS_NNA', 'intervencion_o_psicoterapia_ind',  '90834'),
    ('PF_VS_NNA', 'intervencion_o_psicoterapia_ind',  '90860'),
    -- intervencion_familiar
    ('PF_VS_NNA', 'intervencion_familiar',            'C2111.01'),
    ('PF_VS_NNA', 'intervencion_familiar',            '96100.01'),
    ('PF_VS_NNA', 'intervencion_familiar',            '90847'),
    -- visita_domiciliaria_o_red
    ('PF_VS_NNA', 'visita_domiciliaria_o_red',        'C0011'),
    ('PF_VS_NNA', 'visita_domiciliaria_o_red',        'C1043')
ON CONFLICT DO NOTHING;

-- ── 5.2 PF_PRIMER_EPISODIO ───────────────────────────────────────────────────
INSERT INTO paquete_detalle_codigos (id_paquete, tipo_componente, codigo_item) VALUES
    -- consulta_medica_especializada
    ('PF_PRIMER_EPISODIO', 'consulta_medica_especializada', '99215'),
    -- psicoterapia_individual
    ('PF_PRIMER_EPISODIO', 'psicoterapia_individual',       '90806'),
    ('PF_PRIMER_EPISODIO', 'psicoterapia_individual',       '90834'),
    ('PF_PRIMER_EPISODIO', 'psicoterapia_individual',       '90860'),
    -- intervencion_familiar
    ('PF_PRIMER_EPISODIO', 'intervencion_familiar',         'C2111.01'),
    ('PF_PRIMER_EPISODIO', 'intervencion_familiar',         '96100.01'),
    ('PF_PRIMER_EPISODIO', 'intervencion_familiar',         '90847'),
    -- visita_domiciliaria_o_red
    ('PF_PRIMER_EPISODIO', 'visita_domiciliaria_o_red',     'C0011'),
    ('PF_PRIMER_EPISODIO', 'visita_domiciliaria_o_red',     'C1043')
ON CONFLICT DO NOTHING;

-- ── 5.4 PF_PRIMER_EPISODIO_2 ─────────────────────────────────────────────────
INSERT INTO paquete_detalle_codigos (id_paquete, tipo_componente, codigo_item) VALUES
    -- consulta_medica_especializada
    ('PF_PRIMER_EPISODIO_2', 'consulta_medica_especializada', '99215'),
    -- psicoterapia_individual
    ('PF_PRIMER_EPISODIO_2', 'psicoterapia_individual',       '90806'),
    ('PF_PRIMER_EPISODIO_2', 'psicoterapia_individual',       '90834'),
    ('PF_PRIMER_EPISODIO_2', 'psicoterapia_individual',       '90860'),
    -- intervencion_familiar
    ('PF_PRIMER_EPISODIO_2', 'intervencion_familiar',         'C2111.01'),
    ('PF_PRIMER_EPISODIO_2', 'intervencion_familiar',         '96100.01'),
    ('PF_PRIMER_EPISODIO_2', 'intervencion_familiar',         '90847'),
    -- visita_domiciliaria_o_red
    ('PF_PRIMER_EPISODIO_2', 'visita_domiciliaria_o_red',     'C0011'),
    ('PF_PRIMER_EPISODIO_2', 'visita_domiciliaria_o_red',     'C1043')
ON CONFLICT DO NOTHING;

COMMIT;

-- =============================================================================
-- RESUMEN FINAL — Verificación rápida post-ejecución
-- =============================================================================
--
-- SELECT pd.codigo_paquete, pd.id_paquete, pd.nombre,
--        pd.edad_minima, pd.edad_maxima,
--        a.codigo AS cod_actividad, a.nombre AS nombre_actividad
-- FROM paquete_definicion pd
-- LEFT JOIN actividad a ON a.id_actividad = pd.id_actividad
-- ORDER BY pd.id_actividad NULLS LAST, pd.codigo_paquete;