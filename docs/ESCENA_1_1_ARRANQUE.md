# Escena 1.1 — Secuencia canónica de arranque

**Fase:** 1 (chatbot sobre Nexus)
**Escena:** 1.1 — arranque del stack, sin behaviors ni funcionalidad de chat
**Estado:** mini-spec, previa a implementación
**Decide:** el orden de instanciación que heredan todas las escenas siguientes


## 1. Qué cierra esta escena

Un HTML servible en local que instancia el stack completo — cuatro primitivas
más tres adapters — monta un shell vacío y arranca sin errores. Cero
funcionalidad de chat, cero LLM, cero behaviors con lógica.

El entregable parece trivial. No lo es: fija el orden de instanciación, y ese
orden tiene una decisión con consecuencia medible que Fase 0 nunca forzó,
porque cada widget canónico validaba un adapter aislado. Esta es la primera vez
que Hydration, Bridge y Persistence conviven sobre el mismo Graphlet.


## 2. La secuencia

```javascript
// 1. Primitivas crudas. Ningún wrapper instalado todavía.
const graphlet = createGraphlet();
const pulsar   = createStatePulsar({ ui: {}, entities: {}, route: {}, net: {} });

// 2. Hidratar ANTES de montar adapters. Ver §3.
const guardado = localStorage.getItem(CLAVE);
if (guardado) {
  createHydrationAdapter({ graphlet }, { snapshot: JSON.parse(guardado) });
}

// 3. Bridge. Una sola proyección inicial de todo lo hidratado.
const bridge = createGraphletPulsarBridge(
  { graphlet, pulsar },
  { path: 'entities' }            // skipInitialSync: false (default)
);

// 4. Persistence. writeOnInit: false — acabamos de leer de ahí.
const persistence = createPersistenceAdapter(
  { graphlet },
  { key: CLAVE, mode: 'debounced', debounceMs: 300, writeOnInit: false }
);

// 5. Stack de Chunklet sobre las instancias ya preparadas.
const stack = Chunklet.setup({ pulsar, graphlet, voyajer: { mode: 'hash' } });

// 6. Definir behaviors y montar.
Chunklet.define('app-shell', appShellFactory);
Chunklet.mount(document.body);
```

Voyajer en modo `hash`, pero por elección, no por imposición. Los hosts
objetivo (Wails, Tauri) sirven bajo orígenes con semántica http, así que el
modo `history` es técnicamente viable si el AssetServer hace fallback a
`index.html` para todas las rutas. Se elige `hash` porque no requiere
configurar nada en ningún host y porque Voyajer normaliza la URL virtual antes
de `parse` (Voyajer Contract §5.4): el mismo par `parse`/`serialize` funciona
en ambos modos sin ramificar, de modo que cambiar de opinión más adelante es
una línea de configuración. Ver Nexus Contract §1.1 sobre los orígenes reales
de los hosts objetivo y por qué `file://` no es uno de ellos.


## 3. Por qué Hydration va primero

Hydration puebla el grafo con N `upsert` más L `link`. Si Bridge y Persistence
ya envuelven los métodos de mutación, **cada una de esas llamadas atraviesa los
wrappers**: Bridge re-proyecta el grafo entero y Pulsar congela el resultado
recursivamente. El arranque pasa de lineal a cuadrático.

Medido sobre el código real, hidratando un grafo encadenado de N entidades y
N−1 links, mediana de 15 corridas tras warmup:

| N | A · setState | A · tiempo | B · setState | B · tiempo | factor |
|---|---|---|---|---|---|
| 25 | 1 | 0.12 ms | 50 | 0.80 ms | ×6 |
| 50 | 1 | 0.13 ms | 100 | 2.60 ms | ×20 |
| 100 | 1 | 0.14 ms | 200 | 8.26 ms | ×60 |
| 200 | 1 | 0.25 ms | 400 | 30.64 ms | ×123 |
| 400 | 1 | 0.51 ms | 800 | 124.10 ms | ×246 |
| 800 | 1 | 1.20 ms | 1600 | 515.62 ms | ×430 |

Orden A es la secuencia de §2. Orden B monta los adapters antes de hidratar.

Exponente de crecimiento al duplicar N, en los tres últimos pasos:

| paso | orden A | orden B |
|---|---|---|
| 100 → 200 | 0.84 | 1.89 |
| 200 → 400 | 1.02 | 2.02 |
| 400 → 800 | 1.25 | 2.05 |

Orden A converge a 1 (lineal). Orden B converge a 2 (cuadrático). No es una
constante desfavorable: es otra clase de complejidad.

El conteo de `setState` es la explicación estructural y es exacto, no medido:
orden A produce **siempre 1**, orden B produce **2N** — una por cada `upsert` y
una por cada `link`. Cada una de esas 2N llamadas arrastra una re-proyección
O(N) más un `deepFreeze` O(N) sobre objetos recién creados que nunca están
congelados. De ahí el cuadrático.


## 4. Por qué esto es una trampa y no solo una ineficiencia

**Los dos órdenes producen el mismo estado final.** Verificado: la proyección
en Pulsar es idéntica byte a byte. El orden equivocado no falla, no lanza, no
corrompe nada — solo tarda.

Eso es lo que lo hace peligroso. A los 25 nodos del primer prototipo, orden B
cuesta 0.8 ms y nadie lo nota. La degradación es silenciosa y aparece cuando la
aplicación ya creció, lejos en el tiempo del commit que la introdujo, y sin
ningún síntoma que apunte al orden de instanciación.

Para Fase 1 en concreto: si cada mensaje del chat es una entidad Graphlet, una
conversación larga llega a cientos de entidades sin esfuerzo. A 800 mensajes,
orden B cuesta medio segundo de hilo principal bloqueado **en cada arranque**,
contra 1.2 ms del orden A. Es exactamente el rango donde vive la aplicación que
vamos a construir, no un extremo teórico.


## 5. Relación con la deuda ya registrada

El cuadrático de §3 es el mismo fenómeno que `BRIDGE-REACTIVE`
(`PHASE_0_DEFERRED.md`): la proyección snapshot del Bridge re-proyecta todo en
cada mutación. Aquí se manifiesta como coste de arranque; allá se manifiesta
como ruido reactivo durante la sesión.

**Ordenar bien no resuelve `BRIDGE-REACTIVE`, lo esquiva en el arranque.** El
ruido reactivo sigue intacto para las mutaciones en vivo, y sigue esperando la
evidencia de fricción que Fase 1 debe producir. Conviene no confundir las dos
cosas: si al ordenar bien el arranque alguien concluye que el Bridge ya no es
un problema, la evidencia del 73% de ruido con N=8 sigue diciendo lo contrario.

Dicho al revés: cuando se implemente Camino 2 de `BRIDGE-REACTIVE`, el coste
del orden B baja de O(N²) a O(N) y esta trampa se desactiva sola. Mientras
tanto, el orden es la única defensa.


## 6. Invariante que esta escena establece

> **Toda carga masiva de datos al Graphlet ocurre antes de que ningún adapter
> envuelva sus métodos de mutación, o con los adapters explícitamente
> destruidos durante la carga.**

Cubre la hidratación de arranque y también cualquier importación posterior
(cargar una conversación archivada, importar un snapshot, restaurar un backup).
El patrón para el caso posterior ya está descrito en
`external-event-adapter.spec.md` §4.3 para re-hidratación en vida: destruir,
cargar, reinstanciar.

Nótese que esto se compone con el aviso que documentamos en `chunklet.js`
v0.4.1 sobre `configure({ graphlet })`: sustituir el grafo no recablea los
adapters. Ambas cosas son la misma disciplina — los adapters envuelven una
instancia concreta, y cualquier operación que cambie la instancia o la cargue
en masa tiene que coordinarse con ellos explícitamente.


## 6b. Entorno de ejecución asumido

La escena asume un servidor estático mínimo, no `file://`. Es lo que
representan los hosts objetivo: Wails sirve los assets embebidos por su
AssetServer bajo `wails://wails`, Tauri bajo `tauri://localhost` (o
`http://tauri.localhost` en Windows). Ambos son orígenes gestionados con
semántica http.

Esto importa de forma concreta para Fase 1 más allá del routing: el chatbot
necesita `fetch` contra una API de LLM, y `fetch` está bloqueado bajo
`file://`. La aplicación de esta fase no podría funcionar en ese esquema
aunque el arranque sí lo hiciera. Conviene no construir sobre un supuesto que
la Escena 1.3 va a romper.

Para desarrollo, cualquier servidor de una línea sirve. Lo que sigue siendo
innegociable es lo de siempre: cero build step, cero Node en producción.


## 7. Fuera de alcance

- **External Event Adapter.** El roadmap decide en §1.4.6 si la sincronización
  entre pestañas entra en Fase 1. No se instancia aquí. Si entra, va como
  wrapper más externo (`external-event-adapter.spec.md` §4.2) y hereda el mismo
  invariante de §6.
- **Logging Adapter.** Útil en desarrollo, no es parte del arranque canónico.
  Si se monta, va después de Persistence y antes de `Chunklet.setup`.
- **Toda funcionalidad de chat.** Modelo de entidades, streaming, integración
  con LLM y renderizado de mensajes son escenas 1.2 en adelante.


## 8. Artefactos

| Artefacto | Contenido |
|---|---|
| `index.html` | Shell servible, importa el stack desde rutas relativas |
| `app/boot.js` | La secuencia de §2, exportando el stack resuelto |
| `app/shell.js` | Factory `app-shell`: sidebar vacío, área principal vacía |
| `bench/hidratacion.mjs` | El benchmark de §3, reproducible |

El benchmark se conserva en el árbol, no se descarta tras medir. Cuando se
implemente Camino 2 de `BRIDGE-REACTIVE`, volver a correrlo mide la mejora
contra una línea base real en vez de una estimación.


## 9. Verificación de cierre

1. El HTML carga desde un servidor estático mínimo (`python -m http.server` o
   equivalente) sin errores en consola. Ese es el entorno que representa al
   target real; `file://` no se usa como criterio de cierre porque es más
   estricto que cualquier host objetivo y bloquea la importación de módulos ES
   en Chromium y WebKit (Nexus Contract §1.1).
2. Con `localStorage` vacío, el stack arranca y `pulsar.getState().entities`
   es `{}`.
3. Con un snapshot sembrado a mano, las entidades aparecen proyectadas en
   `entities.*` tras el arranque.
4. El benchmark de §3 corre y reproduce el factor de crecimiento documentado.
5. `Chunklet.mount` monta `app-shell` y el shell aparece en pantalla.
6. Un `unmount` seguido de `mount` no deja listeners huérfanos.
