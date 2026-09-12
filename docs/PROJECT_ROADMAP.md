# Nexus — Roadmap general del proyecto

**Versión de este documento:** 2.
**Estado al escribir:** Fase 0 cerrada.
**Alcance:** roadmap por hitos y dependencias, sin fechas. El ritmo lo decide el desarrollador según capacidad y prioridades del proyecto.
**Principio guía:** Article I. Cada fase se compromete a lo que la evidencia actual justifica; las fases futuras se describen con menos detalle en proporción a la incertidumbre real.

**Cambios respecto a v1:**
- Fases 1 y 2 reorganizadas. En v1, Fase 1 era "widget factory + reemplazo de un componente RiotJS del editor de flujos" y Fase 2 era "migración completa del editor". En v2, Fase 1 es "construcción de un chatbot funcional sobre Nexus" y Fase 2 es "portar el editor de flujos original". La widget factory pasa de ser **prerrequisito** de Fase 1 a **resultado emergente** de sus escenas medias.
- Justificación de la reorganización: la propuesta v1 era portación (menos evidencia empírica sobre el stack), la v2 es construcción de una aplicación real distinta (más evidencia). Además, el chatbot ejercita dimensiones del stack que el editor no fuerza: streaming asíncrono, integración con API externa, texto rico. Ver §Reconocimientos honestos §7.
- Este cambio revisa una declaración en `PHASE_0_CLOSURE.md §4` que decía "Fase 1 tiene por objetivo construir la widget factory como reemplazo funcional del código heredado de RiotJS". Esa declaración queda superseded por este roadmap v2, sin editar el closure de Fase 0 (que es documento inmutable por diseño). El objetivo global — reemplazar RiotJS — permanece; el orden de las fases cambia.


## Vista panorámica

```
FASE 0 ✅ Stack + adapters de primera generación
   │
   ▼
FASE 1 🎯 Chatbot funcional sobre Nexus (tipo AnythingLLM minimal)
   │       └── widget factory emerge de las escenas medias
   ▼
FASE 2    Editor de flujos (drag-and-drop pipeline) sobre Nexus
   │      └── portación del proyecto original + resolución de deuda
   │          cross-adapter guiada por uso real
   │
   ├────── FASE 3a (opcional, paralelo)  Testing infrastructure
   │       └── Playwright + CI + resolución de deuda de testing infra
   │
   ├────── FASE 3b (opcional, paralelo)  Distribución pública
   │       └── npm/CDN publicable, README de proyecto, versionado semántico
   │
   ▼
FASE 4    Consolidación y v1.0 estable
   │      └── ADAPTER-UTILS, PERSISTENCE-INDEXEDDB si evidencia demanda,
   │          documentación completa de terceros, benchmarks públicos
   ▼
FASE 5    Nexus como biblioteca abierta (opcional, según decisión)
```

**Ruta crítica:** Fase 0 → Fase 1 → Fase 2 → Fase 4. Las Fases 3a y 3b son paralelizables desde Fase 1 en adelante. La Fase 5 depende de decisión externa al roadmap técnico.


## FASE 1 — Chatbot funcional sobre Nexus

**Objetivo:** construir una aplicación de chat funcional sobre el stack Nexus completo, con complejidad suficiente para ejercitar las dimensiones que el editor de flujos no forzaría (streaming asíncrono, integración con LLM, texto rico), pero con scope acotado para permitir cierre limpio.

**Referencia visual:** AnythingLLM, versión minimal. Es útil como ancla mental pero no como especificación — el chatbot Nexus define su propio scope (§1.3).

### 1.1 Prerrequisitos (todos cumplidos por Fase 0)

- Stack completo verificable (Pulsar, nebula, Voyajer, Chunklet).
- Cinco adapters de primera generación en `src/adapters/`.
- Contratos alineados con implementaciones.
- Ciclo de desarrollo probado (mini-spec → código → harness → widget).

### 1.2 Modelo de dominio propuesto

**Entidades en nebula:**
- `conversation:X` — properties: título, timestamp de creación, modelo asociado.
- `message:Y` — properties: rol (user/assistant), contenido, timestamp, estado (streaming/complete).
- Relación: `conversation:X --contains--> message:Y1, message:Y2, ...`

**Estado en Pulsar bajo `ui.*`:**
- `ui.activeConversation` (id o null).
- `ui.sidebarOpen` (boolean).
- `ui.composerText` (string en el input).
- `ui.streaming` (id del mensaje en curso, o null).
- Otros que emerjan.

**Estado bajo `route.*` (via Voyajer):**
- `/` → sin conversación activa (vista de bienvenida o lista).
- `/#/c/uuid` → conversación específica activa.

**Persistencia:** todo nebula vía Persistence Adapter con debounce moderado. localStorage inicial; IndexedDB solo si la escena de scroll infinito lo demanda.

Esta propuesta es punto de partida, no compromiso. Cada escena la refina según lo que descubra.

### 1.3 Scope congelado (compromisos y no-compromisos)

**Sí en Fase 1:**
- Crear, listar, borrar, renombrar conversaciones.
- Enviar mensaje de usuario.
- Recibir respuesta de asistente vía streaming (mock primero, provider real después).
- Persistencia local automática de conversaciones y mensajes.
- Un solo provider de LLM real al final (elección se hará en la escena correspondiente).

**No en Fase 1 (deferidos explícitamente):**
- RAG, embeddings, búsqueda semántica.
- Multi-workspace.
- Autenticación multi-usuario.
- Plugins, agentes, herramientas.
- Múltiples providers seleccionables al vuelo.
- Sync entre pestañas (candidato natural pero se decide en §1.4.6).
- Markdown avanzado, syntax highlighting, LaTeX. Contenido plano en v1; render rico si emerge necesidad.

La disciplina de scope congelado (equivalente a la Disciplina 1 de Punto 6 en Fase 0) aplica aquí. Si en construcción aparece necesidad de algo no listado, se anota como deuda y se decide si entra ahora o se difiere.

### 1.4 Escenas

Las cuatro primeras están descritas con precisión. Las siguientes con menos detalle: son la trayectoria esperada, sujeta a evidencia.

**Escena 1.1 — Setup del stack y vista mínima.**
Setup de Chunklet con Pulsar, nebula, Voyajer, Bridge, Hydration y Persistence instanciados en orden canónico. Widget "app-shell" con sidebar vacío + área principal vacía. Sin behaviors aún; solo verificar que el stack arranca y monta. Cero funcionalidad de chat, cero LLM.

*Salida:* HTML servible en local que arranca sin errores. Deuda esperada: probablemente cero, es setup.

**Escena 1.2 — Widget "conversation-list" en sidebar.**
Primer widget real: renderiza la lista de conversaciones desde `entities.conversations`. Botón "Nueva conversación" que hace `nebula.put('conversation:...', {título, ts})`. Click en una conversación actualiza `ui.activeConversation`. Este widget ejercita: Bridge (renderizado reactivo desde nebula), Chunklet (behavior de click), y Pulsar (activeConversation).

*Salida:* widget funcional, primera evidencia empírica de que el patrón Chunklet+Bridge+nebula+Pulsar funciona en un caso real de construcción (no de portación). Deuda esperada: probablemente aparece la necesidad del helper WIDGET-COMPOSITION.

**Escena 1.3 — Widget "conversation-messages" con mock streaming.**
Widget principal que renderiza los mensajes de la conversación activa. Componer un mock provider que "responde" un mensaje token a token con setTimeout, para simular streaming sin depender de un LLM real. Este widget ejercita: renderizado condicional (según activeConversation), streaming (mutación incremental de una entidad), scroll automático al recibir tokens.

*Salida:* chat funcional con mock. Aquí probablemente aparece la primera fricción con BRIDGE-REACTIVE (73% de ruido documentado en Fase 0) porque el streaming produce muchas mutaciones por segundo sobre una sola entidad. Decisión: si la fricción es tolerable, seguir; si no, resolver Camino 2 del Bridge aquí mismo.

**Escena 1.4 — Widget "composer" + navegación Voyajer.**
Input de composición del usuario. Enviar mensaje: crea `message:X` con rol user, dispara al mock provider, éste crea `message:Y` con rol assistant y streamea. URL sincronizada vía Voyajer (`/#/c/uuid` cuando hay conversación activa). Deep link funcional: pegar una URL abre esa conversación.

*Salida:* chatbot funcionalmente completo con mock. Punto de descanso natural — es la primera versión que "parece" un chatbot real, aunque sin LLM.

**Escena 1.5 — Consolidación: widget factory emerge.**
Con 4 widgets construidos (app-shell, conversation-list, conversation-messages, composer), identificar los patrones repetidos. Extraer una **widget factory** que declare widgets con configuración en lugar de código imperativo. La factory no se diseña antes de esta escena — se descubre aquí. Migrar los 4 widgets existentes a la factory como validación.

*Salida:* widget factory funcional documentada, 4 widgets migrados sin regresiones. Fase 1 tiene su capacidad principal.

**Escena 1.6 — Integración con provider LLM real.**
Elegir un provider (Ollama local es candidato natural por no requerir API keys ni costos, pero se decide en la escena). Reemplazar el mock por integración real vía fetch + SSE o WebSocket. El código de integración es application code, no adapter — pero puede sugerir extensiones al External Event Adapter si el patrón se repite.

*Salida:* chatbot funcional con LLM real. Evidencia empírica de latencias reales, fallos de red, formatos de respuesta variables.

**Escena 1.7 y siguientes — deriva por evidencia.**
Escenas posibles según lo que las 1.1-1.6 revelen: sync entre pestañas (usa External Event), scroll infinito de mensajes históricos (posiblemente evidencia PERSISTENCE-INDEXEDDB), settings persistidos, borrado con confirmación, edición de mensajes. Ninguna se compromete aquí; se decide al llegar según qué reveló el uso real.

### 1.5 Compromisos de cierre de Fase 1

- Chatbot funcional según scope §1.3, con LLM real integrado.
- Widget factory documentada y usada por 4+ widgets.
- WIDGET-COMPOSITION resuelto (de deuda a capacidad estable en `ctx`).
- BRIDGE-REACTIVE resuelto (Camino 2), asumiendo que Escena 1.3 lo forzó.
- Deuda documental actualizada con lo descubierto.
- Session doc + auditoría + closure de Fase 1 siguiendo el patrón de Fase 0.

### 1.6 Deuda diferida que probablemente NO se toca en Fase 1

- 12-BRIDGE-INTEGRATION / 12-PERSISTENCE-INTEGRATION: solo si Escena 1.7+ introduce sync cross-tab. Si el chatbot es single-tab en v1, siguen diferidos.
- PERSISTENCE-INDEXEDDB: solo si el volumen de mensajes históricos lo demanda. Un chatbot personal probablemente no llega ahí en v1.
- ADAPTER-UTILS-DEDUP: no se introducen adapters nuevos en Fase 1. Sigue diferido.
- V-T2, V-T3, C-T7, C-2 sym: independientes de Fase 1, esperan Playwright.


## FASE 2 — Editor de flujos sobre Nexus

**Objetivo:** portar el drag-and-drop pipeline editor original (actualmente sobre RiotJS + drawflow) al stack Nexus + widget factory. Es el proyecto que motivó todo Nexus; ahora se construye sobre el stack propio con la factory madurada en Fase 1.

### 2.1 Prerrequisitos (Fase 1 cerrada)

- Widget factory funcional y probada con al menos 4 widgets del chatbot.
- Deuda inmediata post-Fase-0 resuelta (WIDGET-COMPOSITION, BRIDGE-REACTIVE en particular).
- Ciclo de desarrollo probado dos veces (Fase 0 y Fase 1).

### 2.2 Modelo de dominio propuesto

**Entidades en nebula:**
- `node:X` — nodos del pipeline, properties: tipo, posición, configuración específica.
- `edge:Y` — conexiones entre nodos, properties: source-port, target-port, estilo.
- `pipeline:Z` — contenedor top-level, properties: nombre, versión.

**Estado en Pulsar:**
- Herramienta activa, selección, viewport, zoom, snapping, undo/redo state, panel visibility.

**Persistencia:** el pipeline completo. Consideraciones de formato de exportación (JSON canónico compatible con drawflow original, o formato nuevo).

**Backend:** integración con el backend SQL no-Node existente, vía application code o adapter extendido según lo que Fase 1 haya enseñado sobre integración externa.

### 2.3 Escenas (con menos detalle porque la evidencia disminuye)

**Escena 2.1 — Análisis del código RiotJS existente.**
Inventario de componentes actuales, modelo de datos actual, integración con drawflow. Identificar qué es esencial y qué es accidental. No es escritura de código, es entendimiento.

**Escena 2.2 — Migración por lotes.**
Migrar componentes uno por uno, en orden de menos a más acoplado. Cada componente usa la widget factory de Fase 1. Preservar compatibilidad de datos con el formato actual (para no forzar migración de pipelines existentes en producción).

**Escena 2.3 — Aparición natural de fricciones cross-adapter.**
Al combinar Bridge + Persistence + External Event en la app real, 12-BRIDGE-INTEGRATION y 12-PERSISTENCE-INTEGRATION probablemente dejen de ser hipótesis. Resolverlos aquí guiado por la fricción concreta.

**Escena 2.4 — Integración con el backend SQL.**
Definir cómo Nexus se comunica con el backend existente. Puede ser fetch en application code, un adapter nuevo, o extensión del External Event a otro transporte. La decisión depende de patrones de uso reales.

**Escena 2.5 — Deprecación de RiotJS.**
Cuando todos los componentes están migrados, retirar RiotJS. El editor corre 100% sobre Nexus.

### 2.4 Compromisos de cierre de Fase 2

- Editor completo funcionando sobre Nexus.
- RiotJS retirado del proyecto original.
- Deuda cross-adapter (12-BRIDGE-INTEGRATION, 12-PERSISTENCE-INTEGRATION) resuelta si emergió.
- Compatibilidad de datos con pipelines pre-migración.
- Session doc + auditoría + closure de Fase 2.


## FASE 3a — Testing infrastructure (paralelizable)

**Objetivo:** subir la infraestructura de testing de browser-native manual a CI automatizada. Resuelve los cuatro ítems diferidos de testing infrastructure.

### 3a.1 Prerrequisitos

- Fase 1 cerrada (para tener aplicación real que testear además de harness aislados).
- Puede correr en paralelo con Fase 2.

### 3a.2 Escenas

**Escena 3a.1 — Playwright.**
Configurar Playwright con matriz Chromium/Firefox/WebKit. Los harness browser-native existentes son directamente portables — solo cambia el runner. Preservar la ejecución manual como opción.

**Escena 3a.2 — Resolución de deuda de testing.**
Con Playwright, V-T2, V-T3, C-T7, C-2 sym dejan de estar diferidos. Además, tests de integración del chatbot (Fase 1) y el editor (Fase 2) pasan a ser factibles.

**Escena 3a.3 — GitHub Actions.**
Workflow que corre en cada push. Matriz de navegadores. Badge en README de proyecto (cuando exista, ver Fase 3b).

### 3a.3 Compromisos de cierre

- CI automatizada verde en cada commit.
- Cuatro ítems de testing infra resueltos.
- Documentación de cómo correr los tests local vs CI.


## FASE 3b — Distribución pública (paralelizable)

**Objetivo:** hacer que Nexus sea publicable a npm y consumible desde CDN por terceros. Escribir el README de proyecto que Fase 0 dejó pendiente.

### 3b.1 Prerrequisitos

- Fase 1 cerrada.
- Puede correr en paralelo con Fase 2 o Fase 3a.

### 3b.2 Escenas

**Escena 3b.1 — `package.json` publicable por primitiva y por adapter.**
Cada primitiva y cada adapter puede publicarse independientemente (`@dfc/pulsar`, `@dfc/nebula`, `@dfc/adapter-bridge`, etc.) o como paquete monolítico. Decisión guiada por patrones de consumo que las Fases 1 y 2 hayan revelado.

**Escena 3b.2 — README de proyecto.**
Documento narrativo de entrada. El chatbot de Fase 1 es candidato natural como ejemplo runnable en el README — es una aplicación completa, autónoma, no requiere backend propio.

**Escena 3b.3 — Guía de composición.**
Documento intermedio entre el README y los contracts, mostrando cómo componer las primitivas y adapters en aplicaciones reales. Basado en la evidencia de Fases 1 y 2.

**Escena 3b.4 — Publicación v0.1 pública.**
Primer publish a npm. Verificar que un consumidor externo puede instalar y usar sin fricción.

### 3b.3 Compromisos de cierre

- Nexus publicable e importable desde CDN.
- README de proyecto vivo con el chatbot como ejemplo.
- Guía de composición documentada.
- Versionado semántico establecido.


## FASE 4 — Consolidación hacia v1.0

**Objetivo:** consolidar el stack tras evidencia empírica acumulada de dos aplicaciones reales (chatbot + editor) y potencial uso externo (Fase 3b). Resolver la deuda restante que sí demande evidencia.

### 4.1 Prerrequisitos

- Fase 2 cerrada (editor funcionando sobre Nexus).
- Idealmente Fase 3a (CI) y Fase 3b (publicable).

### 4.2 Escenas

**Escena 4.1 — Resolución de ADAPTER-UTILS-DEDUP.**
Con la evidencia de 5+ adapters (los 5 originales más los que Fase 1 y 2 hayan introducido), extraer el helper compartido para el patrón wrapper.

**Escena 4.2 — Resolución de PERSISTENCE-INDEXEDDB (si hay evidencia).**
Si el editor de flujos produce pipelines >2MB, o si el chatbot con historial largo lo demanda, implementar backend IndexedDB. Si no hay evidencia, sigue diferido.

**Escena 4.3 — Benchmarks públicos.**
Métricas comparativas honestas contra alternativas del ecosistema (Zustand, Nano Stores, Alpine.js según cada primitiva). Article I aplicado al marketing.

**Escena 4.4 — Auditoría final pre-v1.0.**
Revisión inter-documental completa, verificación de que ninguna primitiva o adapter tiene deuda escondida, coherencia total.

**Escena 4.5 — Publicación de v1.0.**
Cambio de "0.x" a "1.0" es declaración de estabilidad. Solo cuando la evidencia empírica de dos aplicaciones reales confirma que el diseño soporta el uso.

### 4.3 Compromisos de cierre

- Todos los ítems de deuda formal resueltos o justificadamente diferidos con nueva evidencia.
- Benchmarks publicados y honestos.
- v1.0 estable publicada.
- Documentación completa.


## FASE 5 — Nexus como biblioteca abierta (opcional)

**Objetivo:** decidir si Nexus se convierte en proyecto open-source con comunidad, o permanece como stack interno del proyecto original.

Esta fase es opcional y externa al roadmap técnico. La decisión depende de factores no técnicos: si hay interés externo, si hay capacidad de mantenimiento público, si el proyecto original permite abrirlo. No se compromete aquí.

Si la decisión es afirmativa, la Fase 5 incluye típicamente: gobernanza, guidelines de contribución, changelog público, roadmap público, respuesta a issues, releases regulares. Ninguno de estos es trabajo técnico — son trabajo de comunidad.


## Reconocimientos honestos sobre este roadmap

**1.** La Fase 1 está descrita con más detalle porque la evidencia de Fase 0 la informa directamente. Fases 2 en adelante están descritas con menos detalle porque la incertidumbre crece — pretender lo contrario sería teatro de planificación.

**2.** Las dependencias entre fases son reales pero no son cadenas rígidas. Fase 3a y Fase 3b pueden empezar en cualquier momento post-Fase-1, y no bloquean nada. La única cadena estricta es 0 → 1 → 2 → 4.

**3.** El roadmap no incluye fechas porque no tengo información para inventarlas honestamente. El desarrollador estima según su capacidad. Cada fase produce sus propios session doc + audit + closure, así el estado es siempre auditable.

**4.** La disciplina que produjo la Fase 0 debe replicarse: mini-spec antes de código, harness antes de widget, evidencia antes de decisión, deuda registrada antes de olvidarse. Este roadmap asume esa disciplina; sin ella, cualquier plan es especulación.

**5.** Algunos ítems mencionados como "probablemente en Fase X" pueden moverse. Si Fase 1 descubre que algo diferido es urgente, se resuelve ahí. Article III — corregir cuando la evidencia lo pide.

**6.** El proyecto puede pausarse en cualquier fase cerrada sin comprometer el trabajo hecho. Fase 0 cerrada es un estado válido de reposo. Fase 1 cerrada también lo será. La estructura fase-cerrada permite descansos honestos.

**7.** Sobre la elección de chatbot como Fase 1 vs editor de flujos. El editor de flujos es el proyecto original y tenía sentido como Fase 1 en v1 del roadmap. La ventaja del chatbot es empírica: **construir** una aplicación desde cero sobre el stack revela más huecos que **portar** una aplicación existente. El editor de flujos ya tiene un modelo mental resuelto en RiotJS — la portación sigue una plantilla mental preexistente. El chatbot obliga a decidir modelo, adaptar el stack, y descubrir dimensiones que el editor no fuerza (streaming, integración con LLM, texto rico). Además, el chatbot es una herramienta útil aparte del proyecto original, mientras que el editor es específico. La reorganización pospone el proyecto motivante pero fortalece el stack sobre el que se construirá.

**8.** Sobre el orden Fase 1 (chatbot) → Fase 2 (editor). Este orden asume que llegar al editor con un stack más maduro es mejor que llegar antes con un stack menos maduro. Es una apuesta que el chatbot no descubre huecos catastróficos que hagan retroceder Fase 0. Si eso pasa, no es fallo — es exactamente el propósito de construir aplicaciones reales antes de v1.0.


## Regla operativa transversal

Todas las fases siguen el ciclo canónico establecido en Fase 0:

1. **Mini-spec** — declarar qué se va a hacer con precisión suficiente para revisión.
2. **Confirmación** — el desarrollador aprueba antes de codificar.
3. **Código** — implementación siguiendo la mini-spec.
4. **Harness** — verificación mecánica de que el código cumple el contrato.
5. **Widget o uso real** — verificación empírica de que el código sirve para lo que fue diseñado.
6. **Deuda registrada** — cualquier limitación descubierta va a un documento vivo (`PHASE_N_DEFERRED.md` o equivalente).
7. **Session doc + audit + closure** — al cerrar la fase, retrospectiva honesta + verificación de coherencia + cierre declarativo.

Este ciclo no es opcional. Es lo que permitió que Fase 0 llegara a estado auditable en un solo pase, sin deuda oculta.


*Fin del roadmap general del proyecto Nexus (v2).*
