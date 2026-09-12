# Escena 1.2 — Lista de conversaciones

**Fase:** 1 (chatbot sobre Nexus)
**Estado:** implementada, pendiente de corrida en navegador
**Propósito:** primer widget real construido sobre el stack, y primer instrumento que mide el ruido reactivo del Bridge.

## Qué es

El modelo de entidades del chat y los dos widgets que lo presentan: una lista de conversaciones en el lateral y una fila por conversación. Crear muta Graphlet; el repintado llega por el Bridge a través de Pulsar. Seleccionar no toca el modelo.

Es la primera evidencia de que el patrón Chunklet + Bridge + Graphlet + Pulsar funciona en construcción, no en portación.

## Cómo correrla

Servidor estático desde la raíz del repositorio:

```
python -m http.server 8000
```

- Aplicación: `http://localhost:8000/examples/escena0102/`
- Harness: `http://localhost:8000/examples/escena0102/tests/conversaciones.test.html`

Validación previa desde Node, sin navegador:

```
cd examples/escena0102/tests
node validar-modelo.mjs      # 52 aserciones, incluye widgets sobre DOM real
node medir-ruido.mjs         # la medición de BRIDGE-REACTIVE
```

`validar-modelo.mjs` usa `linkedom` como DOM. Instalarlo si hace falta: `npm install linkedom`.

## Estructura

```
escena0102/
├── index.html                      shell con el lateral y la plantilla de fila
├── app/
│   ├── boot.js                     secuencia de 1.1 más el registro de behaviors
│   ├── persistencia.js             sin cambios respecto a 1.1
│   ├── ids.js                      generador de identificadores
│   ├── modelo.js                   operaciones de dominio y derivación de la lista
│   ├── shell.js                    app-shell, refleja la conversación activa
│   ├── conversation-list.js        dueño del DOM de la lista
│   └── conversation-item.js        fila individual, Chunklet anidado
└── tests/
    ├── conversaciones.test.html     harness canónico (56 aserciones)
    ├── validar-modelo.mjs           validador Node (52 aserciones)
    └── medir-ruido.mjs              medición de ruido reactivo
```

## Las cuatro decisiones de esta escena

**Identificadores sin `crypto.randomUUID`.** Esa API exige contexto seguro. En Wails sobre Windows el origen es `http://wails.localhost` y localhost sí lo es, pero `wails://wails` y `tauri://localhost` son esquemas custom cuya condición depende del motor. Un fallo al crear la primera conversación en una plataforma y no en otra es el peor tipo de defecto: dependiente del entorno e invisible en desarrollo. El generador propio tiene prefijo temporal en base 36, lo que hace los ids aproximadamente ordenables — comodidad de depuración, no garantía: el orden de presentación se decide siempre por propiedades explícitas.

**Cada fila es un Chunklet anidado.** `conversation-list` clona un `<template>`, escribe `data-entity` con el id del modelo y monta `conversation-item`. Chunklet nunca genera identificadores; los lee del DOM.

**Montaje explícito de las filas.** El widget de lista es dueño del DOM que crea, sabe exactamente cuándo aparece y cuándo se va cada fila, y las desmonta a mano en su `cleanup`. Usar `observe` habría hecho automático el desmontaje pero indeterminista el momento del montaje.

**Firma estable en el selector.** La `equality` compara sólo los campos que la interfaz pinta: id, título y `actualizadaEn`. Es la decisión con consecuencia medible.

## Reloj lógico monótono

`Date.now()` tiene resolución de milisegundo, y los motores de navegador la engrosan todavía más como mitigación de Spectre. Dos conversaciones creadas en la misma ráfaga reciben la misma marca, y entonces el orden de la lista lo decide el desempate en vez de la intención.

`modelo.ahora()` garantiza que cada llamada devuelva un valor estrictamente mayor que el anterior: sigue al reloj real cuando avanza y se adelanta un milisegundo cuando no. La deriva está acotada por el número de operaciones dentro de un mismo milisegundo y nunca es visible, porque el valor sólo se usa para ordenar.

El desempate por id existe todavía, pero como último recurso para datos hidratados desde almacenamiento, y va en la **misma dirección** que el criterio principal. Ordenar por tiempo descendente y desempatar por id ascendente invertía la lista en cada empate, poniendo la más antigua primero. Ese fue el defecto que la corrida en navegador reveló y que la corrida en Node ocultaba, porque Node era lo bastante lento como para que las marcas no empataran.

La batería se ejecuta también con `Date.now()` congelado, que es el peor caso de engrosamiento posible.

## Evidencia: ruido reactivo

Con una lista de conversaciones que no cambia, mutando sólo mensajes:

| conversaciones | mutaciones ajenas | evaluaciones del selector | repintados sin equality | repintados con equality |
|---|---|---|---|---|
| 5 | 20 | 20 | 20 | 0 |
| 10 | 50 | 50 | 50 | 0 |
| 10 | 200 | 200 | 200 | 0 |
| 50 | 200 | 200 | 200 | 0 |

El selector se evalúa una vez por mutación en ambos casos. **Eso es `BRIDGE-REACTIVE` y la `equality` no lo evita.** Lo que evita es el repintado del DOM, que es la parte cara.

La lectura para la Escena 1.3: la lista de conversaciones queda inmune al streaming de mensajes. Cuando aparezca la fricción del Bridge, estará localizada en el widget de mensajes y no contaminará el lateral. Eso acota dónde hay que mirar antes de decidir si Camino 2 se resuelve ahí mismo.

## Reconstrucción total, no diff

`pintar()` reconstruye la lista entera en cada cambio. Para decenas de filas con cambios poco frecuentes, un diff con clave sería complejidad sin evidencia que la justifique.

La selección no se pierde en el proceso porque no vive en el DOM: cada fila la lee de `ui.activeConversation` al montarse. Hay una aserción que lo fija.

Lo que justificaría el diff es que aparezca algo que sí se pierda al recrear la fila — foco, edición en curso, scroll interno. Hasta entonces no se construye.

## Decisión diferida a la Escena 1.3

**Dirección de la relación entre conversación y mensajes.** Graphlet no mantiene índice inverso: la travesía inversa exige una consulta que recorre todas las entidades. Para renderizar los mensajes de la conversación activa, `conversation --contiene--> message` se lee directo de los links, mientras que `message --perteneceA--> conversation` obliga a escanear el grafo entero. La entidad de conversación está diseñada para admitir cualquiera de las dos, y la decisión se toma con el widget de mensajes delante.

## Verificación

- 57/57 verdes en `validar-modelo.mjs`, incluyendo el ejercicio de ambos widgets sobre DOM real
- 57/57 verdes con `Date.now()` congelado, que simula el peor engrosamiento del navegador
- 61 aserciones en el harness de navegador
- Invertir el desempate del orden pone dos aserciones en rojo
- La medición de ruido reproduce la tabla de arriba