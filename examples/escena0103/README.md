# Escena 1.3 — Mensajes con streaming simulado

**Fase:** 1 (chatbot sobre Nexus)
**Estado:** implementada, pendiente de corrida en navegador
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

Lo que Node **no** puede medir es el coste del repintado, porque no hace layout. Esa medición vive en el harness de navegador y fuerza layout explícitamente en cada iteración. Es la que decide si la separación de suscripciones era necesaria o sólo prudente.

## La aserción central

El DOM resultante es idéntico se haya llegado a él reconstruyendo la lista o escribiendo un nodo. Ninguna aserción sobre la salida distingue los dos casos — disciplina D-7.

El widget expone un contador de reconstrucciones. Las aserciones fijan que abrir un mensaje reconstruye una vez, cerrarlo una más, y el streaming intermedio ninguna.

Meter `texto` en la firma estructural —el error natural, porque parece más correcto comparar todo— pone tres aserciones en rojo.

## Estado del mensaje

`completo`, `en-vuelo`, `interrumpido`. El campo existe porque un mensaje truncado por un cierre abrupto es indistinguible de uno corto sin él. Persistence está en modo `debounced` a 300 ms desde la Escena 1.1, así que una ráfaga de tokens produce una escritura y no una por token.

## Desplazamiento automático

Sólo si el usuario ya está cerca del final. La medida se toma **antes** de escribir el token, porque después el contenido ya creció y diría que el usuario se quedó atrás cuando estaba al día.

## Fuera de alcance

- **Composer y navegación.** Escena 1.4.
- **Render enriquecido.** Markdown, resaltado y LaTeX están diferidos por el scope congelado del roadmap §1.3.
- **Provider real.** Escena 1.6. El mock ya tiene la interfaz que tendrá el real: sustituirlo debe ser cambiar un import.
- **Widget factory.** Escena 1.5, y se descubre entonces.

## Verificación

- 53/53 verdes en `validar-mensajes.mjs`
- 56 aserciones en el harness de navegador, pendiente de corrida
- Meter `texto` en la firma estructural pone tres aserciones en rojo
- La medición del DOM en navegador es el registro que confirma o revisa la decisión sobre `BRIDGE-REACTIVE`
