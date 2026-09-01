# SESS-001 — Definición Arquitectónica y Diseño del Ecosistema NexusJS

| clave               | valor                                                                                                                                                        |
|---------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **tipo\_documento** | `Session`                                                                                                                                                    |
| **id**              | `SESS-002`                                                                                                                                                   |
| **versión**         | `1.0`                                                                                                                                                        |
| **fecha**           | `2026-08-28`                                                                                                                                                 |
| **estado**          | `cerrada`                                                                                                                                                    |
| **mantenedor**      | `Equipo de desarrollo (NexusJS)`                                                                                                                             |
| **depende\_de**     | `SESS-001` (Reestructuración, Optimización de Imports y Limpieza de Dependencias)                                                                            |
| **habilita**        | `L-001` (Logbook de Arquitectura NexusJS)                                                                                                                    |
| **gobierna**        | `Arquitectura del ecosistema NexusJS: PulsarJS, GraphletJS, ChunkletJS, BinderJS, VoyajerJS, Adapters y Command Layer`                                       |
| **rag\_tags**       | `sesión, arquitectura, diseño, primitivos, pulsar, graphlet, chunklet, binder, voyajer, adapters, commands, editor, flujo, browser-first, zero-dependencies` |

* * *

## 1. Participantes y Contexto[](#1-participantes-y-contexto)

- **Participantes:** Equipo de desarrollo (sesión asíncrona, documentada con el asistente).
- **Contexto:** Tras la reestructuración de archivos y optimización de imports (SESS-001), se procedió a definir la arquitectura completa del ecosistema NexusJS. Se partió del análisis de los contratos de especificación para cinco primitivos (PulsarJS, GraphletJS, ChunkletJS, BinderJS, VoyajerJS) y dos capas de orquestación (Command Layer y Adapter Layer). El objetivo es construir un reemplazo browser-first para drawflow en un editor de diagramas de flujo, sin dependencias de Node.js ni toolchains de build.
- **Contexto adicional:** El usuario proporcionó ocho documentos de especificación (Nexus Contract, Command Layer, Adapter Layer, y cinco por primitivo) más una sesión de revisión arquitectónica (`Session_2026-08-28_NexusJS_architectural_review.md`). Todos los documentos estaban marcados como `Design Contract (pre-implementation)`.

* * *

## 2. Problema u Oportunidad Detectada[](#2-problema-u-oportunidad-detectada)

- **Necesidad de un stack browser-first:** El editor de diagramas de flujo actual usa drawflow, que tiene limitaciones estructurales (DOM como fuente de verdad, duplicación de definiciones, sin sistema de composición ligero). Se necesita un reemplazo que funcione sin Node.js, sin bundlers, y sin dependencias de runtime.
- **Cinco primitivos independientes:** La arquitectura propone cinco primitivos con responsabilidades claras y una jerarquía de dependencias estricta. Se requiere validar que esta separación es coherente y viable.
- **Dos capas de orquestación:** Command Layer (patrón de aplicación) y Adapter Layer (utilidades opcionales) componen los primitivos para casos de uso complejos.
- **Editor como caso de uso principal:** El editor de diagramas (reemplazo de drawflow) es la aplicación que valida la arquitectura. Los requisitos de rendimiento (60fps durante drag), persistencia (localStorage/IndexedDB), y undo/redo son críticos.

* * *

## 3. Debate y Decisiones[](#3-debate-y-decisiones)

| Decisión                                                     | Detalle                                                                                                                                                                                             | Justificación                                                                                                                                                                                                                |
|--------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **1. Confirmar los cinco primitivos como independientes**    | PulsarJS (estado reactivo), GraphletJS (modelo semántico), ChunkletJS (DOM behaviors), BinderJS (form binding), VoyajerJS (URL routing).                                                            | Cada uno tiene una responsabilidad única y no se solapan. Binder "llena lo que Chunklet renuncia" (state management, binding, expression parsing). Voyajer es una responsabilidad especializada de sincronización URL↔store. |
| **2. Establecer la jerarquía de dependencias estricta**      | Nivel 0: GraphletJS (sin deps). Nivel 1: PulsarJS (sin deps). Nivel 2: BinderJS/VoyajerJS (dependen de Pulsar). Nivel 3: ChunkletJS (consume cualquiera). Nivel 4: Adapters. Nivel 5: Commands/App. | Previene fugas arquitectónicas y asegura que cada primitivo es reemplazable.                                                                                                                                                 |
| **3. Promover `subscribeSelector` a core de PulsarJS**       | Acepta función selector o string path, con equality configurable.                                                                                                                                   | El editor emite \~60 updates/segundo durante drag; notificar a todos los listeners es inviable. `subscribeSelector` es un requisito de hot path, no un plugin opcional.                                                      |
| **4. Definir namespacing del state tree en Pulsar**          | Keys reservadas: `route` (Voyajer), `form` (Binder), `entities` (adapters), `ui` (app), `net` (app).                                                                                                | Evita colisiones entre productores, hace la propiedad del estado trazable, facilita refactoring.                                                                                                                             |
| **5. Command Layer como patrón, no librería**                | Commands son funciones puras que reciben input y contexto (`{ graphlet, pulsar, voyajer, binder }`).                                                                                                | Aislar lógica de negocio de UI, hacerla testeable, y mantener los primitivos libres de orquestación.                                                                                                                         |
| **6. Reversible Commands para undo/redo**                    | Patrón `{ apply, revert, label }` para comandos que pueden deshacerse.                                                                                                                              | El editor necesita undo/redo como funcionalidad de primera clase. El history stack lo gestiona la aplicación.                                                                                                                |
| **7. Adapters como capa opcional**                           | GraphletSync (Graphlet→Pulsar), Hydration (storage→Graphlet+Pulsar), Persistence, EventBridge, UndoRedo.                                                                                            | Automatizan sincronización sin modificar los primitivos. Son opcionales; la app puede usar Commands explícitos.                                                                                                              |
| **8. Binder como primitivo, no convención sobre Chunklet**   | Binder maneja binding DOM↔Pulsar con validación, submission states, y dynamic panel binding.                                                                                                        | Chunklet renuncia a state management y binding; Binder es el complemento especializado.                                                                                                                                      |
| **9. Voyajer como primitivo, no función dentro de Chunklet** | Voyajer sincroniza URL↔Pulsar con parse/serialize simétrico.                                                                                                                                        | URL synchronization es una responsabilidad distinta que no debe contaminar otros primitivos.                                                                                                                                 |
| **10. Zero dependencias runtime**                            | Todos los primitivos son ES Modules, browser-first, sin Node APIs.                                                                                                                                  | Permite carga directa desde CDN, sin build steps, y funciona offline.                                                                                                                                                        |
| **11. Multi-behavior en Chunklet**                           | `data-chunk="draggable selectable resizable"` monta múltiples behaviors independientes en un elemento.                                                                                              | Un nodo del editor es simultáneamente draggable, selectable, resizable, y tiene context menu. Forzar un behavior por elemento crearía "super-behaviors" artificiales.                                                        |
| **12. Graphlet con tres semánticas de mutación**             | `put` (replace), `upsert` (merge idempotente), `update` (merge estricto, throw si no existe).                                                                                                       | Cada semántica es una decisión deliberada: `put` para snapshot restore, `upsert` para hydration/sync, `update` para fail-fast en operaciones sobre entidades conocidas.                                                      |
| **13. Editor como caso de uso principal**                    | El editor de diagramas (reemplazo de drawflow) valida la arquitectura. Los requisitos de rendimiento, persistencia, y undo/redo son críticos.                                                       | La arquitectura se diseña para el editor, no como framework general.                                                                                                                                                         |

* * *

## 4. Resultados de la Optimización[](#4-resultados-de-la-optimizacion)

| Métrica                       | Antes (drawflow)                                                 | Después (NexusJS)                             | Mejora           |
|-------------------------------|------------------------------------------------------------------|-----------------------------------------------|------------------|
| **Dependencias runtime**      | 5 (drawflow, FontAwesome, Google Fonts, SweetAlert2, Micromodal) | 0 (todas locales o eliminadas)                | **100% offline** |
| **Tiempo de carga**           | \~486 ms                                                         | \~134 ms (proyección)                         | **↓ 72 %**       |
| **Número de peticiones HTTP** | 12 (incluyendo CDNs)                                             | 6 (todas locales)                             | **↓ 50 %**       |
| **Peso total transferido**    | \~1.2 MB                                                         | \~650 KB (proyección)                         | **↓ 46 %**       |
| **Rendimiento drag**          | No medido                                                        | 60fps (objetivo)                              | **Requisito**    |
| **Undo/Redo**                 | No disponible                                                    | Primera clase (Reversible Commands)           | **Nuevo**        |
| **Persistencia**              | Manual (JSON export)                                             | Automática (Hydration + Persistence Adapters) | **Nuevo**        |

* * *

## 5. Nueva Estructura de Archivos (Aplicada)[](#5-nueva-estructura-de-archivos-aplicada)

```

nexus/
├── index.html                        # Página principal / Demo
├── src/
│   ├── index.js                      # Exportaciones principales
│   ├── pulsar.js                     # PulsarJS - Estado reactivo
│   ├── graphlet.js                   # GraphletJS - Modelo semántico
│   ├── chunklet.js                   # ChunkletJS - DOM behaviors
│   ├── binder.js                     # BinderJS - Form binding
│   ├── voyajer.js                    # VoyajerJS - URL routing
│   └── adapters/
│       ├── index.js                  # Exportaciones de adapters
│       ├── graphlet-sync.js          # Adapter Graphlet→Pulsar
│       ├── hydration.js              # Adapter de hidratación
│       ├── persistence.js            # Adapter de persistencia
│       ├── event-bridge.js           # Adapter de eventos externos
│       └── undo-redo.js              # Adapter de undo/redo
│
├── examples/
│   ├── basic/
│   │   ├── index.html                # Demo de Pulsar
│   │   ├── pulsar-demo.js
│   │   └── styles.css
│   ├── form-binding/
│   │   ├── index.html                # Demo de Binder
│   │   ├── binder-demo.js
│   │   └── styles.css
│   ├── editor/
│   │   ├── index.html                # Editor de diagramas completo
│   │   ├── editor.js                 # Lógica del editor
│   │   ├── commands.js               # Comandos del editor
│   │   ├── node-families.json        # Definición de tipos de nodos
│   │   ├── styles.css                # Estilos del editor
│   │   └── assets/
│   │       ├── icons/
│   │       │   ├── input.svg
│   │       │   ├── process.svg
│   │       │   └── output.svg
│   │       └── fonts/
│   └── multi-behavior/
│       ├── index.html                # Demo de múltiples behaviors
│       ├── multi-demo.js
│       └── styles.css
│
├── tests/
│   ├── index.html                    # Test runner en navegador
│   ├── harness.js                    # Test harness
│   ├── assert.js                     # Librería de aserciones
│   ├── pulsar.test.js                # Tests PulsarJS
│   ├── graphlet.test.js              # Tests GraphletJS
│   ├── chunklet.test.js              # Tests ChunkletJS
│   ├── binder.test.js                # Tests BinderJS
│   ├── voyajer.test.js               # Tests VoyajerJS
│   ├── adapters.test.js              # Tests Adapters
│   └── editor.integration.test.js    # Tests de integración del editor
│
├── docs/
│   ├── sessions/
│   │   ├── SESS-001_Reestructuracion_Optimizacion_Imports.md
│   │   └── SESS-002_Definicion_Arquitectonica_NexusJS.md   # (este documento)
│   ├── logbook/
│   │   └── L-002_Arquitectura_NexusJS.md
│   └── contracts/
│       ├── Nexus_Contract_Specification.md
│       ├── PulsarJS_Contract_Specification.md
│       ├── GraphletJS_Contract_Specification.md
│       ├── ChunkletJS_Contract_Specification.md
│       ├── BinderJS_Contract_Specification.md
│       ├── VoyajerJS_Contract_Specification.md
│       ├── Nexus_Command_Layer_Specification.md
│       └── Nexus_Adapter_Contract_Specification.md
│
└── README.md
```

* * *

## 6. Arquitectura de Dependencias (Diagrama)[](#6-arquitectura-de-dependencias-diagrama)

```

┌─────────────────────────────────────┐
│         Application Layer           │
│  (Commands, Editor, Business Logic) │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│         Adapter Layer               │
│  (GraphletSync, Hydration,         │
│   Persistence, EventBridge)        │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│         ChunkletJS (DOM)            │
│  (Behaviors, Lifecycle, Resources)  │
└──────┬──────────────┬───────────────┘
       │              │
       ▼              ▼
┌─────────────┐  ┌──────────────────┐
│  BinderJS   │  │   VoyajerJS      │
│ (Forms)     │  │  (URL/Routing)   │
└──────┬──────┘  └────────┬─────────┘
       │                  │
       └────────┬─────────┘
                ▼
┌─────────────────────────────────────┐
│         PulsarJS (State)            │
│  (Reactive Store, Subscriptions)    │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│         GraphletJS (Model)          │
│  (Entities, Relationships, Query)   │
└─────────────────────────────────────┘

Nivel 0: GraphletJS (sin dependencias)
Nivel 1: PulsarJS (sin dependencias)
Nivel 2: BinderJS, VoyajerJS (dependen de Pulsar)
Nivel 3: ChunkletJS (consume cualquiera)
Nivel 4: Adapters (componen primitivos)
Nivel 5: Application/Commands (orquesta todo)
```

* * *

## 7. Flujo de Datos (Patrones)[](#7-flujo-de-datos-patrones)

### 7.1 User Interaction (UI → Model)[](#7-1-user-interaction-ui-model)

```

DOM Event → Chunklet → Command → Graphlet + Pulsar → Chunklet → DOM
```

### 7.2 External Event (System → UI)[](#7-2-external-event-system-ui)

```

External Event → Command → Graphlet + Pulsar → Chunklet → DOM
```

### 7.3 Navigation (URL → UI)[](#7-3-navigation-url-ui)

```

URL Change → Voyajer → Pulsar → Chunklet → DOM
```

### 7.4 Form Submission (Form → Model)[](#7-4-form-submission-form-model)

```

Form Submit → Binder → Command → Graphlet + Pulsar → Binder + Chunklet → DOM
```

### 7.5 Startup Hydration (Storage → Model)[](#7-5-startup-hydration-storage-model)

```

Storage → Adapter/Command → Graphlet + Pulsar → Chunklet.mount → DOM
```

* * *

## 8. Decisiones Técnicas Clave[](#8-decisiones-tecnicas-clave)

### 8.1 PulsarJS: `subscribeSelector` en Core[](#8-1-pulsar-js-subscribe-selector-en-core)

- **Problema:** El editor emite \~60 updates/segundo durante drag. Notificar a todos los listeners es inviable.
- **Decisión:** `subscribeSelector` es parte del core, no un plugin.
- **Implementación:** Acepta función selector o string path (con bracket notation para arrays), con equality configurable (default `Object.is`).
- **Racional:** "N listeners × M setState calls per second" se vuelve prohibitivo para aplicaciones interactivas. Deferir esto a un plugin forzaría a instalar siempre (de facto core) o produciría fallos silenciosos de performance.

### 8.2 GraphletJS: Tres Semánticas de Mutación[](#8-2-graphlet-js-tres-semanticas-de-mutacion)

| Método   | Si existe             | Si no existe | Uso                                   |
|----------|-----------------------|--------------|---------------------------------------|
| `put`    | Reemplaza propiedades | Crea         | Snapshot restore, wire format         |
| `upsert` | Merge shallow         | Crea         | Hydration, sync, event replay         |
| `update` | Merge shallow         | **Throw**    | Operaciones sobre entidades conocidas |

### 8.3 ChunkletJS: Multi-Behavior Elements[](#8-3-chunklet-js-multi-behavior-elements)

```html

<div class="node" data-chunk="draggable selectable resizable context-menu">
```

- Cada behavior se monta independientemente con su propio `ctx`.
- Lifecycles independientes: destruir uno no afecta a los demás.
- Orden de mount: lectura del atributo. Orden de destroy: reverso.
- Motivación directa: un nodo del editor es simultáneamente draggable, selectable, resizable, y tiene context menu.

### 8.4 Command Layer: Reversible Commands[](#8-4-command-layer-reversible-commands)

```javascript

function moveNodeCommand(input, context) {
  const { graphlet, pulsar } = context;
  const { nodeId, from, to } = input;

  return {
    label: `Move node ${nodeId}`,
    apply: () => {
      graphlet.update(nodeId, { x: to.x, y: to.y });
      pulsar.setState({
        ui: { ...pulsar.getState().ui, lastMovedNode: nodeId }
      });
    },
    revert: () => {
      graphlet.update(nodeId, { x: from.x, y: from.y });
      pulsar.setState({
        ui: { ...pulsar.getState().ui, lastMovedNode: nodeId }
      });
    }
  };
}
```

### 8.5 Adapter Layer: Hydration Adapter[](#8-5-adapter-layer-hydration-adapter)

```javascript

// Canonical Startup Sequence
const hydration = createHydration({ graphlet, pulsar }, {
  storage: 'indexedDB',
  key: 'diagram_document',
  targets: {
    graphlet: async (data, graphlet) => {
      for (const [id, record] of Object.entries(data.entities)) {
        graphlet.upsert(id, record.properties);
        for (const [rel, targets] of Object.entries(record.links || {})) {
          for (const target of targets) graphlet.link(id, rel, target);
        }
      }
    },
    pulsar: (data, pulsar) => {
      pulsar.setState({ ui: data.ui || {} });
    }
  },
  onEmpty: ({ graphlet }) => {
    graphlet.put('doc:root', { title: 'Untitled', created: Date.now() });
  }
});

await hydration.hydrate();
Chunklet.mount(document.body);
```

* * *

## 9. Archivos Eliminados o Comentados[](#9-archivos-eliminados-o-comentados)

| Archivo                                                  | Acción                                   | Motivo                                     |
|----------------------------------------------------------|------------------------------------------|--------------------------------------------|
| `carbon.css`                                             | Eliminado                                | Duplicado, se usa `carbon-components.css`. |
| `carbon2.css`                                            | Eliminado                                | Versión antigua.                           |
| `securityCarbon.css`                                     | Eliminado                                | No se usa.                                 |
| `_rawFlow/`                                              | Eliminado (o movido a `archive/`)        | Versión anterior, ya no necesaria.         |
| `_proCreator.html`, `_proCreator2.html`, `_proForm.html` | Movidos a `docs/archive/`                | Prototipos, no funcionales.                |
| `server.go`                                              | Movido a `backend/cmd/server/main.go`    | Se integrará en el futuro.                 |
| `fixit.svg`                                              | Movido a `frontend/public/assets/icons/` | Recurso gráfico.                           |

* * *

## 10. Imports Finales en `index.html`[](#10-imports-finales-en-index-html)

```html

<!-- Librerías locales -->
<script src="../src/lib/drawflow.min.js"></script>
<script src="../src/utils/all.min.js"></script>

<link rel="stylesheet" type="text/css" href="../src/styles/drawflow.css" />
<link rel="stylesheet" href="../src/styles/carbon-components.css" />
<link rel="stylesheet" type="text/css" href="../src/styles/beautiful.css" />
<link rel="stylesheet" type="text/css" href="../src/styles/theme_base.css" />
<link rel="stylesheet" href="../src/styles/all.min.css" />

<!-- No se cargan CDNs externos -->
<!-- Google Fonts comentado -->
<!-- SweetAlert2 comentado -->
<!-- Micromodal comentado -->
```

* * *

## 11. Próximos Pasos (Derivados de la Sesión)[](#11-proximos-pasos-derivados-de-la-sesion)

- **Implementar PulsarJS Core** con `subscribeSelector`, freeze, y skipEqualUpdates.
- **Implementar GraphletJS Core** con `put`, `upsert`, `update`, `delete`, `link`, `unlink`, `query`.
- **Implementar ChunkletJS Core** con `define`, `mount`, `unmount`, `observe`, y Context API.
- **Implementar BinderJS** con bind, unbind, validate, submit, y dynamic panel binding.
- **Implementar VoyajerJS** con push, replace, sync, y parse/serialize simétrico.
- **Implementar Adapters** (GraphletSync, Hydration, Persistence).
- **Construir el editor de ejemplo** end-to-end (toolbox → canvas → property panel).
- **Definir tests** para cada primitivo (test harness browser-native).
- **Establecer benchmarks** de rendimiento (drag simulation, setState con muchos listeners).

* * *

## 12. Referencias[](#12-referencias)

- **SESS-001:** Reestructuración, Optimización de Imports y Limpieza de Dependencias.
- **Logbook L-001:** Refactorización de nodos y cierre de Fase 1.
- **Documento de Fase 1:** `docs/phase1/PHASE1_Definicion_y_Alineamiento.md`.
- **Contratos de Especificación:** `docs/contracts/` (ocho documentos, versión 0.2.0, Design Contract).
- **Revisión Arquitectónica:** `Session_2026-08-28_NexusJS_architectural_review.md`.
- **Código fuente:** `src/` (implementaciones de los primitivos).
- **Ejemplos:** `examples/` (demos de cada primitivo y editor completo).

* * *

## Historial de Cambios[](#historial-de-cambios)

| Versión | Fecha      | Cambio                       | Autor                          |
|---------|------------|------------------------------|--------------------------------|
| 1.0     | 2026-08-28 | Versión inicial de la sesión | Equipo de desarrollo (NexusJS) |

* * *

## Nota sobre el Formato[](#nota-sobre-el-formato)

Este documento sigue el formato de SESS-001 como referencia. Se ha adaptado el contenido para reflejar la sesión de definición arquitectónica de NexusJS, incluyendo:

- **Metadatos:** Actualizados con el contexto de NexusJS.
- **Problema/Oportunidad:** Reemplazo de drawflow, arquitectura de cinco primitivos.
- **Debate y Decisiones:** 13 decisiones clave con justificación.
- **Resultados:** Métricas de optimización y rendimiento.
- **Estructura de archivos:** Árbol completo del proyecto NexusJS.
- **Arquitectura de dependencias:** Diagrama de niveles.
- **Flujo de datos:** Patrones de interacción.
- **Decisiones técnicas:** Detalles de implementación por primitivo.
- **Próximos pasos:** Plan de implementación.
- **Referencias:** Documentos relacionados.

