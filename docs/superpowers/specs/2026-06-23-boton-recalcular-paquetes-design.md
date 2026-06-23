# Diseño — Botón "Recalcular paquetes"

**Fecha:** 2026-06-23
**Repos afectados:** `CSMCbackend` (endpoint + lógica), `CSMCfrontend` (UI)

## Problema

Cuando cambia el catálogo de paquetes (por ejemplo, tras aplicar las correcciones del
documento `Paquetes_Salud_Mental_Ministerio.md`), los paquetes ya calculados en
`paquete_paciente` **no** reflejan esos cambios. Hoy la única forma de reflejarlos es
**borrar las atenciones y volver a cargar los CSV mes a mes**, lo cual es tedioso y
propenso a error.

Se necesita un botón que **recalcule los paquetes a partir de las atenciones que ya
están en la base de datos**, sin borrar nada ni recargar archivos.

## Contexto técnico relevante

- `calcularPaquetes()` ([src/paquetes/calcularPaquetes.js](../../../src/paquetes/calcularPaquetes.js))
  es **aditivo**: abre paquetes nuevos y actualiza avance/estados, pero **no elimina**
  paquetes existentes.
- Cada `paquete_paciente` guarda `version_catalogo` y se evalúa con **esa** versión:
  los paquetes ya abiertos **no cambian de regla** aunque se edite el catálogo después.
  Por eso un recálculo aditivo NO basta para reflejar correcciones del catálogo.
- El endpoint `DELETE /api/database/limpiar-periodo`
  ([src/api/server.js](../../../src/api/server.js)) ya resuelve esto reconstruyendo
  `paquete_paciente` desde cero: `TRUNCATE TABLE paquete_paciente CASCADE` seguido de
  `await calcularPaquetes()`.
- La importación de nominaltrama **no** dispara el cálculo; se hace por separado
  (job diario o el borrado por periodo).

## Decisiones (acordadas con el usuario)

1. **Comportamiento:** reconstruir desde cero. `TRUNCATE paquete_paciente CASCADE` +
   `calcularPaquetes()` sobre las atenciones ya cargadas. Reabre **todos** los paquetes
   con el catálogo **actual**, por lo que reflejan las correcciones. Las atenciones,
   el historial de cargas y los maestros **no** se tocan.
   - Implicación aceptada: los paquetes se re-anclan a la versión vigente del catálogo
     (se pierde el anclaje histórico de `version_catalogo`). Es el comportamiento
     deseado, porque el objetivo es justamente aplicar el catálogo nuevo a todo.
2. **Protección:** solo confirmación simple en el frontend (`window.confirm`), sin clave,
   porque la operación no destruye datos fuente y es repetible.
3. **Alcance:** global (todos los periodos). `calcularPaquetes()` recalcula todo el
   universo de atenciones; no hay recálculo por periodo.
4. **Ejecución:** síncrona (con spinner), igual que el resto de operaciones del sistema.

## Diseño

### Backend — `POST /api/database/recalcular`

Nuevo endpoint en [src/api/server.js](../../../src/api/server.js), junto a los demás
endpoints `/api/database`. Lógica:

```
1. const client = await pool.connect()
2. BEGIN
3. TRUNCATE TABLE paquete_paciente CASCADE
4. COMMIT
5. (fuera de la transacción) resultado = await calcularPaquetes()
6. responder JSON
```

- **No** ejecuta `DELETE` sobre `atencion`, `historial_cargas` ni maestros.
- Sin clave; sigue el patrón de los endpoints `/api/database` existentes.
- Manejo de errores:
  - Si el `TRUNCATE` falla → `ROLLBACK` y `500 { ok:false, error }`.
  - Si `calcularPaquetes()` falla → se captura y se reporta en `paquetes_error`
    (mismo patrón que `limpiar-periodo`); el `TRUNCATE` ya se confirmó.
- Respuesta exitosa:

```json
{
  "ok": true,
  "contadores": {
    "paquetesAbiertosEncontrados": 0,
    "nuevosAbiertos": 0,
    "pasaronCompletado": 0,
    "pasaronVencido": 0,
    "errores": 0
  },
  "paquetes_error": null,
  "mensaje": "Paquetes recalculados a partir de las atenciones cargadas."
}
```

`calcularPaquetes()` ya devuelve ese objeto de contadores (lo consume el job diario),
por lo que se reenvía tal cual.

### Frontend

- **[src/services/api.js](../../../../CSMCfrontend-main/src/services/api.js):** nueva
  función `recalcularPaquetes()` → `POST /api/database/recalcular`, siguiendo el estilo
  de las funciones existentes (`limpiarPorPeriodo`, etc.).
- **[src/pages/Importar.jsx](../../../../CSMCfrontend-main/src/pages/Importar.jsx):**
  nuevo componente/sección **"Recalcular paquetes"**, ubicado **antes** de
  "Borrar por periodo". Card de color neutral/azul (no rojo: es operación segura).
  - Descripción: *"Vuelve a calcular todos los paquetes con las atenciones ya cargadas
    y el catálogo actual. Úsalo tras actualizar el catálogo, sin borrar ni recargar
    los CSV."*
  - Botón **"Recalcular paquetes"** (icono `RefreshCw`), con `window.confirm` previo y
    spinner (`Loader2`) mientras corre.
  - Al terminar: muestra contadores (nuevos abiertos, completados, vencidos, errores)
    en un panel de éxito, o el mensaje de error. Si `paquetes_error` viene poblado,
    se muestra como aviso.

## Componentes y responsabilidades

| Unidad | Qué hace | Depende de |
|---|---|---|
| `POST /api/database/recalcular` | Trunca `paquete_paciente` y dispara el recálculo global | `pool`, `calcularPaquetes()` |
| `recalcularPaquetes()` (api.js) | Cliente HTTP del endpoint | `axios` configurado |
| Sección "Recalcular paquetes" (Importar.jsx) | UI: confirmar, ejecutar, mostrar resultado | `recalcularPaquetes()` |

## Testing

- **Backend (BD temporal):** levantar PostgreSQL temporal, correr schema + migraciones +
  seed, cargar atenciones de muestra, ejecutar el endpoint y verificar que
  `paquete_paciente` se reconstruye y refleja el catálogo corregido; las atenciones
  permanecen intactas.
- **Idempotencia:** ejecutar el recálculo dos veces seguidas y confirmar mismo estado.
- **Frontend:** verificación manual del flujo (confirmar → spinner → contadores).

## Fuera de alcance (YAGNI)

- Recálculo por periodo individual.
- Ejecución asíncrona / cola de trabajos / barra de progreso.
- Protección con clave o rol específico (se mantiene el patrón actual de `/api/database`).
