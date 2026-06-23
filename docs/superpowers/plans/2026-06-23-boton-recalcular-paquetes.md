# Botón "Recalcular paquetes" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir un botón en la página de Importación que reconstruye todos los paquetes (`paquete_paciente`) a partir de las atenciones ya cargadas y el catálogo actual, sin borrar atenciones ni recargar CSV.

**Architecture:** Endpoint `POST /api/database/recalcular` en el backend Express que hace `TRUNCATE paquete_paciente CASCADE` + `calcularPaquetes()` (mismo patrón ya probado en `limpiar-periodo`). El frontend React añade una función de cliente y una sección/botón en `Importar.jsx` con confirmación y feedback de contadores.

**Tech Stack:** Node.js + Express 5 (CommonJS), PostgreSQL (`pg`), React 19 + Vite, axios, lucide-react, Tailwind.

> **Nota de entorno:** en este proyecto los commits se realizan solo con aprobación del usuario. Los pasos `git commit` quedan documentados, pero al ejecutar pídele confirmación antes de commitear (y crea rama si estás en `main`).

> **Nota de testing:** el repo no usa framework de tests; sigue su patrón de *scripts node ad-hoc* (`check*.js`, `test_recalc.js` en la raíz del backend). El test de este plan es un script de integración que se ejecuta contra el servidor en desarrollo apuntando a una BD con datos.

---

## File Structure

**Backend (`CSMCbackend-main`):**
- Modify: `src/api/server.js` — añadir el endpoint `POST /api/database/recalcular` junto a los demás endpoints `/api/database` (después de `limpiar-periodo`, ~línea 494).
- Create: `scripts/test_recalcular.js` — script de integración HTTP del endpoint.

**Frontend (`CSMCfrontend-main`):**
- Modify: `src/services/api.js` — añadir `recalcularPaquetes()` en la sección "Importación de datos" (~línea 137, tras `limpiarPorPeriodo`).
- Modify: `src/pages/Importar.jsx` — añadir el componente `RecalcularPaquetes` y montarlo antes de `<BorrarPorPeriodo />`.

---

## Task 1: Backend — endpoint `POST /api/database/recalcular`

**Files:**
- Modify: `CSMCbackend-main/src/api/server.js` (insertar tras el endpoint `limpiar-periodo`, ~línea 494)
- Create: `CSMCbackend-main/scripts/test_recalcular.js`

- [ ] **Step 1: Escribir el test de integración (falla primero)**

Crear `CSMCbackend-main/scripts/test_recalcular.js`:

```js
/**
 * test_recalcular.js — Prueba de integración del endpoint POST /api/database/recalcular
 *
 * Requisitos: el servidor debe estar corriendo (npm start) apuntando a una BD con
 * atenciones cargadas. Ajusta BASE con la URL del servidor si no es la de por defecto.
 *
 * Uso:
 *   node scripts/test_recalcular.js
 */
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

async function main() {
  // 1. Contar atenciones ANTES (vía periodos) para verificar que NO se borran.
  const periodosAntes = await (await fetch(`${BASE}/api/database/periodos`)).json();
  const totalAntes = (Array.isArray(periodosAntes) ? periodosAntes : [])
    .reduce((acc, p) => acc + (p.atenciones || 0), 0);
  console.log(`Atenciones antes: ${totalAntes}`);

  // 2. Llamar al endpoint de recálculo.
  const resp = await fetch(`${BASE}/api/database/recalcular`, { method: 'POST' });
  const data = await resp.json();
  console.log('Respuesta:', JSON.stringify(data, null, 2));

  // 3. Aserciones.
  const errores = [];
  if (resp.status !== 200) errores.push(`status esperado 200, recibido ${resp.status}`);
  if (data.ok !== true) errores.push(`ok esperado true, recibido ${data.ok}`);
  if (!data.contadores || typeof data.contadores.nuevosAbiertos !== 'number')
    errores.push('contadores ausentes o con forma inesperada');

  // 4. Atenciones DESPUÉS deben ser iguales (no se borró nada).
  const periodosDespues = await (await fetch(`${BASE}/api/database/periodos`)).json();
  const totalDespues = (Array.isArray(periodosDespues) ? periodosDespues : [])
    .reduce((acc, p) => acc + (p.atenciones || 0), 0);
  console.log(`Atenciones después: ${totalDespues}`);
  if (totalDespues !== totalAntes)
    errores.push(`atenciones cambiaron: antes ${totalAntes}, después ${totalDespues}`);

  if (errores.length) {
    console.error('\n✖ FALLÓ:\n  - ' + errores.join('\n  - '));
    process.exit(1);
  }
  console.log('\n✔ OK: recálculo correcto y atenciones intactas.');
}

main().catch((err) => { console.error('✖ Error:', err.message); process.exit(1); });
```

- [ ] **Step 2: Levantar el servidor y correr el test para verificar que falla**

En una terminal: `cd CSMCbackend-main && npm start` (con `.env` apuntando a una BD con datos cargados).
En otra terminal:

Run: `cd CSMCbackend-main && node scripts/test_recalcular.js`
Expected: FALLA — el endpoint `POST /api/database/recalcular` aún no existe (status 404 / `data.ok` undefined).

- [ ] **Step 3: Implementar el endpoint**

En `CSMCbackend-main/src/api/server.js`, justo después del cierre del endpoint `app.delete('/api/database/limpiar-periodo', ...)` (~línea 494), insertar:

```js
// ═════════════════════════════════════════════════════════════════════════════
// ENDPOINT 10E — Recalcular paquetes (sin borrar atenciones)
// ═════════════════════════════════════════════════════════════════════════════
// Reconstruye `paquete_paciente` desde cero a partir de las atenciones ya cargadas
// y el catálogo ACTUAL. Útil tras actualizar el catálogo: aplica los cambios sin
// tener que borrar atenciones ni volver a subir los CSV. No toca `atencion`,
// `historial_cargas` ni los maestros.
app.post('/api/database/recalcular', async (req, res) => {
  const client = await pool.connect();
  try {
    // 1. Vaciar los paquetes derivados (calcularPaquetes es aditivo: sin este
    //    TRUNCATE quedarían paquetes con la versión vieja del catálogo).
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE paquete_paciente CASCADE');
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* noop */ }
    client.release();
    console.error('Error /api/database/recalcular (truncate):', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
  client.release();

  // 2. Reconstruir paquetes con las atenciones restantes (fuera de la transacción;
  //    calcularPaquetes gestiona sus propias transacciones).
  let contadores = null;
  let paquetesError = null;
  try {
    contadores = await calcularPaquetes();
  } catch (err) {
    paquetesError = err.message;
    console.error('⚠ Recálculo de paquetes falló:', err.message);
  }

  res.json({
    ok: paquetesError === null,
    contadores,
    paquetes_error: paquetesError,
    mensaje: paquetesError
      ? `El recálculo falló: ${paquetesError}`
      : 'Paquetes recalculados a partir de las atenciones cargadas.',
  });
});
```

(`calcularPaquetes` y `pool` ya están importados/definidos en `server.js` — líneas 25 y la creación del pool.)

- [ ] **Step 4: Reiniciar el servidor y correr el test para verificar que pasa**

Reinicia `npm start`.
Run: `cd CSMCbackend-main && node scripts/test_recalcular.js`
Expected: PASA — imprime contadores, `ok: true`, y "atenciones intactas".

- [ ] **Step 5: Commit** (pedir aprobación antes; crear rama si estás en `main`)

```bash
cd CSMCbackend-main
git add src/api/server.js scripts/test_recalcular.js
git commit -m "feat(api): endpoint POST /api/database/recalcular para reconstruir paquetes"
```

---

## Task 2: Frontend — cliente `recalcularPaquetes()`

**Files:**
- Modify: `CSMCfrontend-main/src/services/api.js` (sección "Importación de datos", tras `limpiarPorPeriodo`, ~línea 137)

- [ ] **Step 1: Añadir la función de cliente**

En `CSMCfrontend-main/src/services/api.js`, justo después de la definición de `limpiarPorPeriodo` (~línea 137), añadir:

```js
/** Recalcula todos los paquetes con las atenciones ya cargadas (reconstruye desde cero) */
export const recalcularPaquetes = () =>
  api.post('/database/recalcular').then((r) => r.data);
```

- [ ] **Step 2: Verificar que el frontend compila / lint pasa**

Run: `cd CSMCfrontend-main && npm run lint`
Expected: sin errores nuevos relacionados con `api.js`.

- [ ] **Step 3: Commit** (pedir aprobación antes; crear rama si estás en `main`)

```bash
cd CSMCfrontend-main
git add src/services/api.js
git commit -m "feat(api): cliente recalcularPaquetes()"
```

---

## Task 3: Frontend — sección "Recalcular paquetes" en Importar.jsx

**Files:**
- Modify: `CSMCfrontend-main/src/pages/Importar.jsx`

- [ ] **Step 1: Importar la función de cliente**

En `CSMCfrontend-main/src/pages/Importar.jsx`, en el bloque de imports de `../services/api` (líneas 2-8), añadir `recalcularPaquetes` a la lista:

```jsx
import {
  importarNominaltrama,
  importarMaestros,
  limpiarBaseDeDatos,
  obtenerPeriodosDatos,
  limpiarPorPeriodo,
  recalcularPaquetes,
} from '../services/api';
```

- [ ] **Step 2: Añadir el componente `RecalcularPaquetes`**

En `CSMCfrontend-main/src/pages/Importar.jsx`, justo antes de la línea `export default function Importar() {` (~línea 373), añadir el componente:

```jsx
/**
 * Recalcula todos los paquetes a partir de las atenciones ya cargadas y el
 * catálogo actual. No borra atenciones ni requiere recargar CSV. Operación segura
 * y repetible: solo pide confirmación.
 */
function RecalcularPaquetes() {
  const [recalculando, setRecalculando] = useState(false);
  const [resultado, setResultado] = useState(null); // contadores
  const [mensaje, setMensaje] = useState(null);      // { tipo, texto }

  const handleRecalcular = async () => {
    if (!window.confirm(
      '¿Recalcular todos los paquetes con las atenciones ya cargadas?\n\n' +
      'Reconstruye los paquetes aplicando el catálogo actual. No borra atenciones ' +
      'ni necesitas volver a subir los CSV. Puede tardar unos minutos.'
    )) return;

    setRecalculando(true);
    setMensaje(null);
    setResultado(null);
    try {
      const resp = await recalcularPaquetes();
      setResultado(resp.contadores ?? null);
      if (resp.paquetes_error) {
        setMensaje({ tipo: 'error', texto: `Aviso: el recálculo falló: ${resp.paquetes_error}` });
      } else {
        setMensaje({ tipo: 'exito', texto: resp.mensaje || 'Paquetes recalculados correctamente.' });
      }
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.response?.data?.error ?? err.message ?? 'Error al recalcular' });
    } finally {
      setRecalculando(false);
    }
  };

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-6 shadow-sm">
      <h3 className="flex items-center gap-2 text-base font-bold text-blue-800">
        <RefreshCw size={20} />
        Recalcular paquetes
      </h3>
      <p className="mb-4 mt-1 text-sm text-blue-700">
        Vuelve a calcular todos los paquetes con las atenciones ya cargadas y el catálogo
        actual. Úsalo tras actualizar el catálogo, sin borrar ni recargar los CSV.
      </p>

      <button
        type="button"
        onClick={handleRecalcular}
        disabled={recalculando}
        className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {recalculando ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
        {recalculando ? 'Recalculando…' : 'Recalcular paquetes'}
      </button>

      {resultado && (
        <ul className="mt-4 space-y-1 rounded-lg bg-white p-4 text-sm text-blue-900 ring-1 ring-blue-100">
          <li>Paquetes abiertos revisados: {resultado.paquetesAbiertosEncontrados}</li>
          <li>Nuevos paquetes abiertos: {resultado.nuevosAbiertos}</li>
          <li>Pasaron a completado: {resultado.pasaronCompletado}</li>
          <li>Pasaron a vencido: {resultado.pasaronVencido}</li>
          <li>Errores individuales: {resultado.errores}</li>
        </ul>
      )}

      {mensaje && (
        <div className={`mt-3 text-sm font-medium ${mensaje.tipo === 'exito' ? 'text-green-700' : 'text-red-700'}`}>
          {mensaje.texto}
        </div>
      )}
    </div>
  );
}
```

(`useState`, `RefreshCw` y `Loader2` ya están importados en el archivo — líneas 1 y 10-12.)

- [ ] **Step 3: Montar el componente en la página**

En `CSMCfrontend-main/src/pages/Importar.jsx`, dentro del `return` de `Importar`, justo antes de `{/* Borrado selectivo por periodo (mes) */}` y `<BorrarPorPeriodo />` (~línea 417), añadir:

```jsx
      {/* Recalcular paquetes (sin borrar atenciones) */}
      <RecalcularPaquetes />

```

- [ ] **Step 4: Verificar lint**

Run: `cd CSMCfrontend-main && npm run lint`
Expected: sin errores nuevos en `Importar.jsx`.

- [ ] **Step 5: Commit** (pedir aprobación antes; crear rama si estás en `main`)

```bash
cd CSMCfrontend-main
git add src/pages/Importar.jsx
git commit -m "feat(importar): sección y botón Recalcular paquetes"
```

---

## Task 4: Verificación end-to-end manual

**Files:** ninguno (verificación)

- [ ] **Step 1: Levantar backend y frontend**

Backend: `cd CSMCbackend-main && npm start` (con `.env` y BD con atenciones).
Frontend: `cd CSMCfrontend-main && npm run dev`.

- [ ] **Step 2: Probar el flujo en el navegador**

1. Ir a la página **Importar datos**.
2. Confirmar que aparece la sección azul **"Recalcular paquetes"** antes de "Borrar por periodo".
3. Pulsar **Recalcular paquetes** → aceptar el diálogo de confirmación.
4. Verificar: aparece el spinner, y al terminar se muestran los contadores y el mensaje de éxito.
5. Comprobar en el Dashboard/Paquetes que los paquetes reflejan el catálogo actual.

Expected: el recálculo termina con éxito; las atenciones siguen cargadas (la sección "Borrar por periodo" muestra los mismos periodos/conteos que antes).

- [ ] **Step 3: (Opcional) Confirmar idempotencia**

Pulsar **Recalcular paquetes** una segunda vez; debe terminar igual, sin errores.

---

## Self-review check

- Spec → tareas: endpoint (T1), cliente api (T2), UI en Importar.jsx (T3), testing (T1 script + T4 manual). Cubre todas las secciones del spec.
- Sin clave (solo confirmación) ✓; no borra atenciones/historial/maestros ✓; respuesta con contadores ✓ (forma idéntica a la que devuelve `calcularPaquetes`).
- Nombres consistentes: `recalcularPaquetes` (api), `RecalcularPaquetes` (componente), `POST /api/database/recalcular` (endpoint) en todas las tareas.
