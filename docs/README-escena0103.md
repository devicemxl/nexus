# Escena 1.3 — Mensajes con streaming simulado

**Fase:** 1 (chatbot sobre Nexus)
**Estado:** cerrada, con registro en navegador
**Propósito:** primer widget con ruta caliente, y punto de decisión sobre `BRIDGE-REACTIVE`.

## Qué es

El modelo de mensajes, un provider simulado que responde token a token, y el widget que los renderiza. Al abrir la aplicación hay un chat funcional con mock: se crea una conversación, se envía un mensaje y la respuesta aparece escribiéndose.

No hay composer todavía — eso es la Escena 1.4. Para disparar el mock hay un andamio temporal, marcado como tal en `index.html` y en `boot.js`, que se retira de una pieza.

## Cómo correrla

Servidor estático desde la raíz del repositorio:

```
python -m http.server 8000
```

- Aplicación: `http://localhost:8000/examples/escena0103/`
- Harness: `http://localhost:8000/examples/escena0103/tests/mensajes.test.html`

Validación previa desde Node:

```
cd examples/escena0103/tests
node validar-mensajes.mjs    # 53 aserciones
node medir-streaming.mjs     # coste del modelo
```

## La decisión que traía diferida desde 1.2

**Dirección de la relación: `conversation --contiene--> message`.**

nebula no mantiene índice inverso. Renderizar la conversación activa se resuelve leyendo los links de una sola entidad; la dirección opuesta obligaría a recorrer el grafo entero en cada repintado, y durante el streaming eso ocurre una vez por token.

**El orden no lo dan los links.** El array preserva el orden de inserción, pero eso es consecuencia de la implementación, no garantía de la tabla de conductas del contrato. Los mensajes se ordenan por `creadoEn`, del reloj monótono de la Escena 1.2.

> Los links responden "cuáles". La propiedad responde "en qué orden".

## El núcleo: dos suscripciones

El widget tiene dos suscripciones con propósitos distintos que no se pueden fusionar.

**Estructural.** Qué mensajes hay, en qué orden, de quién y en qué estado. Firma que **excluye el texto**. Dispara reconstrucción completa. Ocurre al cambiar de conversación y al abrir o cerrar un mensaje.

**De contenido.** El texto del mensaje en vuelo. Dispara la escritura de un solo nodo. Ocurre una vez por token.

Con una sola habría que elegir entre reconstruir la lista entera por cada token o no reaccionar al streaming.

Que `estado` sí participe de la firma es lo que hace que la transición en-vuelo → completo repinte el mensaje con su texto final.

## Decisión sobre `BRIDGE-REACTIVE`

El roadmap anticipaba que la fricción aparecería aquí. **La medición no lo sostiene.**

Coste por token de la cadena `nebula.update` → Bridge → proyección → `_notify`:

| entidades en el grafo | tokens | coste por token |
|---|---|---|
| 10 | 200 | 0.040 ms |
| 50 | 200 | 0.130 ms |
| 200 | 200 | 0.121 ms |
| 500 | 200 | 0.244 ms |
| 1000 | 600 | 0.485 ms |

El presupuesto es 33 ms por token a 30 tokens/s, o 16 ms para no perder un fotograma. El peor caso consume el 3 % del segundo.

**`BRIDGE-REACTIVE` se mantiene diferido.** El 73 % de ruido documentado en Fase 0 es real como proporción; su coste absoluto en este rango de tamaños no lo es.

Esta medición es confiable en entorno sustituto porque es JavaScript puro: sin DOM, sin layout, sin pintado. Node mide lo mismo que mediría el navegador.

Lo que Node **no** puede medir es el coste del repintado, porque no hace layout. Esa medición vive en el harness de navegador y fuerza layout explícitamente en cada iteración.

Medido en navegador, con M mensajes ya en pantalla:

| mensajes | reconstrucción completa | escritura incremental | factor |
|---|---|---|---|
| 10 | 0.30 ms | 0.056 ms | ×5 |
| 50 | 1.19 ms | 0.077 ms | ×15 |
| 200 | 4.22 ms | 0.163 ms | ×26 |
| 500 | 10.41 ms | 0.327 ms | ×32 |

A 500 mensajes la reconstrucción por token consume el 65 % del presupuesto de fotograma, y el factor sigue creciendo con el tamaño. La separación de suscripciones no es una optimización prematura: es lo que mantiene el streaming viable en conversaciones largas.

Nótese que Node estimaba el factor entre ×6 y ×24 de forma errática; el navegador lo da entre ×5 y ×32, creciendo de forma limpia con el número de mensajes. El sustituto acertó la dirección y falló la magnitud y la tendencia, que es exactamente lo que D-5 predice.

## La aserción central

El DOM resultante es idéntico se haya llegado a él reconstruyendo la lista o escribiendo un nodo. Ninguna aserción sobre la salida distingue los dos casos — disciplina D-7.

El widget expone un contador de reconstrucciones. Las aserciones fijan que abrir un mensaje reconstruye una vez, cerrarlo una más, y el streaming intermedio ninguna.

Meter `texto` en la firma estructural —el error natural, porque parece más correcto comparar todo— pone tres aserciones en rojo.

## Estado del mensaje

`completo`, `en-vuelo`, `interrumpido`. El campo existe porque un mensaje truncado por un cierre abrupto es indistinguible de uno corto sin él. Persistence está en modo `debounced` a 300 ms desde la Escena 1.1, así que una ráfaga de tokens produce una escritura y no una por token.

## Desplazamiento automático

Sólo si el usuario ya está cerca del final. La medida se toma **antes** de escribir el token, porque después el contenido ya creció y diría que el usuario se quedó atrás cuando estaba al día.

## Deuda registrada

**`RECONCILIACION-CON-CLAVE`** (`PHASE_1_DEFERRED.md`). Los cambios
estructurales —añadir un mensaje, abrirlo, cerrarlo— reconstruyen la lista
entera en vez de tocar sólo lo que cambió. No afecta al streaming, que ya es
incremental, pero un turno de conversación cuesta tres reconstrucciones: 3.6 ms
a 50 mensajes, 31 ms a 500. Se resuelve en la Escena 1.5, donde la widget
factory debe descubrir el patrón de reconciliación con cuatro widgets delante
en vez de uno.

## Fuera de alcance

- **Composer y navegación.** Escena 1.4.
- **Render enriquecido.** Markdown, resaltado y LaTeX están diferidos por el scope congelado del roadmap §1.3.
- **Provider real.** Escena 1.6. El mock ya tiene la interfaz que tendrá el real: sustituirlo debe ser cambiar un import.
- **Widget factory.** Escena 1.5, y se descubre entonces.

## Verificación

- 53/53 verdes en `validar-mensajes.mjs`
- 56/56 verdes en `mensajes.test.html`, en navegador y sin caché
- Meter `texto` en la firma estructural pone tres aserciones en rojo
- La medición en navegador confirma que `BRIDGE-REACTIVE` sigue diferido: peor caso 0.578 ms por token, el 3.6 % del presupuesto de fotograma

El harness cede el hilo entre mediciones y pinta las tablas de forma
progresiva. Las mediciones fuerzan layout a propósito —es la única forma de
medir su coste real— y sin ceder bloqueaban la página unos tres segundos, con
el correspondiente aviso de reflow forzado del navegador. Medir con honestidad
no obliga a congelar la interfaz.
