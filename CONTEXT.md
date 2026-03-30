# CONTEXTO DEL PROYECTO: Sistema de Monitoreo de Paquetes Terapéuticos PP 0131

> **INSTRUCCIÓN PARA EL AGENTE**: Este archivo es la fuente de verdad del proyecto.
> Léelo completo antes de generar cualquier código. No asumas nada que no esté aquí.

---

## 1. QUÉ ES EL SISTEMA

Sistema web para un **Centro de Salud Mental Comunitario (CSMC)** que permite:
- Monitorear en tiempo real el avance de los **paquetes terapéuticos PP 0131** de cada paciente.
- Detectar pacientes con paquetes **próximos a vencer** (dentro de N días configurables, ejemplo: 30 días).
- Mostrar qué actividades faltan por completar y qué profesionales pueden realizarlas.
- Ayudar al establecimiento a cumplir sus **metas e indicadores** sin perder de vista a los pacientes.

**Alcance actual:** Un solo CSMC. Los datos vienen de archivos CSV exportados del HIS MINSA (no hay conexión directa online). El panel es para el equipo técnico/administrativo y coordinación clínica.

---

## 2. STACK TECNOLÓGICO

| Capa | Tecnología |
|------|-----------|
| Base de datos | PostgreSQL |
| Backend/API | Node.js + Express |
| Frontend |react and vite|
| Archivos de entrada | CSV exportados del HIS MINSA |
| Dependencias npm | express, pg, csv-parse, multer, dotenv |

**No usar:** Docker, virtualización, frameworks pesados. La laptop de desarrollo tiene recursos limitados.

---

## 3. ARCHIVOS CSV DE ENTRADA (HIS MINSA)

### 3.1 Maestro Personal (CSV estático, actualización cada ~3 días)
Columnas relevantes:
`Id_Personal, Id_Tipo_Documento, Numero_Documento, Apellido_Paterno_Personal, Apellido_Materno_Personal, Nombres_Personal, Fecha_Nacimiento, Id_Condicion, Id_Profesion, Id_Colegio, Id_Colegiatura, Id_Establecimiento, Fecha_Alta, Fecha_Baja`

### 3.2 Maestro Registrador (CSV estático)
Columnas: `Id_Registrador, Id_Tipo_Documento, Numero_Documento, Apellido_Paterno_Registrador, Apellido_Materno_Registrador, Nombres_Registrador, Fecha_Nacimiento`

### 3.3 Maestro Paciente (CSV estático)
Columnas: `Id_Paciente, Id_Tipo_Documento, Numero_Documento, Apellido_Paterno_Paciente, Apellido_Materno_Paciente, Nombres_Paciente, Fecha_Nacimiento, Genero, Id_Etnia, Historia_Clinica, Ficha_Familiar, Ubigeo_Nacimiento, Ubigeo_Reniec, Domicilio_Reniec, Ubigeo_Declarado, Domicilio_Declarado, Referencia_Domicilio, Id_Pais, Id_Establecimiento, Fecha_Alta, Fecha_Modificacion`

### 3.4 nominaltramaYYYYMM.csv (mensual, ~12 archivos al año)
Tabla principal de atenciones. Columnas clave:

| Columna | Descripción |
|---------|-------------|
| `Id_Cita` | Identificador único de la cita |
| `Anio / Mes / Dia` | Descomposición de la fecha de atención |
| `Fecha_Atencion` | Fecha completa de la atención |
| `Id_Ups` | Unidad Productora de Servicios (ej: SSM = Salud Mental) |
| `Id_Establecimiento` | Código del establecimiento |
| `Id_Paciente` | Código del paciente |
| `Id_Personal` | Código del profesional que atiende |
| `Id_Registrador` | Código del digitador |
| `Id_Financiador` | Seguro (SIS, particular, etc.) |
| `Id_Condicion_Establecimiento` | Nuevo / conocido / referido para el establecimiento |
| `Id_Condicion_Servicio` | Nuevo / conocido para ese servicio |
| `Id_Turno` | Turno: M (mañana), T (tarde), N (noche) |
| `Codigo_Item` | **CAMPO CLAVE**: CIE-10, código de procedimiento o actividad |
| `Tipo_Diagnostico` | **P** = presuntivo, **D** = definitivo, **R** = repetido/seguimiento |
| `Id_Correlativo` | Orden de la actividad dentro de la cita (1, 2, 3...) |
| `Valor_Lab` | Valor de laboratorio o seguimiento del diagnóstico |
| `Id_Correlativo_Lab` | Orden del valor_lab dentro del código_item |
| `Edad_Reg` | Edad del paciente al momento de atención |
| `Tipo_Edad` | Unidad: A=años, M=meses, D=días |
| `Peso, Talla, Hemoglobina` | Datos antropométricos |
| `Fecha_Registro` | Fecha de digitación en el sistema |
| `Fecha_Modificacion` | Fecha de última modificación |

**Clave primaria de la tabla atencion:** `(Id_Cita, Id_Correlativo)` — nunca duplicar esta combinación (upsert).

**Nombre del archivo determina periodo:** `nominaltrama202501.csv` → año=2025, mes=01.

---

## 4. MODELO DE BASE DE DATOS

### Tablas principales

```sql
-- Pacientes
CREATE TABLE paciente (
    id_paciente TEXT PRIMARY KEY,
    id_tipo_documento TEXT,
    numero_documento TEXT,
    apellido_paterno TEXT,
    apellido_materno TEXT,
    nombres TEXT,
    fecha_nacimiento DATE,
    genero TEXT,
    id_etnia TEXT,
    historia_clinica TEXT,
    id_establecimiento TEXT,
    fecha_alta DATE,
    fecha_modificacion TIMESTAMP
);

-- Profesionales (personal del CSMC)
CREATE TABLE profesional (
    id_personal TEXT PRIMARY KEY,
    numero_documento TEXT,
    apellido_paterno TEXT,
    apellido_materno TEXT,
    nombres TEXT,
    id_profesion TEXT,      -- determina qué actividades puede realizar
    id_establecimiento TEXT,
    fecha_alta DATE,
    fecha_baja DATE,
    estado_activo BOOLEAN GENERATED ALWAYS AS (fecha_baja IS NULL) STORED
);

-- Registradores (digitadores)
CREATE TABLE registrador (
    id_registrador TEXT PRIMARY KEY,
    numero_documento TEXT,
    apellido_paterno TEXT,
    apellido_materno TEXT,
    nombres TEXT
);

-- Atenciones (nominaltrama)
CREATE TABLE atencion (
    id_cita                      TEXT,
    id_correlativo               INT,
    fecha_atencion               DATE NOT NULL,
    anio                         INT,
    mes                          INT,
    dia                          INT,
    id_paciente                  TEXT REFERENCES paciente(id_paciente),
    id_personal                  TEXT REFERENCES profesional(id_personal),
    id_registrador               TEXT,
    id_ups                       TEXT,
    id_establecimiento           TEXT,
    id_financiador               TEXT,
    id_condicion_establecimiento TEXT,
    id_condicion_servicio        TEXT,
    id_turno                     TEXT,
    codigo_item                  TEXT NOT NULL,
    tipo_diagnostico             CHAR(1),    -- P, D, R
    valor_lab                    TEXT,
    id_correlativo_lab           INT,
    edad_reg                     INT,
    tipo_edad                    CHAR(1),
    peso                         NUMERIC(5,2),
    talla                        NUMERIC(5,2),
    hemoglobina                  NUMERIC(4,2),
    fecha_registro               TIMESTAMP,
    fecha_modificacion           TIMESTAMP,
    id_actividad                 TEXT,       -- se llena automáticamente si codigo_item es 'APP...'
    PRIMARY KEY (id_cita, id_correlativo)
);

-- Tabla de actividades PP 0131 (ACT1 a ACT6)
CREATE TABLE actividad (
    id_actividad TEXT PRIMARY KEY,
    codigo       TEXT NOT NULL,   -- ej: '5005189'
    nombre       TEXT NOT NULL
);

-- Definición de paquetes terapéuticos
CREATE TABLE paquete_definicion (
    id_paquete     TEXT PRIMARY KEY,
    nombre         TEXT NOT NULL,
    plazo_meses    INT  NOT NULL DEFAULT 8,
    id_actividad   TEXT REFERENCES actividad(id_actividad),
    codigo_paquete TEXT,          -- ej: '1.1', '2.1', '5.5'
    edad_minima    INT,           -- NULL = sin límite inferior (ej: 18 para PF_VIOLENCIA_FAMILIAR)
    edad_maxima    INT            -- NULL = sin límite superior (ej: 17 para paquetes NNA)
);

-- Códigos CIE-10 que disparan cada paquete
CREATE TABLE paquete_grupo_dx (
    id_paquete TEXT REFERENCES paquete_definicion(id_paquete),
    codigo_cie10 TEXT,
    PRIMARY KEY (id_paquete, codigo_cie10)
);

-- Componentes requeridos por paquete
CREATE TABLE paquete_detalle (
    id_paquete       TEXT REFERENCES paquete_definicion(id_paquete),
    tipo_componente  TEXT,
    cantidad_minima  INT NOT NULL,
    usar_prefijo     BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE = comparar solo primeros 5 chars del codigo_item
    PRIMARY KEY (id_paquete, tipo_componente)
);

-- Códigos de atención válidos por componente (lógica del "o")
CREATE TABLE paquete_detalle_codigos (
    id_paquete TEXT,
    tipo_componente TEXT,
    codigo_item TEXT,
    PRIMARY KEY (id_paquete, tipo_componente, codigo_item),
    FOREIGN KEY (id_paquete, tipo_componente) REFERENCES paquete_detalle(id_paquete, tipo_componente)
);

-- Paquetes asignados a pacientes
CREATE TABLE paquete_paciente (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_paquete          TEXT REFERENCES paquete_definicion(id_paquete),
    id_paciente         TEXT REFERENCES paciente(id_paciente),
    fecha_inicio        DATE NOT NULL,
    fecha_limite        DATE NOT NULL,   -- fecha_inicio + plazo_meses
    estado              TEXT NOT NULL CHECK (estado IN ('abierto', 'completado', 'vencido')),
    fecha_cierre        DATE,
    dx_principal        TEXT,            -- CIE-10 que disparó el paquete
    tipo_diagnostico_dx CHAR(1),         -- 'P' o 'D' (el que estaba en la atención disparadora)
    valor_lab_dx        TEXT,            -- Valor_Lab de la atención disparadora (si aplica)
    observaciones       TEXT,
    UNIQUE (id_paquete, id_paciente, fecha_inicio)
);

-- Qué profesiones pueden realizar cada tipo de componente
CREATE TABLE componente_profesion_permitida (
    tipo_componente TEXT,
    id_profesion TEXT,
    observaciones TEXT,
    PRIMARY KEY (tipo_componente, id_profesion)
);
```

---

## 5. CATÁLOGO COMPLETO DE PAQUETES PP 0131

### 5.1 Definición de paquetes (paquete_definicion + paquete_grupo_dx)

| id_paquete | codigo_paquete | nombre | plazo_meses | edad_minima | edad_maxima | códigos CIE-10 que lo activan |
|-----------|---------------|--------|-------------|-------------|-------------|-------------------------------|
| PF_VIOLENCIA_FAMILIAR | 1.1 | Tratamiento especializado en violencia familiar | 8 | 18 | — | T740, T741, T743, T748, T749, Y04, Y06, Y07, Y08 |
| PF_VIOLENCIA_SEXUAL | 1.2 | Tratamiento especializado de personas afectadas por violencia sexual | 8 | 18 | — | T742, Y05 |
| PF_MALTRATO_NNA | 1.3 | Tratamiento de NNA afectados por maltrato infantil | 8 | — | 17 | T740, T741, T743, T748, T749, Y04, Y06, Y07, Y08 |
| PF_VS_NNA | 1.4 | Tratamiento especializado NNA afectados por violencia sexual | 8 | — | 17 | T742, Y05 |
| PF_AUTISMO | 2.1 | Trastornos del espectro autista (0-17 años) | 8 | — | 17 | F840, F841, F845, F848, F849 |
| PF_TM_COMPORTAMIENTO | 2.2 | Trastornos mentales y del comportamiento (niñez/adolescencia) | 8 | — | 17 | F50-F59, F80-F83, F90-F98 |
| PF_DEPRESION | 3.1 | Tratamiento ambulatorio de personas con depresión | 8 | — | — | F313, F314, F316, F32-F39 |
| PF_CONDUCTA_SUICIDA | 3.2 | Tratamiento ambulatorio de personas con conducta suicida | 8 | — | — | X60-X84 |
| PF_ANSIEDAD | 3.3 | Tratamiento ambulatorio de personas con ansiedad | 8 | — | — | F40-F48 |
| PF_CONSUMO_PERJUDICIAL | 4.1 | Intervenciones breves motivacionales alcohol/tabaco | 8 | — | — | F101, F171 |
| PF_DEPENDENCIA_ALC_TAB | 4.2 | Intervención personas con dependencia de alcohol y tabaco | 8 | — | — | F102, F172 |
| PF_REHAB_PSICOSOCIAL_ALC | 4.3 | Rehabilitación psicosocial por trastorno del comportamiento (alcohol) | 8 | — | — | F102 + Z502 (regla especial) |
| PF_PSICOSIS | 5.1 | Tratamiento ambulatorio síndrome psicótico/espectro esquizofrenia | 8 | — | — | F20-F25, F28-F29, F312, F315, F323, F333, F531, F105-F195 |
| PF_PRIMER_EPISODIO | 5.2 | Tratamiento ambulatorio primer episodio psicótico | 8 | — | — | F20-F25, F28-F29, F312, F315, F323, F333, F531, F105-F195 |
| PF_DETERIORO_COGNITIVO | 5.3 | Tratamiento ambulatorio deterioro cognitivo | 8 | — | — | F00-F09 |
| PF_PRIMER_EPISODIO_2 | 5.4 | Tratamiento ambulatorio primer episodio psicótico (trastornos orgánicos) | 8 | — | — | F20-F25, F28-F29, F060, F061, F062, F531, F105-F195 |
| PF_CONTINUIDAD_CUIDADOS | 5.5 | Continuidad de cuidados a personas con trastorno mental grave | 8 | — | — | _(sin grupo_dx: no se abre automáticamente, cierre manual)_ |
| PF_REHAB_PSICOSOCIAL | 6.1 | Rehabilitación psicosocial | 8 | — | — | F20-F25, F28-F29, F060, F061, F062, F531, F105-F195 |
| PF_REHAB_LABORAL | 6.2 | Rehabilitación laboral | 8 | — | — | F20-F25, F28-F29, F060, F061, F062, F531, F105-F195 |

> **Nota sobre edad:** La validación se hace calculando la edad exacta del paciente en `fecha_atencion` usando `fecha_nacimiento` de la tabla `paciente`. Si el paciente no tiene `fecha_nacimiento` registrado, se omite la validación y se abre el paquete igual.

> **Nota sobre PF_CONTINUIDAD_CUIDADOS (5.5):** No tiene componentes definidos ni códigos CIE-10 disparadores. Nunca se completa automáticamente. El cierre debe hacerse manualmente desde la interfaz.

### 5.2 Componentes por paquete (paquete_detalle + paquete_detalle_codigos)

> **REGLA DEL "O":** Si el texto normativo dice "A o B o C", significa que cualquier atención con esos códigos suma al **mismo** componente. Se registran todos en `paquete_detalle_codigos` para ese `tipo_componente`.

#### PF_VIOLENCIA_FAMILIAR
| tipo_componente | codigos_item_validos | cantidad_minima |
|----------------|---------------------|-----------------|
| consulta_especializada | 99215 | 2 |
| psicoterapia_individual | 90806, 90834, 90860 | 6 |
| intervencion_familiar | C2111.01, 96100.01, 90847 | 2 |
| visita_domiciliaria_o_red | C0011, C1043 | 1 |

#### PF_VIOLENCIA_SEXUAL
| tipo_componente | codigos_item_validos | cantidad_minima |
|----------------|---------------------|-----------------|
| consulta_especializada | 99215 | 2 |
| intervencion_o_psicoterapia_ind | 99207.01, 90806, 90834, 90860 | 6 |
| intervencion_familiar | C2111.01, 96100.01, 90847 | 2 |
| visita_domiciliaria_o_red | C0011, C1043 | 1 |

#### PF_AUTISMO
| tipo_componente | codigos_item_validos | cantidad_minima |
|----------------|---------------------|-----------------|
| consulta_especializada | 99214.06, 99215 | 2 |
| psicoterapia_individual | 90806, 90834, 90860 | 6 |
| intervencion_grupal_o_terapias | 99207.02, Z507, 97009 | 6 |
| visita_domiciliaria_o_red | C0011, C1043 | 1 |

#### PF_TM_COMPORTAMIENTO
| tipo_componente | codigos_item_validos | cantidad_minima |
|----------------|---------------------|-----------------|
| consulta_salud_mental | 99207, 99214.06, 99215 | 2 |
| intervencion_o_psicoterapia_ind | 99207.01, 90806, 90834, 90860 | 6 |
| intervencion_familiar | C2111.01, 96100.01, 90847 | 3 |
| visita_domiciliaria_o_red | C0011, C1043 | 1 |

#### PF_DEPRESION
| tipo_componente | codigos_item_validos | cantidad_minima |
|----------------|---------------------|-----------------|
| consulta_salud_mental | 99207, 99215, 99214.06 | 3 |
| intervencion_o_psicoterapia_ind | 90806, 90834, 90860, 99207.01 | 6 |
| psicoeducacion | 99207.04 | 1 |
| intervencion_familiar | C2111.01, 96100.01, 90847 | 2 |
| visita_domiciliaria_o_red | C0011, C1043 | 1 |

#### PF_CONDUCTA_SUICIDA
| tipo_componente | codigos_item_validos | cantidad_minima |
|----------------|---------------------|-----------------|
| consulta_salud_mental | 99207, 99215, 99214.06 | 3 |
| intervencion_o_psicoterapia_ind | 99207.01, 90806, 90834, 90860 | 6 |
| intervencion_familiar | C2111.01, 96100.01, 90847 | 2 |
| visita_domiciliaria_o_red | C0011, C1043 | 1 |

#### PF_ANSIEDAD
| tipo_componente | codigos_item_validos | cantidad_minima |
|----------------|---------------------|-----------------|
| consulta_salud_mental | 99207, 99215, 99214.06 | 3 |
| intervencion_o_psicoterapia_ind | 99207.01, 90806, 90834, 90860 | 6 |
| intervencion_familiar | C2111.01, 96100.01, 90847 | 2 |
| visita_domiciliaria_o_red | C0011, C1043 | 1 |

#### PF_CONSUMO_PERJUDICIAL
| tipo_componente | codigos_item_validos | cantidad_minima |
|----------------|---------------------|-----------------|
| consejeria_estilos_vida | 99401.13 | 1 |
| intervencion_breve | 99207.01 | 4 |

#### PF_DEPENDENCIA_ALC_TAB
| tipo_componente | codigos_item_validos | cantidad_minima |
|----------------|---------------------|-----------------|
| consulta_medica | 99215, 99214.06 | 4 |
| entrevista_motivacional | 96150 | 2 |
| psicoterapia_individual | 90834, 90806, 90860 | 4 |
| intervencion_familiar | C2111.01, 96100.01, 90847 | 2 |

#### PF_REHAB_PSICOSOCIAL_ALC
| tipo_componente | codigos_item_validos | cantidad_minima |
|----------------|---------------------|-----------------|
| taller_psicoeducativo_grupal | 90857 | 6 |
| intervencion_familiar | C2111.01 | 2 |

> ⚠️ **Regla especial PF_REHAB_PSICOSOCIAL_ALC**: El paquete se activa solo si el paciente tiene registrados **ambos** códigos F102 y Z502 en el mismo periodo de atenciones. No basta con tener F102 solo (ese es PF_DEPENDENCIA_ALC_TAB).

#### PF_PSICOSIS
| tipo_componente | codigos_item_validos | cantidad_minima |
|----------------|---------------------|-----------------|
| evaluacion_integral_interdisciplinaria | 99366 | 1 |
| consulta_medica_especializada | 99215 | 4 |
| consulta_salud_mental | 99207 | 10 |
| psicoterapia_individual | 90806, 90834, 90860 | 6 |
| intervencion_individual | 99207.01 | 6 |
| psicoeducacion | 99207.04 | 4 |
| rehabilitacion_laboral | 97537.01 | 6 |
| intervencion_familiar | C2111.01, 96100.01, 90847 | 5 |
| visita_domiciliaria_o_red | C0011, C1043 | 2 |

#### PF_DETERIORO_COGNITIVO
| tipo_componente | codigos_item_validos | cantidad_minima |
|----------------|---------------------|-----------------|
| evaluacion_integral_interdisciplinaria | 99366 | 1 |
| consulta_medica_especializada | 99215 | 4 |
| consulta_salud_mental | 99207 | 10 |
| psicoterapia_individual | 90806, 90834, 90860 | 6 |
| intervencion_individual | 99207.01 | 6 |
| psicoeducacion | 99207.04 | 4 |
| rehabilitacion_laboral | 97537.01 | 6 |
| terapia_rehabilitacion_cognitiva | 96100.05 | 6 |
| psicoeducacion_familia_cuidadores | C2111.01 | 5 |
| otras_terapias_o_to_grupal | Z501, 97535.01 | 4 |
| visita_domiciliaria_o_red | C0011, C1043 | 2 |

---

## 6. REGLAS DE NEGOCIO

### 6.1 Apertura de PaquetePaciente
Se crea un nuevo `paquete_paciente` cuando se cumplen **todas** estas condiciones:

1. El `codigo_item` del registro de atención **es exactamente uno de los códigos CIE-10** definidos en `paquete_grupo_dx` para ese paquete (es el diagnóstico el que dispara el paquete, no el procedimiento).
2. El `tipo_diagnostico` de ese registro es **`'D'`** (definitivo) o **`'P'`** (presuntivo). **NO se abre con `'R'`** (repetido/seguimiento).
3. No existe ya un `paquete_paciente` con estado `'abierto'` para ese mismo par `(id_paquete, id_paciente)`.

> ⚠️ **Importante:** Un mismo diagnóstico CIE-10 puede pertenecer al grupo de varios paquetes simultáneamente (e.g., F102 abre tanto `PF_DEPENDENCIA_ALC_TAB` como `PF_REHAB_PSICOSOCIAL_ALC`). En ese caso se crean **tantos `paquete_paciente` como paquetes correspondan**. Ver regla 6.6.

Campos al crear:
- `fecha_inicio` = `fecha_atencion` del registro que contiene el CIE-10 disparador (este es el inicio del periodo del paquete)
- `fecha_limite` = `fecha_inicio` + `plazo_meses` meses (normalmente 8)
- `estado` = `'abierto'`
- `dx_principal` = el código CIE-10 que disparó el paquete

### 6.2 Cómputo del avance (lógica del "o")
Para cada `paquete_paciente` abierto, por cada `tipo_componente`:
- `codigos_item_validos` = todos los códigos en `paquete_detalle_codigos` para ese componente.
- `cantidad_realizada` = COUNT de atenciones del paciente entre `fecha_inicio` y `fecha_limite` donde `codigo_item` ∈ `codigos_item_validos`.
- `cumplido` = `cantidad_realizada >= cantidad_minima`.

**Ejemplo:** Componente `intervencion_o_psicoterapia_ind` requiere 6. Si el paciente tiene 3 con `99207.01`, 2 con `90834` y 1 con `90806` → `cantidad_realizada = 6` → cumplido ✅.

### 6.3 Cambio de estado del paquete
- Si **todos** los componentes tienen `cumplido = true` antes de `fecha_limite` → `estado = 'completado'`, `fecha_cierre = fecha de la última atención que completó el paquete`.
- Si `CURRENT_DATE > fecha_limite` y al menos un componente no cumplido → `estado = 'vencido'`.
- Si `estado = 'abierto'` y `fecha_limite - CURRENT_DATE <= N días` (N configurable, default 30) → se considera **"próximo a vencer"** (no es un estado, es un filtro).

### 6.6 Paquetes simultáneos por paciente
Un paciente **puede y debe tener varios `paquete_paciente` abiertos al mismo tiempo**. Esto ocurre porque:

- Un diagnóstico CIE-10 puede activar **más de un paquete** (e.g., F102 activa `PF_DEPENDENCIA_ALC_TAB` y también puede activar `PF_REHAB_PSICOSOCIAL_ALC` si se cumple su regla especial).
- Un paciente puede recibir **diagnósticos distintos** en la misma atención o en atenciones diferentes, cada uno abriendo su propio paquete.
- No existe límite en la cantidad de paquetes simultáneos activos por paciente.

La lógica de detección debe evaluar **cada registro** de `atencion` con `tipo_diagnostico IN ('D','P')` contra **todos** los paquetes definidos, no solo contra uno.

---
- Después de cada carga de `nominaltrama` → recalcular paquetes del periodo cargado.
- Tarea diaria (cron job o script manual) → revisar cambios de estado `abierto → próximo a vencer → vencido`.

### 6.5 Carga de archivos (upsert)
- **Maestros:** detectar tipo por nombre de archivo, hacer upsert por PK.
- **nominaltrama:** validar nombre (extraer año y mes), upsert por `(id_cita, id_correlativo)`.
- Registrar en tabla `historial_cargas`: archivo, fecha, usuario, registros procesados.

---

## 7. MÓDULOS Y VISTAS DEL SISTEMA

### 7.1 Administración de datos HIS
- **Subir maestros:** carga de personal, registrador, paciente (CSV) con upsert.
- **Subir nominaltrama mensual:** validación básica + carga + recálculo automático de paquetes.
- **Historial de cargas:** tabla con archivo, fecha, usuario, resultado.

### 7.2 Dashboard general
Indicadores:
- Total paquetes: abiertos / completados / vencidos.
- Distribución por tipo de paquete (gráfico de barras).
- Porcentaje de paquetes completados dentro del plazo (meta PP 0131).
- Paquetes próximos a vencer (≤30 días) como alerta destacada.

### 7.3 Listado de paquetes próximos a vencer
Tabla con:
- Nombre paciente, DNI, edad
- Tipo de paquete
- Fecha inicio / Fecha límite / Días restantes (badge: rojo ≤15, amarillo 16-30)
- Porcentaje de avance
- Botón "Ver detalle"

Filtros: tipo de paquete, rango de días para vencer, profesional principal.

### 7.4 Ficha de detalle paciente/paquete
- Datos del paciente (nombre, DNI, edad, historia clínica).
- Resumen del paquete: tipo, Dx principal, fecha inicio, fecha límite, estado, % avance.
- **Tabla de componentes:** tipo_componente | requerido | realizado | pendiente | códigos válidos.
- **Línea de tiempo de atenciones:** fecha, Codigo_Item, profesional, turno, Valor_Lab si aplica.
- **Sección "¿Quién puede completar?":** para cada componente pendiente, lista de profesionales activos del CSMC habilitados según `componente_profesion_permitida`.

### 7.5 Vista por profesional
- Lista de pacientes en cuyos paquetes el profesional ha intervenido.
- Paquetes de sus pacientes próximos a vencer y qué actividades faltan.

---

## 8. ESTRUCTURA DE CARPETAS DEL PROYECTO

```
csmc-paquetes/
├── .env                        # DATABASE_URL y config
├── CONTEXT.md                  # Este archivo
├── package.json
├── src/
│   ├── db/
│   │   ├── schema.sql          # DDL completo
│   │   ├── seed_paquetes.sql   # INSERT de todos los paquetes y componentes (generado)
│   │   ├── gen_seed.js         # Script para regenerar seed_paquetes.sql
│   │   └── migration_v2.sql    # Migraciones de esquema v2
│   ├── importacion/
│   │   ├── cargarMaestros.js   # Carga personal, registrador, paciente
│   │   └── cargarNominaltrama.js # Carga mensual + llama a calcularPaquetes
│   ├── paquetes/
│   │   ├── calcularPaquetes.js # Motor: apertura, avance, estado
│   │   └── resumenAvance.js    # Queries de solo lectura para la API
│   ├── api/
│   │   └── server.js           # Express + todos los endpoints
│   ├── reportes/
│   │   └── produccionProfesional.js # Reporte de producción por profesional
│   └── jobs/
│       └── diario.js           # Cron: actualiza estados vencidos
├── uploads/                    # Directorio temporal de archivos CSV subidos
└── public/
    └── index.html              # Frontend React+Vite (build)
```

---

## 9. ENDPOINTS DE LA API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/dashboard?anio=2026 | Totales y distribución por tipo de paquete |
| GET | /api/paquetes?estado=abierto&periodo=2026-02&limite=200 | Lista de paquetes con filtros |
| GET | /api/paquetes/proximos-a-vencer?dias=30 | Lista paquetes próximos a vencer |
| GET | /api/paquetes/:id | Detalle de un paquete_paciente (componentes + atenciones) |
| GET | /api/pacientes/buscar?q=dni_o_nombre | Buscar pacientes por DNI o nombre |
| GET | /api/pacientes/:id/paquetes | Todos los paquetes de un paciente |
| GET | /api/profesional/:id/paquetes | Paquetes donde intervino el profesional |
| GET | /api/profesionales | Lista de profesionales activos |
| GET | /api/reportes/produccion-profesional?fechaInicio=&fechaFin=&idProfesional= | Reporte de producción por profesional |
| POST | /api/importar/maestros | Sube y carga CSV de maestros |
| POST | /api/importar/nominaltrama | Sube nominaltramaYYYYMM.csv + recalcula paquetes |
| GET | /api/historial-cargas?limite=50 | Historial de archivos cargados |

---

## 10. VARIABLES DE ENTORNO (.env)

```
DATABASE_URL=postgresql://usuario:password@localhost:5432/csmc_paquetes
PORT=3000
DIAS_PROXIMO_VENCER=30
```

---

## 11. NOTAS IMPORTANTES PARA EL DESARROLLO

1. **No reinventar el catálogo de paquetes.** Los 19 paquetes con sus componentes y códigos están definidos en la sección 5. Usar `gen_seed.js` para regenerar el SQL seed si es necesario.
2. **La lógica del "o" se resuelve en la base de datos**: todos los códigos alternativos de un componente van en `paquete_detalle_codigos` y se cuenta con `WHERE codigo_item IN (...)` o con comparación de prefijo si `usar_prefijo = TRUE`.
3. **`usar_prefijo = TRUE`** en `paquete_detalle`: cuando está activo, el motor compara solo los primeros 5 caracteres del `codigo_item` de la atención con el código del componente. Sirve para capturar variantes como `99207`, `99207.01`, `99207.02`, `97537`, `97537.01`, etc. en un solo componente.
4. **El campo `Codigo_Item` del nominaltrama puede ser:** CIE-10 (diagnóstico), código de procedimiento (99207, 90806, etc.) o código de actividad colectiva (`APP...`). Todos van en la misma columna. Solo los CIE-10 abren paquetes; los procedimientos acumulan componentes.
5. **Un paciente puede tener múltiples paquetes abiertos simultáneamente.** El motor evalúa cada registro de atención con `tipo_diagnostico IN ('D','P')` contra **todos** los paquetes definidos en `paquete_grupo_dx`. Un CIE-10 puede estar en el grupo disparador de varios paquetes a la vez.
6. **Validación de edad en apertura:** Se calcula `AGE(fecha_atencion, fecha_nacimiento)` y se compara con `edad_minima`/`edad_maxima` del paquete. Si el paciente no tiene `fecha_nacimiento`, se omite la validación.
7. **Regla especial PF_REHAB_PSICOSOCIAL_ALC:** requiere que el paciente tenga **ambos** códigos F102 y Z502 registrados como `'D'` en el mismo mes calendario.
8. **PF_CONTINUIDAD_CUIDADOS (5.5):** no tiene `paquete_grupo_dx` (no se abre automáticamente) ni componentes fijos (nunca se completa automáticamente). Es el único paquete de cierre 100% manual.
9. **Flujo al importar nominaltrama:** carga CSV → upsert en `atencion` por `(id_cita, id_correlativo)` → llama a `calcularPaquetes()` automáticamente → registra en `historial_cargas`.
10. **Prioridad de desarrollo:** primero BD + carga de CSVs + motor de paquetes, luego API, luego frontend.