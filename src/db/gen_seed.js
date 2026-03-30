const fs = require('fs');

const sql = `
BEGIN;

-- =============================================================================
-- 0. ACTIVIDADES
-- =============================================================================
INSERT INTO actividad (id_actividad, codigo, nombre) VALUES
    ('ACT1', '5005189', 'Tratamiento de personas con problemas psicosociales'),
    ('ACT2', '5006281', 'Tratamiento ambulatorio de niños y niñas de 0 a 17 años con trastornos mentales y del comportamiento y/o problemas psicosociales propios de la infancia y la adolescencia.'),
    ('ACT3', '5005190', 'Tratamiento ambulatorio de personas con trastornos afectivos (depresión y conducta suicida) y de ansiedad.'),
    ('ACT4', '5006282', 'Tratamiento ambulatorio de personas con Trastorno del comportamiento debido al Consumo de alcohol y tabaco'),
    ('ACT5', '5005195', 'Tratamiento ambulatorio de personas con síndrome o trastorno psicótico'),
    ('ACT6', '5005197', 'Rehabilitación psicosocial de personas con síndrome o trastorno esquizofrénico')
ON CONFLICT (id_actividad) DO UPDATE SET codigo = EXCLUDED.codigo, nombre = EXCLUDED.nombre;

-- =============================================================================
-- 1. PAQUETE DEFINICION
-- =============================================================================
INSERT INTO paquete_definicion (id_paquete, nombre, plazo_meses, id_actividad, codigo_paquete, edad_minima, edad_maxima) VALUES
-- Actividad 1
('PF_VIOLENCIA_FAMILIAR', 'Tratamiento especializado en violencia familiar', 8, 'ACT1', '1.1', 18, NULL),
('PF_VIOLENCIA_SEXUAL', 'Tratamiento especializado de personas afectadas por violencia sexual', 8, 'ACT1', '1.2', 18, NULL),
('PF_MALTRATO_NNA', 'Tratamiento de niños, niñas y adolescentes afectados por maltrato infantil', 8, 'ACT1', '1.3', NULL, 17),
('PF_VS_NNA', 'Tratamiento especializado niños, niñas y adolescentes afectados por violencia sexual', 8, 'ACT1', '1.4', NULL, 17),
-- Actividad 2
('PF_AUTISMO', 'Tratamiento ambulatorio de niños y niñas de 0 a 17 años con trastorno de espectro autista', 8, 'ACT2', '2.1', NULL, 17),
('PF_TM_COMPORTAMIENTO', 'Tratamiento ambulatorio de niños y niñas de 0 a 17 años por trastornos mentales y de comportamiento.', 8, 'ACT2', '2.2', NULL, 17),
-- Actividad 3
('PF_DEPRESION', 'Tratamiento ambulatorio de personas con depresión', 8, 'ACT3', '3.1', NULL, NULL),
('PF_CONDUCTA_SUICIDA', 'Tratamiento ambulatorio de personas con conducta suicida', 8, 'ACT3', '3.2', NULL, NULL),
('PF_ANSIEDAD', 'Tratamiento ambulatorio de personas con ansiedad', 8, 'ACT3', '3.3', NULL, NULL),
-- Actividad 4
('PF_CONSUMO_PERJUDICIAL', 'Intervenciones breves motivacionales para personas con consumo perjudicial del alcohol y tabaco', 8, 'ACT4', '4.1', NULL, NULL),
('PF_DEPENDENCIA_ALC_TAB', 'Intervención para personas con dependencia del alcohol y tabaco', 8, 'ACT4', '4.2', NULL, NULL),
('PF_REHAB_PSICOSOCIAL_ALC', 'Rehabilitación psicosocial de personas con trastornos del comportamiento debido al consumo del alcohol', 8, 'ACT4', '4.3', NULL, NULL),
-- Actividad 5
('PF_PSICOSIS', 'Tratamiento ambulatorio a personas con síndrome psicótico o trastorno del espectro de la esquizofrenia', 8, 'ACT5', '5.1', NULL, NULL),
('PF_PRIMER_EPISODIO', 'Tratamiento ambulatorio de personas con primer episodio psicótico', 8, 'ACT5', '5.2', NULL, NULL),
('PF_DETERIORO_COGNITIVO', 'Tratamiento ambulatorio para las personas con deterioro cognitivo', 8, 'ACT5', '5.3', NULL, NULL),
('PF_PRIMER_EPISODIO_2', 'Tratamiento ambulatorio de personas con primer episodio psicótico (Trastornos orgánicos)', 8, 'ACT5', '5.4', NULL, NULL),
('PF_CONTINUIDAD_CUIDADOS', 'Continuidad de cuidados a personas con trastorno mental grave', 8, 'ACT5', '5.5', NULL, NULL),
-- Actividad 6
('PF_REHAB_PSICOSOCIAL', 'Rehabilitación psicosocial', 8, 'ACT6', '6.1', NULL, NULL),
('PF_REHAB_LABORAL', 'Rehabilitación laboral', 8, 'ACT6', '6.2', NULL, NULL)
ON CONFLICT (id_paquete) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    id_actividad = EXCLUDED.id_actividad,
    codigo_paquete = EXCLUDED.codigo_paquete,
    edad_minima = EXCLUDED.edad_minima,
    edad_maxima = EXCLUDED.edad_maxima;

-- =============================================================================
-- 2. PAQUETE_GRUPO_DX
-- =============================================================================
`;
// Function to expand ranges like F200-F259
function expandDx(list) {
    const codes = [];
    list.forEach(item => {
        if (item.includes('-')) {
            const [start, end] = item.split('-');
            const prefixStart = start.substring(0, 1);
            const prefixEnd = end.substring(0, 1);
            
            if (prefixStart === prefixEnd) {
                const s = parseInt(start.substring(1), 10);
                const e = parseInt(end.substring(1), 10);
                for (let i = s; i <= e; i++) {
                    codes.push(prefixStart + i.toString().padStart(start.length - 1, '0'));
                }
            } else {
                codes.push(item); // Should be handled manually if prefix differs, but here it doesn't
            }
        } else {
            codes.push(item);
        }
    });
    return codes;
}

const dxMapping = {
    // 1.1 / 1.3
    PF_VIOLENCIA_FAMILIAR: expandDx(['T740', 'T741', 'T743', 'T748', 'T749', 'Y040-Y049', 'Y060-Y069', 'Y070-Y079', 'Y080-Y089']),
    PF_MALTRATO_NNA: expandDx(['T740', 'T741', 'T743', 'T748', 'T749', 'Y040-Y049', 'Y060-Y069', 'Y070-Y079', 'Y080-Y089']),
    // 1.2 / 1.4
    PF_VIOLENCIA_SEXUAL: expandDx(['T742', 'Y050-Y059']),
    PF_VS_NNA: expandDx(['T742', 'Y050-Y059']),
    // 2.1
    PF_AUTISMO: expandDx(['F840', 'F841', 'F845', 'F848', 'F849']),
    // 2.2
    PF_TM_COMPORTAMIENTO: expandDx(['F500-F599', 'F800-F833', 'F900-F989']),
    // 3.1
    PF_DEPRESION: expandDx(['F313', 'F314', 'F316', 'F320-F329', 'F330-F339', 'F340-F349', 'F380-F389', 'F390-F399']),
    // 3.2
    PF_CONDUCTA_SUICIDA: expandDx(['X600-X849']),
    // 3.3
    PF_ANSIEDAD: expandDx(['F400-F489']),
    // 4.1
    PF_CONSUMO_PERJUDICIAL: expandDx(['F101', 'F171']),
    // 4.2
    PF_DEPENDENCIA_ALC_TAB: expandDx(['F102', 'F172']),
    // 4.3 (Motor checks F102+Z502, we insert them so engine can fetch them)
    PF_REHAB_PSICOSOCIAL_ALC: expandDx(['F102', 'Z502']),
    // 5.1
    PF_PSICOSIS: expandDx(['F200-F259', 'F280-F299', 'F312', 'F315', 'F323', 'F333', 'F531', 'F105', 'F115', 'F125', 'F135', 'F145', 'F155', 'F165', 'F175', 'F185', 'F195']),
    // 5.2
    PF_PRIMER_EPISODIO: expandDx(['F200-F259', 'F280-F299', 'F312', 'F315', 'F323', 'F333', 'F531', 'F105', 'F115', 'F125', 'F135', 'F145', 'F155', 'F165', 'F175', 'F185', 'F195']),
    // 5.3
    PF_DETERIORO_COGNITIVO: expandDx(['F000-F099']),
    // 5.4
    PF_PRIMER_EPISODIO_2: expandDx(['F200-F259', 'F280-F299', 'F312', 'F315', 'F060', 'F061', 'F062', 'F531', 'F105', 'F115', 'F125', 'F135', 'F145', 'F155', 'F165', 'F175', 'F185', 'F195']),
    // 5.5 - Manual
    // 6.1
    PF_REHAB_PSICOSOCIAL: expandDx(['F200-F259', 'F280-F299', 'F312', 'F315', 'F060', 'F061', 'F062', 'F531', 'F105', 'F115', 'F125', 'F135', 'F145', 'F155', 'F165', 'F175', 'F185', 'F195']),
    // 6.2
    PF_REHAB_LABORAL: expandDx(['F200-F259', 'F280-F299', 'F312', 'F315', 'F060', 'F061', 'F062', 'F531', 'F105', 'F115', 'F125', 'F135', 'F145', 'F155', 'F165', 'F175', 'F185', 'F195'])
};

let dxSql = '';
for (const [paquete, codes] of Object.entries(dxMapping)) {
    const values = codes.map(c => `('${paquete}', '${c}')`).join(',\n    ');
    dxSql += `INSERT INTO paquete_grupo_dx (id_paquete, codigo_cie10) VALUES\n    ${values}\nON CONFLICT DO NOTHING;\n\n`;
}

// =============================================================================
// 3. PAQUETE_DETALLE y 4. PAQUETE_DETALLE_CODIGOS
// =============================================================================
const componentes = [
    // 1.1
    { paquete: 'PF_VIOLENCIA_FAMILIAR', comp: 'consulta_especializada', min: 2, codes: ['99215'] },
    { paquete: 'PF_VIOLENCIA_FAMILIAR', comp: 'psicoterapia', min: 6, codes: ['90806', '90834', '90860'] },
    { paquete: 'PF_VIOLENCIA_FAMILIAR', comp: 'intervencion_familiar', min: 2, codes: ['C2111.01', '96100.01', '90847'] },
    { paquete: 'PF_VIOLENCIA_FAMILIAR', comp: 'visita_o_movilizacion', min: 1, codes: ['C0011', 'C1043'] },
    // 1.2
    { paquete: 'PF_VIOLENCIA_SEXUAL', comp: 'consulta_especializada', min: 2, codes: ['99215'] },
    { paquete: 'PF_VIOLENCIA_SEXUAL', comp: 'intervencion_o_psicoterapia', min: 6, codes: ['99207.01', '90806', '90834', '90860'] },
    { paquete: 'PF_VIOLENCIA_SEXUAL', comp: 'intervencion_familiar', min: 2, codes: ['C2111.01', '96100.01', '90847'] },
    { paquete: 'PF_VIOLENCIA_SEXUAL', comp: 'visita_o_movilizacion', min: 1, codes: ['C0011', 'C1043'] },
    // 1.3
    { paquete: 'PF_MALTRATO_NNA', comp: 'consulta_especializada', min: 2, codes: ['99215'] },
    { paquete: 'PF_MALTRATO_NNA', comp: 'psicoterapia', min: 6, codes: ['90806', '90834', '90860'] },
    { paquete: 'PF_MALTRATO_NNA', comp: 'intervencion_familiar', min: 2, codes: ['C2111.01', '96100.01', '90847'] },
    { paquete: 'PF_MALTRATO_NNA', comp: 'visita_o_movilizacion', min: 1, codes: ['C0011', 'C1043'] },
    // 1.4
    { paquete: 'PF_VS_NNA', comp: 'consulta_especializada', min: 2, codes: ['99215'] },
    { paquete: 'PF_VS_NNA', comp: 'intervencion_o_psicoterapia', min: 6, codes: ['99207.01', '90806', '90834', '90860'] },
    { paquete: 'PF_VS_NNA', comp: 'intervencion_familiar', min: 2, codes: ['C2111.01', '96100.01', '90847'] },
    { paquete: 'PF_VS_NNA', comp: 'visita_o_movilizacion', min: 1, codes: ['C0011', 'C1043'] },

    // 2.1
    { paquete: 'PF_AUTISMO', comp: 'consulta_especializada', min: 2, codes: ['99214.06', '99215'] },
    { paquete: 'PF_AUTISMO', comp: 'psicoterapia', min: 6, codes: ['90806', '90834', '90860'] },
    { paquete: 'PF_AUTISMO', comp: 'grupal_to_tl', min: 6, codes: ['99207.02', 'Z507', '97009'] },
    { paquete: 'PF_AUTISMO', comp: 'visita_o_movilizacion', min: 1, codes: ['C0011', 'C1043'] },
    // 2.2
    { paquete: 'PF_TM_COMPORTAMIENTO', comp: 'consulta_sm', min: 2, codes: ['99207', '99214.06', '99215'] },
    { paquete: 'PF_TM_COMPORTAMIENTO', comp: 'intervencion_o_psicoterapia', min: 6, codes: ['99207.01', '90806', '90834', '90860'] },
    { paquete: 'PF_TM_COMPORTAMIENTO', comp: 'intervencion_familiar', min: 3, codes: ['C2111.01', '96100.01', '90847'] },
    { paquete: 'PF_TM_COMPORTAMIENTO', comp: 'visita_o_movilizacion', min: 1, codes: ['C0011', 'C1043'] },

    // 3.1
    { paquete: 'PF_DEPRESION', comp: 'consulta_sm', min: 3, codes: ['99207', '99215', '99214.06'] },
    { paquete: 'PF_DEPRESION', comp: 'psicoterapia_o_intervencion', min: 6, codes: ['90806', '90834', '90860', '99207.01'] },
    { paquete: 'PF_DEPRESION', comp: 'psicoeducacion', min: 1, codes: ['99207.04'] },
    { paquete: 'PF_DEPRESION', comp: 'intervencion_familiar', min: 2, codes: ['C2111.01', '96100.01', '90847'] },
    { paquete: 'PF_DEPRESION', comp: 'visita_o_movilizacion', min: 1, codes: ['C0011', 'C1043'] },
    // 3.2
    { paquete: 'PF_CONDUCTA_SUICIDA', comp: 'consulta_sm', min: 3, codes: ['99207', '99215', '99214.06'] },
    { paquete: 'PF_CONDUCTA_SUICIDA', comp: 'psicoterapia_o_intervencion', min: 6, codes: ['99207.01', '90806', '90834', '90860'] },
    { paquete: 'PF_CONDUCTA_SUICIDA', comp: 'intervencion_familiar', min: 2, codes: ['C2111.01', '96100.01', '90847'] },
    { paquete: 'PF_CONDUCTA_SUICIDA', comp: 'visita_o_movilizacion', min: 1, codes: ['C0011', 'C1043'] },
    // 3.3
    { paquete: 'PF_ANSIEDAD', comp: 'consulta_sm', min: 3, codes: ['99207', '99215', '99214.06'] },
    { paquete: 'PF_ANSIEDAD', comp: 'psicoterapia_o_intervencion', min: 6, codes: ['99207.01', '90806', '90834', '90860'] },
    { paquete: 'PF_ANSIEDAD', comp: 'intervencion_familiar', min: 2, codes: ['C2111.01', '96100.01', '90847'] },
    { paquete: 'PF_ANSIEDAD', comp: 'visita_o_movilizacion', min: 1, codes: ['C0011', 'C1043'] },

    // 4.1
    { paquete: 'PF_CONSUMO_PERJUDICIAL', comp: 'consejeria', min: 1, codes: ['99401.13'] },
    { paquete: 'PF_CONSUMO_PERJUDICIAL', comp: 'intervencion_breve', min: 4, codes: ['99207.01'] },
    // 4.2
    { paquete: 'PF_DEPENDENCIA_ALC_TAB', comp: 'consulta_medica', min: 4, codes: ['99215', '99214.06'] },
    { paquete: 'PF_DEPENDENCIA_ALC_TAB', comp: 'entrevista_motivacional', min: 2, codes: ['96150'] },
    { paquete: 'PF_DEPENDENCIA_ALC_TAB', comp: 'psicoterapia', min: 4, codes: ['90834', '90806', '90860'] },
    { paquete: 'PF_DEPENDENCIA_ALC_TAB', comp: 'intervencion_familiar', min: 2, codes: ['C2111.01', '96100.01', '90847'] },
    // 4.3
    { paquete: 'PF_REHAB_PSICOSOCIAL_ALC', comp: 'taller_psicoeducativo', min: 6, codes: ['90857'] },
    { paquete: 'PF_REHAB_PSICOSOCIAL_ALC', comp: 'intervencion_familiar', min: 2, codes: ['C2111.01'] },

    // 5.1
    { paquete: 'PF_PSICOSIS', comp: 'evaluacion_integral', min: 1, codes: ['99366'] },
    { paquete: 'PF_PSICOSIS', comp: 'consulta_especializada', min: 4, codes: ['99215'] },
    { paquete: 'PF_PSICOSIS', comp: 'consulta_sm', min: 10, codes: ['99207'] },
    { paquete: 'PF_PSICOSIS', comp: 'psicoterapia', min: 6, codes: ['90806', '90834', '90860'] },
    { paquete: 'PF_PSICOSIS', comp: 'intervencion_individual', min: 6, codes: ['99207.01'] },
    { paquete: 'PF_PSICOSIS', comp: 'psicoeducacion', min: 4, codes: ['99207.04'] },
    { paquete: 'PF_PSICOSIS', comp: 'rehabilitacion_laboral', min: 6, codes: ['97537.01'] },
    { paquete: 'PF_PSICOSIS', comp: 'intervencion_familiar', min: 5, codes: ['C2111.01', '96100.01', '90847'] },
    { paquete: 'PF_PSICOSIS', comp: 'visita_o_movilizacion', min: 2, codes: ['C0011', 'C1043'] },

    // 5.2
    { paquete: 'PF_PRIMER_EPISODIO', comp: 'consulta_especializada', min: 3, codes: ['99215'] },
    { paquete: 'PF_PRIMER_EPISODIO', comp: 'psicoterapia', min: 6, codes: ['90806', '90834', '90860'] },
    { paquete: 'PF_PRIMER_EPISODIO', comp: 'intervencion_familiar', min: 5, codes: ['C2111.01', '96100.01', '90847'] },
    { paquete: 'PF_PRIMER_EPISODIO', comp: 'visita_o_movilizacion', min: 2, codes: ['C0011', 'C1043'] },

    // 5.3
    { paquete: 'PF_DETERIORO_COGNITIVO', comp: 'evaluacion_integral', min: 1, codes: ['99366'] },
    { paquete: 'PF_DETERIORO_COGNITIVO', comp: 'consulta_especializada', min: 4, codes: ['99215'] },
    { paquete: 'PF_DETERIORO_COGNITIVO', comp: 'consulta_sm', min: 10, codes: ['99207'] },
    { paquete: 'PF_DETERIORO_COGNITIVO', comp: 'psicoterapia', min: 6, codes: ['90806', '90834', '90860'] },
    { paquete: 'PF_DETERIORO_COGNITIVO', comp: 'intervencion_individual', min: 6, codes: ['99207.01'] },
    { paquete: 'PF_DETERIORO_COGNITIVO', comp: 'psicoeducacion', min: 4, codes: ['99207.04'] },
    { paquete: 'PF_DETERIORO_COGNITIVO', comp: 'rehabilitacion_laboral', min: 6, codes: ['97537.01'] },
    { paquete: 'PF_DETERIORO_COGNITIVO', comp: 'terapia_cognitiva', min: 6, codes: ['96100.05'] },
    { paquete: 'PF_DETERIORO_COGNITIVO', comp: 'psicoeducacion_familia', min: 5, codes: ['C2111.01'] },
    { paquete: 'PF_DETERIORO_COGNITIVO', comp: 'otras_terapias_o_to', min: 4, codes: ['Z501', '97535.01'] },
    { paquete: 'PF_DETERIORO_COGNITIVO', comp: 'visita_o_movilizacion', min: 2, codes: ['C0011', 'C1043'] },

    // 5.4
    { paquete: 'PF_PRIMER_EPISODIO_2', comp: 'consulta_especializada', min: 3, codes: ['99215'] },
    { paquete: 'PF_PRIMER_EPISODIO_2', comp: 'psicoterapia', min: 6, codes: ['90806', '90834', '90860'] },
    { paquete: 'PF_PRIMER_EPISODIO_2', comp: 'intervencion_familiar', min: 5, codes: ['C2111.01', '96100.01', '90847'] },
    { paquete: 'PF_PRIMER_EPISODIO_2', comp: 'visita_o_movilizacion', min: 2, codes: ['C0011', 'C1043'] },
    // 6.1
    // The specific logic indicates 10 sessions of "rehabilitacion psicosocial (99207)". In earlier files it had a rule or it used generic 99207.
    { paquete: 'PF_REHAB_PSICOSOCIAL', comp: 'sesiones_rehabilitacion', min: 10, codes: ['99207'] },
    // 6.2
    { paquete: 'PF_REHAB_LABORAL', comp: 'rehabilitacion_laboral', min: 6, codes: ['97537.01'] }
];

let detSql = '';
let codSql = '';

const detallesInsert = componentes.map(c => `('${c.paquete}', '${c.comp}', ${c.min})`).join(',\n    ');
detSql = `INSERT INTO paquete_detalle (id_paquete, tipo_componente, cantidad_minima) VALUES\n    ${detallesInsert}\nON CONFLICT DO NOTHING;\n\n`;

for (const c of componentes) {
    const codesInserts = c.codes.map(code => `('${c.paquete}', '${c.comp}', '${code}')`).join(',\n    ');
    codSql += `INSERT INTO paquete_detalle_codigos (id_paquete, tipo_componente, codigo_item) VALUES\n    ${codesInserts}\nON CONFLICT DO NOTHING;\n\n`;
}

const finalSql = sql + dxSql + detSql + codSql + 'COMMIT;\n';
fs.writeFileSync('C:\\Users\\Usuario\\OneDrive\\Desktop\\Sistema CSMC - RENACER\\Backend\\src\\db\\seed_paquetes.sql', finalSql);
console.log('Finished writing seed_paquetes.sql');
