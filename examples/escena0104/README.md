# Escena 1.4 — Composer y navegación

**Fase:** 1 (chatbot sobre Nexus)
**Estado:** implementada, pendiente de corrida en navegador
**Propósito:** cerrar el chatbot funcional con mock y sincronizar la URL.

## Qué es

El widget de composición y el puente entre la navegación y el estado de interfaz. El usuario escribe, envía, el provider responde en streaming, y la URL refleja la conversación abierta. Pegar una URL abre esa conversación.

Se retiró el andamio de la Escena 1.3 — el bloque de `index.html` y `crearAndamio` en `boot.js`. Hay aserciones que comprueban que no quedó rastro.

## Cómo correrla

```
python -m http.server 8000
```

- Aplicación: `http://localhost:8000/examples/escena0104/`
- Harness: `http://localhost:8000/examples/escena0104/tests/composer.test.html`

Validación previa desde Node:

```
cd examples/escena0104/tests
node validar-composer.mjs    # 48 aserciones
```

## La decisión de esta escena: el puente es un adapter

Voyajer escribe la URL en Pulsar bajo `route.*` pero no lee Pulsar para actualizar la URL. Eso es una garantía del contrato, no una carencia: la suscripción automática produciría bucles.

Quedan dos traducciones que alguien tiene que hacer, y ese alguien es un adapter, no un widget. El criterio está en Chunklet Contract §11.2: cuando uno escribe "ante cada cambio de X, sincroniza Y", eso es trabajo de adapter. Aquí no hay DOM de por medio en ninguna dirección.

`ruta-adapter.js` se instancia en la capa de datos, después de la hidratación —necesita el modelo cargado para comprobar si la conversación que pide la URL existe— y se destruye con Bridge y Persistence.

## Qué corta el bucle, medido

Escribí en la mini-spec que el bucle lo cortaba la idempotencia de `push`, y puse además una guarda en el adapter. Al comprobarlo, ninguna de las dos cosas era exactamente cierta.

**Lo que corta el bucle son dos mecanismos combinados:** la idempotencia de `push` —si el estado serializa a la URL actual es un no-op— y la `equality` de `subscribeSelector`, que no invoca al listener cuando el valor derivado no cambió. Con esas dos, el circuito converge aunque el adapter no se guarde de nada. Lo verifiqué quitando la guarda: sigue convergiendo.

**Lo que hace la guarda es economía:** ahorra un `setState` redundante por selección. Medido, 2 en vez de 3. Hay una aserción que fija ese número, porque una línea cuyo efecto no se mide es una línea que alguien borrará con razón.

## Formato de URL

```
/#/            sin conversación abierta
/#/c/<slug>    conversación abierta
```

`<slug>` es el identificador sin prefijo de tipo: `conversation:mt1a2b` se presenta como `/#/c/mt1a2b`.

Esto acopla el formato de URL al de identificador, deliberadamente. La alternativa —`/#/c/conversation%3Amt1a2b`— produce URLs que nadie querría compartir. El acoplamiento queda contenido en el par `parse`/`serialize`, que es donde el contrato de Voyajer sitúa el conocimiento del formato de URL.

Una URL que apunta a una conversación inexistente no selecciona nada **y no la crea**. Fabricar entidades de dominio a partir de una cadena en la barra de direcciones convertiría cualquier URL malformada en un dato persistido.

## Decisiones del composer

**Sin conversación activa, enviar crea una**, con título tomado del primer mensaje. Es lo que un usuario espera al abrir la aplicación y ponerse a escribir.

**Durante el streaming el botón detiene en vez de enviar.** Enviar un segundo mensaje mientras el asistente responde plantea preguntas que el scope congelado no cubre —encolar, interrumpir, responder en paralelo— y la respuesta honesta es no permitirlo todavía.

**El estado del botón se deriva del modelo**, no de una bandera en `ui.*`: hay un mensaje con `estado: 'en-vuelo'` en la conversación activa. Dos fuentes para la misma verdad se desincronizan en cuanto una falla.

**El asa del stream vive en el composer**, que es quien lo inicia, y su `cleanup` lo detiene. Un stream es una cadena de temporizadores que sobrevive al elemento si nadie la cancela.

**Cambiar de conversación con un stream vivo lo detiene.** Dejarlo correr suena más generoso pero produce respuestas que se completan sin que nadie las mire, y abre la pregunta de qué pasa al volver. El mensaje queda `interrumpido`, que el widget de 1.3 ya sabe pintar.

## Sobre los dos harnesses

El validador Node construye una ventana completa —`location`, `history`, eventos— y ejercita el Voyajer real. El harness de navegador usa un Voyajer simulado, para no alterar la URL de la propia página del harness.

Es un reparto deliberado: cada entorno cubre lo que el otro no puede. Node puede fabricar una ventana entera; el navegador no puede prestar la suya sin ensuciarse.

## Fuera de alcance

- **Sincronización entre pestañas.** El External Event Adapter encajaría, pero ampliaría el alcance de la escena.
- **`RECONCILIACION-CON-CLAVE`.** Sigue en `PHASE_1_DEFERRED.md` para la Escena 1.5. Esta escena añade un widget más, lo que refuerza el caso.
- **Provider real.** Escena 1.6.

## Verificación

- 48/48 verdes en `validar-composer.mjs`
- 43 aserciones en el harness de navegador, pendiente de corrida
- Quitar la guarda del adapter pone una aserción en rojo
