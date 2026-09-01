# SESS-002 — Análisis Profundo de PulsarJS: Contrato vs. Primer Spike y Definición del Huevo Definitivo

| clave               | valor                                                                                                                |
|---------------------|----------------------------------------------------------------------------------------------------------------------|
| **tipo\_documento** | `Session`                                                                                                            |
| **id**              | `SESS-003`                                                                                                           |
| **versión**         | `1.0`                                                                                                                |
| **fecha**           | `2026-08-28`                                                                                                         |
| **estado**          | `cerrada`                                                                                                            |
| **mantenedor**      | `Equipo de desarrollo (NexusJS)`                                                                                     |
| **depende\_de**     | `Nexus_Contract_Specification.md` (v0.2.0), `PulsarJS_Contract_Specification.md` (v0.2.0)                            |
| **habilita**        | `L-003` (Logbook de Implementación de PulsarJS)                                                                      |
| **gobierna**        | `Implementación del núcleo de PulsarJS (pulsar.js)`                                                                  |
| **rag\_tags**       | `sesión, pulsar, estado, reactivo, contrato, especificación, spike, reescritura, browser-first, sin-node, es-module` |

* * *

## 1. Participantes y Contexto[](#1-participantes-y-contexto)

- **Participantes:** Equipo de desarrollo (sesión asíncrona, documentada con el asistente).
- **Contexto:** Tras la revisión arquitectónica completa del ecosistema NexusJS (SESS-001), se procedió a analizar en profundidad el primer spike funcional de PulsarJS. El objetivo era comparar la implementación del spike contra el contrato especificado en `PulsarJS_Contract_Specification.md` y decidir el camino a seguir. La decisión fue clara: **reescribir PulsarJS desde cero siguiendo el contrato al pie de la letra**, con un enfoque 100% browser-first y sin dependencias de Node.js.

* * *

## 2. Problema u Oportunidad Detectada[](#2-problema-u-oportunidad-detectada)

- **Divergencia fundamental en el modelo de estado:** El spike implementaba un **mapa plano de claves** (`store.set('user.name', 'Bob')`), mientras que el contrato especifica un **árbol de objetos** (`store.setState({ user: { name: 'Bob' } })`).
- **API de suscripciones incompleta:** El spike solo ofrecía `subscribe(keys, callback)` sin la distinción entre suscripciones globales (`subscribe`) y suscripciones selectivas (`subscribeSelector`) que exige el contrato.
- **Funcionalidades fuera de lugar:** El spike incluía `computed`, `undo/redo` y `reset` en el núcleo, cuando el contrato las delega a plug-ins o adaptadores.
- **Reentrancy no garantizada:** El spike iteraba directamente sobre los listeners sin hacer snapshot, lo que podía causar problemas si un listener se suscribía o cancelaba durante la notificación.
- **Falta de inmutabilidad:** El spike no ofrecía protección contra mutaciones accidentales del estado (no usaba `Object.freeze`).
- **Dependencia implícita de Node.js:** El spike usaba `export` de ES Modules, pero no se había considerado explícitamente la distribución sin npm ni build steps.

* * *

## 3. Debate y Decisiones[](#3-debate-y-decisiones)

| Decisión                                      | Detalle                                                                                                               | Justificación                                                                                                                  |
|-----------------------------------------------|-----------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------|
| **1. Reescribir PulsarJS desde cero**         | No parchear el spike; implementar una nueva versión que cumpla exactamente con el contrato.                           | El spike demostró viabilidad pero con una arquitectura diferente. Parchearlo sería más difícil que reescribirlo correctamente. |
| **2. Modelo de estado como árbol de objetos** | `getState()` devuelve el árbol completo; `setState(partial)` hace shallow merge a nivel raíz.                         | Es el modelo especificado en el contrato y permite el namespacing (`ui.*`, `form.*`, `entities.*`).                            |
| **3. API de suscripciones dual**              | `subscribe(listener)` para listeners globales; `subscribeSelector(selector, listener)` para suscripciones selectivas. | El contrato exige ambos; `subscribeSelector` es crítico para el rendimiento en el editor de diagramas.                         |
| **4. Selectores flexibles**                   | `subscribeSelector` acepta función o string con ruta (`'ui.selectedNode'`).                                           | El contrato especifica ambos formatos.                                                                                         |
| **5. Reentrancy safety**                      | `_notify()` hace snapshot de los listeners antes de iterar.                                                           | Evita problemas si un listener se suscribe/cancela durante la notificación.                                                    |
| **6. Inmutabilidad opcional**                 | `options.freeze` (default: `true`) congela recursivamente el estado.                                                  | Protege contra mutaciones accidentales; se puede desactivar para hot paths.                                                    |
| **7. Sin funcionalidades fuera de contrato**  | No incluir `computed`, `undo/redo`, `reset` en el núcleo.                                                             | Estas funcionalidades se implementarán como plug-ins o adaptadores.                                                            |
| **8. 100% browser-first, sin Node.js**        | El código usa solo APIs del navegador; sin imports relativos, sin build steps, sin npm.                               | Es el requisito fundamental del ecosistema NexusJS.                                                                            |

* * *

## 4. Resultados del Análisis[](#4-resultados-del-analisis)

### 4.1 Divergencias Encontradas (Contrato vs. Spike)[](#4-1-divergencias-encontradas-contrato-vs-spike)

| Aspecto                   | Contrato                           | Primer Spike                                     | Estado |
|---------------------------|------------------------------------|--------------------------------------------------|--------|
| **Modelo de estado**      | Árbol de objetos                   | Mapa plano de claves                             | ❌      |
| **API principal**         | `getState()` / `setState(partial)` | `get(key)` / `set(key, value)`                   | ❌      |
| **Suscripciones**         | `subscribe` + `subscribeSelector`  | Solo `subscribe(keys, cb)`                       | ❌      |
| **Selectores**            | Función o string con ruta          | Solo strings planos                              | ❌      |
| **Reentrancy**            | Snapshot de listeners              | Iteración directa                                | ❌      |
| **Inmutabilidad**         | `Object.freeze` opcional           | Sin protección                                   | ❌      |
| **Funcionalidades extra** | Delegadas a plug-ins               | `computed`, `undo/redo` en el core               | ❌      |
| **Browser-first**         | ES Module puro, sin Node.js        | ES Module pero sin consideración de distribución | ❌      |

### 4.2 Divergencias Restantes (Contrato vs. Nuevo Código)[](#4-2-divergencias-restantes-contrato-vs-nuevo-codigo)

| Aspecto                            | Contrato                 | Nuevo Código            | Estado |
|------------------------------------|--------------------------|-------------------------|--------|
| **Bracket notation en selectores** | Soporta `items[0].label` | Solo notación de puntos | ❌      |
| **Todo lo demás**                  | Cumple especificación    | Cumple                  | ✅      |

* * *

## 5. El Huevo Definitivo: `src/pulsar.js`[](#5-el-huevo-definitivo-src-pulsar-js)

Se implementó la nueva versión de `pulsar.js` que cumple con el contrato. Las características clave:

- **Clase `Pulsar`** con `getState()`, `setState(partial)`, `subscribe(listener, options)`, `subscribeSelector(selector, listener, options)`.
- **Factory function** `createStatePulsar(initialState, options)`.
- **Export default** de la clase `Pulsar`.
- **Sin dependencias externas**, sin Node.js, ES Module puro.
- **Reentrancy safety** mediante snapshots en `_notify()`.
- **Inmutabilidad opcional** con `options.freeze` (default: `true`).
- **Manejo de errores** robusto: errores capturados y logueados sin romper otros listeners.
- **Validación de argumentos** con `TypeError` para objetos no planos.

**Pendiente:** Implementar soporte para **bracket notation** (`items[0].label`) en selectores de string.

* * *

## 6. Archivos Creados o Modificados[](#6-archivos-creados-o-modificados)

| Archivo                  | Acción           | Motivo                                                                    |
|--------------------------|------------------|---------------------------------------------------------------------------|
| `src/pulsar.js`          | Creado           | Implementación definitiva de PulsarJS según el contrato.                  |
| `index.html`             | Creado (ejemplo) | Ejemplo de uso de PulsarJS en el navegador sin Node.js.                   |
| `tests/pulsar.test.html` | Creado (ejemplo) | Test harness en el navegador para verificar el cumplimiento del contrato. |

* * *

## 7. Próximos Pasos (Derivados de la Sesión)[](#7-proximos-pasos-derivados-de-la-sesion)

- **Implementar bracket notation** en `_createPathSelector` para soportar `items[0].label`.
- **Crear tests unitarios** en el navegador para verificar:
  
  - `setState` con shallow merge.
  - `subscribeSelector` con selectores de función y string.
  - Reentrancy safety (suscripción durante notificación).
  - `Object.freeze` y prevención de mutaciones.
  - Comparación de igualdad personalizada.
- **Integrar PulsarJS con el editor de diagramas** para validar el rendimiento con drag operations.
- **Actualizar el Logbook L-002** con los resultados de la implementación.

* * *

## 8. Referencias[](#8-referencias)

- **Contrato Nexus:** `Nexus_Contract_Specification.md` (v0.2.0).
- **Contrato PulsarJS:** `PulsarJS_Contract_Specification.md` (v0.2.0).
- **Sesión anterior:** `SESS-001_Reestructuracion_Optimizacion_Imports.md`.
- **Código fuente:** `src/pulsar.js` (nuevo).

* * *

## Historial de Cambios[](#historial-de-cambios)

| Versión | Fecha      | Cambio                       | Autor                |
|---------|------------|------------------------------|----------------------|
| 1.0     | 2026-08-28 | Versión inicial de la sesión | Equipo de desarrollo |