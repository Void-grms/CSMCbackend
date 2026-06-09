# CSMC RENACER — Backend

API del **Sistema de Monitoreo de Paquetes Terapéuticos PP 0131** del Centro de Salud
Mental Comunitario (CSMC) RENACER. Procesa las tramas del **HIS MINSA**
(`nominaltrama`), calcula el avance de los paquetes terapéuticos, y expone los datos a
la aplicación web ([CSMCfrontend](https://github.com/Void-grms/CSMCfrontend)).

## ¿Qué hace?

A partir de los archivos CSV de atenciones del HIS, el sistema:

- **Importa** atenciones (`nominaltrama`) y maestros (pacientes, profesionales, registradores).
- **Abre y avanza paquetes terapéuticos** (PP 0131): detecta los diagnósticos disparadores,
  calcula el cumplimiento de cada componente y marca los paquetes como
  `abierto` / `completado` / `vencido`.
- **Monitorea la dispensación de medicamentos** (módulo Farmacia): detecta el código
  `99199.05`, calcula la próxima entrega esperada por paciente (semáforo) y guarda notas.
- **Genera documentos** (.docx) y **reportes** (HIS 40A, HIS diario, producción por
  profesional, reporte de atenciones multiusuario).
- **Verifica errores de codificación**: audita las aperturas de paquete (primera aparición
  del diagnóstico en cita Nuevo/Reingreso → debe ser Definitivo + código PAI `99366`).
- **Administra** el catálogo de paquetes (versionado), usuarios, personal y auditoría.

## Stack

- **Node.js + Express 5** (CommonJS)
- **PostgreSQL** (`pg`)
- **JWT** (`jsonwebtoken`) + `bcryptjs` para autenticación
- `csv-parse` + `iconv-lite` (lectura de CSV Windows-1252 del HIS)
- `pizzip` / `docxtemplater` (.docx) y `exceljs` (.xlsx)
- `multer` (subida de archivos), `cors`, `dotenv`

## Requisitos

- Node.js 18+
- PostgreSQL 14+ (probado en 18)

## Puesta en marcha

```bash
# 1. Instalar dependencias
npm install

# 2. Crear el archivo .env (ver más abajo)

# 3. Crear la base de datos en PostgreSQL
#    createdb csmc_paquetes

# 4. Arrancar el servidor (aplica las migraciones automáticamente)
npm start
```

Al iniciar, `src/db/migrate.js` ejecuta el esquema y las migraciones pendientes; luego el
servidor queda escuchando en el puerto configurado.

### Variables de entorno (`.env`)

```env
DATABASE_URL=postgresql://usuario:password@localhost:5432/csmc_paquetes
PORT=3000
JWT_SECRET=tu_clave_secreta
```

> El `.env` está en `.gitignore` y **no** debe subirse al repositorio.

## Estructura

```
src/
├── api/                 Rutas Express
│   ├── server.js        Punto de entrada: monta rutas, migraciones, endpoints
│   ├── auth.js          Login y verificación de token (JWT)
│   ├── ajustes.js       Catálogo de paquetes, personal, usuarios (admin)
│   └── farmacia.js      Endpoints del módulo Farmacia
├── middleware/          authMiddleware.js (verifyToken)
├── importacion/         Carga de CSV: nominaltrama y maestros
├── paquetes/            Motor PP 0131: calcularPaquetes, resumenAvance, reglas
├── farmacia/            farmaciaService.js (dispensación 99199.05)
├── documentos/          Generación .docx + verificación de codificación
│   ├── docxBuilder.js   Helpers para construir WordprocessingML
│   └── ...
├── reportes/            Reporte HIS (40A y diario) y producción por profesional
├── ajustes/             Auditoría y versionado del catálogo
├── jobs/                diario.js (recálculo programado de paquetes)
└── db/                  schema.sql, migraciones, migrate.js, seeds
```

## Conceptos del dominio (HIS / PP 0131)

- Una **trama** (`nominaltramaYYYYMM.csv`) trae las atenciones de un mes. Cada atención
  es una fila `(id_cita, id_correlativo)` en la tabla `atencion`.
- En una cita, el **correlativo 1** suele ser el diagnóstico **CIE-10** (empieza con letra);
  los siguientes son procedimientos.
- `tipo_diagnostico`: `P` presuntivo, `D` definitivo, `R` repetido.
- `id_condicion_servicio`: `N` nuevo, `C` continuador, `R` reingreso.
- Un **paquete** (`paquete_paciente`) se abre con un diagnóstico disparador y se completa al
  cumplir todos sus componentes dentro del plazo.
- Códigos relevantes: `99199.05` = dispensación de medicamentos · `99366` = código PAI
  (apertura de paquete).

## Endpoints principales

Todas las rutas bajo `/api` requieren token JWT (`Authorization: Bearer <token>`), salvo
`/api/auth/login`. Las de administración exigen rol `admin`.

| Área | Ejemplos |
|------|----------|
| Auth | `POST /api/auth/login`, `GET /api/auth/me` |
| Importación | `POST /api/importar/nominaltrama`, `POST /api/importar/maestros` |
| Base de datos | `GET /api/database/periodos`, `DELETE /api/database/limpiar`, `DELETE /api/database/limpiar-periodo` |
| Paquetes | `GET /api/dashboard`, `GET /api/paquetes`, `GET /api/paquetes/:id` |
| Farmacia | `GET /api/farmacia/resumen`, `GET /api/farmacia/pacientes`, `GET /api/farmacia/pacientes/:id` |
| Documentos | `GET /api/paquetes/:id/documento`, `POST /api/documentos/reporte-atenciones`, `GET /api/documentos/verificacion-codificacion` |
| Reportes | `GET /api/reportes/produccion-profesional`, `GET /api/documentos/reporte-his` |
| Ajustes (admin) | `/api/ajustes/*` |

## Notas

- Las fechas de tipo `DATE` (p. ej. `fecha_atencion`) son fechas de **calendario**: el
  frontend las formatea sin conversión de zona horaria para evitar desfases de un día.
- El cálculo de Farmacia y de la verificación de codificación se hace **al vuelo** (SQL),
  sin materializar tablas adicionales.
