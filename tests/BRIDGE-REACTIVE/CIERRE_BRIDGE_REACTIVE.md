# Cierre de `BRIDGE-REACTIVE`

**Fase:** 1
**Estado:** plan, previo a implementación
**Ítem que cierra:** `BRIDGE-REACTIVE` (`PHASE_0_DEFERRED.md`)
**Camino:** 2 (escaneo completo sólo en `delete`)
**Testigo:** widget de reloj de sesión, andamio temporal


## 1. Punto de partida

El desperdicio es conocido y ya está cuantificado. Fase 0 lo midió como
proporción —73 % de ruido reactivo con N=8— y la Escena 1.3 lo midió como coste
absoluto: 0.485 ms por token a 1000 entidades, el 3 % del presupuesto de
fotograma. Con ese dato el ítem se mantuvo diferido, correctamente.

La Fase 0 de este plan **no descubre nada**. Declara lo que ya se sabe en una
forma que un test pueda mirar, y deja un testigo montado mientras se recorre la
ruta. Esa es toda su función.

Lo que se declara es esto: el Bridge snapshot llama a `nebula.get` para las N
entidades en cada mutación, así que todas cambian de referencia aunque su
contenido no haya cambiado. Un consumidor suscrito a `entities[X]` despierta
ante cualquier mutación del grafo.


## 2. Por qué recorrer la ruta ahora

La Escena 1.3 difirió el ítem porque el coste absoluto era tolerable, y lo sigue
siendo en el rango actual. Lo que ha cambiado no es el coste sino lo que se sabe
sobre cómo se paga.

El widget de mensajes salió correcto porque se pensó: dos suscripciones, una
firma estructural que excluye el texto y otra al contenido en vuelo. Esa
separación no fue una optimización elegida, fue la única forma de que el
streaming funcionara con el Bridge actual. Dicho de otro modo, el Bridge
snapshot impone una disciplina a cada consumidor de `entities.*`, hay que
recordarla en cada widget, y cuando se olvida no falla: trabaja de más, en
silencio.

La Escena 1.5 va a construir una widget factory, es decir, va a multiplicar los
consumidores de `entities.*` y a fijar en un helper la forma en que se
suscriben. Fijar esa forma con la disciplina incorporada dentro es lo que
conviene evitar, porque después se arrastra.

Ése es el argumento, y es de diseño. Si al terminar la migración la medición de
§5 no lo acompaña, ver §7.


## 3. El testigo

Un reloj de sesión en la cabecera: segundos transcurridos desde que se creó la
conversación activa.

**Es andamio, no funcionalidad.** Va marcado como tal en `index.html` y en
`boot.js`, igual que el disparador del mock de la Escena 1.3, y se retira de una
pieza. Ver §9.

### 3.1 Restricción de diseño que no es opcional

El selector tiene que devolver **la entidad**, no un valor derivado de ella:

```js
// Suscripción 1 — la entidad. Es la que despierta de más hoy.
ctx.subscribeSelector(
  (estado) => {
    const activa = estado.ui?.activeConversation;
    return activa ? (estado.entities[activa] || null) : null;
  },
  (entidad) => {
    invocaciones++;
    inicio = entidad?.properties?.creadaEn ?? null;
  },
  { equality: Object.is }
);

// Suscripción 2 — el reloj avanza con el tick, no con la entidad.
ctx.subscribeSelector(
  (estado) => estado.ui?.tick ?? null,
  () => {
    const segundos = inicio ? Math.floor((Date.now() - inicio) / 1000) : 0;
    const texto = String(segundos);
    if (span.textContent !== texto) span.textContent = texto;
  }
);
```

Un selector que devuelva los segundos no distingue nada: `Object.is(3, 3)` es
`true` y el listener no dispara con ningún Bridge. El test quedaría verde
siempre. Lo único que separa a los dos Bridges es la referencia del objeto
entidad, así que es lo que el selector tiene que devolver.

### 3.2 Modo medición

`data-modo="medicion"` desactiva el `setInterval` del tick; sin eso el reloj
ensucia la ventana del test con sus propias notificaciones. El contador se
expone en `widget.__instrumento` para consola y para el test.

El widget se monta como cualquier otro behavior. No hay rama especial en
Chunklet.


## 4. Alcance congelado

**Dentro.** El testigo. La migración de los siete métodos de mutación del Bridge
a proyección acotada. Los dos tests de comportamiento. La reejecución de los
arneses. La actualización documental que el cambio obliga.

**Fuera.** Tocar el contrato del Bridge, de Pulsar o de nebula. Si en algún
momento parece que el reactivo exige cambiar el contrato de una primitiva, el
plan se ha salido de alcance y hay que parar: la firma pública del Bridge no
cambia, sólo su estrategia interna de proyección.

**Fuera también.** `RECONCILIACION-CON-CLAVE`. Toca los mismos widgets de lista
y tiene su momento en la Escena 1.5. Mezclarlos hace que un rojo no diga cuál de
los dos cambios lo causó.


## 5. Lo que se mide al recorrer la ruta

El contador del testigo cuenta invocaciones, que es la proporción ya conocida
dicha de otra manera. La magnitud que de verdad cambia es otra.

`_reprojectAll` produce N entidades frescas en cada mutación. Ninguna está
congelada, así que `setState` con `freeze: true` recorre y congela las N
completas: objeto, `properties`, `links`, y cada array de targets. Con
`_projectEntity`, las N−1 preservadas ya están congeladas y `_deepFreeze` corta
en `Object.isFrozen`.

| magnitud por mutación | snapshot | reactivo |
|---|---|---|
| llamadas a `nebula.get` | N | 1 |
| entidades recorridas por `deepFreeze` | N | 1 |
| listeners de entidad invocados | N | 1 |
| punteros copiados en el spread de `entities` | N | N |

Es la misma mecánica que la Escena 1.1 encontró dentro del cuadrático del
arranque, manifestada por mutación en vez de por hidratación.

**Instrumento.** `medir-streaming.mjs`, que ya produce la tabla de coste por
token contra el número de entidades. Correrla antes y después con las magnitudes
de la Escena 1.3 (10, 50, 200, 500, 1000). Si el número de entidades está
cableado, parametrizarlo es lo primero de la Fase 0.

Fiable en entorno sustituto por la razón que la Escena 1.3 ya argumentó: es
JavaScript puro, sin DOM, sin layout, sin pintado. Lo que Node no mide es el
repintado, y aquí no hay repintado que medir — el DOM resultante es idéntico con
los dos Bridges.


## 6. Fases

### Fase 0 — Declarar el punto de partida

Testigo montado, contador expuesto, modo medición operativo. Se registran dos
cifras de partida: invocaciones del reloj de B con 100 tokens en A (se espera
~100), y la tabla de §5 con el Bridge snapshot.

**Checkpoint.** Con la consola abierta y un stream en otra conversación,
`invocaciones` sube sin que el valor visible del reloj cambie. El desperdicio
conocido está a la vista antes de escribir un solo test.

#### Línea base registrada

Medida contra el código real. Node (`bench-proyeccion.mjs`, mediana de 15
corridas de 200 tokens tras warmup) y navegador (`reloj-sesion.baseline.html`)
coinciden en las magnitudes que ambos pueden ver.

| N entidades | `get`/mutación | `Object.freeze`/mutación | invocaciones del testigo | ms/mutación |
|---|---|---|---|---|
| 10 | 10 | 32 | 200 de 200 | 0.019 |
| 50 | 50 | 152 | 200 de 200 | 0.033 |
| 200 | 200 | 602 | 200 de 200 | 0.113 |
| 500 | 500 | 1502 | 200 de 200 | 0.278 |
| 1000 | 1000 | 3002 | 200 de 200 | 0.580 |

Exponente de crecimiento de ms/mutación al multiplicar N: 0.33 / 0.89 / 0.98 /
1.06. Converge a lineal. Los 0.580 ms a N=1000 concuerdan con los 0.485 ms que
midió la Escena 1.3, lo que da confianza en que el instrumento mide lo mismo.

**`Object.freeze` son 3N+2 por mutación**, no N: tres objetos congelados por
entidad —el objeto, su `properties`, su mapa `links`— más el estado raíz y el
mapa `entities`. Es la magnitud que más debería caer con el Camino 2, porque
las N−1 preservadas ya están congeladas y `_deepFreeze` corta en
`Object.isFrozen`.

**En el navegador, con el testigo montado y B activa:** 100 tokens en A
producen **100 invocaciones y 0 repintados**. Ésa es la cifra de partida que
conviene citar, no el 100 a secas: el reloj despertó cien veces e hizo trabajo
útil cero veces.

La coincidencia entre Node y navegador no valida a Node en general. Valida que
esta magnitud concreta existe en los dos, que es lo que D-5 pide comprobar
antes de medir.

#### Corrección al complementario, descubierta al declarar la base

El control tal como lo redactaba §6/Fase 1 no discrimina. Con A activa y 100
tokens en un mensaje de A, el testigo también sube a 100 — pero no porque
`conversation:A` haya cambiado, sino por la reproyección completa. Los tokens
van al mensaje, no a la conversación. Después del arreglo esa cifra bajará a 0
igual que la otra, y el test dejaría pasar un Bridge que simplemente no
notifica.

**El complementario tiene que mutar la conversación observada**, no un mensaje
suyo: renombrar `conversation:A` con A activa, y afirmar que el testigo
despierta. Es la única forma de que el par de tests distinga "no despierta de
más" de "no despierta nunca".

Que el navegador mostrara el reloj pasando de 9 s a 42 s al cambiar la
conversación activa es la evidencia de que ese camino existe y funciona.

### Fase 1 — Rojo

```
Dadas dos conversaciones A y B, con B activa y el tick congelado
Cuando se lanzan 100 tokens en A
Entonces las invocaciones del reloj de B no cambiaron
```

Y su complementario, que es el que impide que un Bridge roto pase. Corregido
respecto al enunciado original por lo hallado en la Fase 0: tiene que mutar la
conversación observada, no un mensaje suyo.

```
Dada A activa y el tick congelado
Cuando se renombra conversation:A
Entonces las invocaciones del reloj de A sí cambiaron
```

La cifra de partida va en un comentario del test. D-6: la aserción se ve fallar
antes de escribir el arreglo, y se anota cuántas enrojecen.

#### Resultado registrado

Contra el Bridge snapshot: **1 roja de 4 aserciones**, y es T1 (100
invocaciones donde se esperan 0). T2 ya está verde, porque renombrar la
conversación observada despierta al testigo también hoy.

Que T2 nazca verde no la hace decorativa, pero obliga a demostrar que puede
fallar. La matriz de falsación lo hace con un "Bridge mudo", que no necesita
código falso: destruir el Bridge deja la proyección congelada y produce
exactamente esa conducta.

| Bridge | T1 / T2 | invocaciones T1 | invocaciones T2 |
|---|---|---|---|
| snapshot (actual) | ROJO / verde | 100 | 1 |
| mudo (no notifica nunca) | verde / ROJO | 0 | 0 |
| reactivo (objetivo) | verde / verde | 0 | ≥1 |

Cada modo de fallo enrojece una aserción distinta, y ninguna de las dos pasa
por sí sola: un Bridge que dejara de notificar pasaría T1 y caería en T2. Ésa
es la propiedad que hacía falta antes de tocar la proyección.

### Fase 2 — Migración por método

**2a — `put`, `upsert`, `update`.** Conocen el id por argumento.
`_projectEntity(id)` sustituye a `_reprojectAll()`.

**2b — `link`, `unlink`, `unlinkAll`.** Mutan los links del source.
`_projectEntity(sourceId)`, conservando la detección de no-op: si
`_sameShallowLinks(before, after)`, no se proyecta nada.

**2c — `delete`.** El único que no conoce a todos los afectados. Escaneo O(N) de
entidades con links entrantes hacia `id`, antes de borrar, y
`_projectMany([id, ...afectados])` en un solo `setState`.

Orden dentro del wrapper, que hay que escribir explícitamente:

1. Escanear y capturar la lista de afectados.
2. `next(id)`.
3. Proyectar **sólo si (2) retornó**.

`nebula.delete` lanza si la entidad no existe. Con `_reprojectAll` esto era
gratis porque nunca se llegaba a proyectar. Con la lista capturada de antemano
es fácil proyectar un borrado que no ocurrió y dejar Pulsar describiendo un
grafo distinto del real.

El test pasa al terminar 2a, porque 100 tokens son 100 `update`. **No es el
cierre.** La propiedad tiene que ser uniforme en los siete métodos, o el
siguiente widget la encontrará rota en la rama que nadie migró.

#### Resultado registrado

**Comportamiento.** T1 pasa a verde sin tocar T2: 4/4 en `validar-reloj.mjs`.
La batería específica de los siete métodos da **32/32** en
`validar-bridge-reactivo.mjs`, cubriendo sync inicial, `skipInitialSync`, los
no-op de G-0, el `delete` con afectados, el `delete` que lanza, el `path`
punteado (R3) y la coherencia del mapa con `nebula.allIds()`.

**D-6 sobre la batería nueva.** Tres mutaciones deliberadas, y qué enrojece
cada una:

| mutación | rojas | cuáles |
|---|---|---|
| `delete` olvida a los afectados | 2 | el link colgante y la coherencia con `nebula.get` |
| `delete` proyecta antes de delegar | 6 | las cuatro de `delete`, más las dos de coherencia |
| `link` vuelve a `_reprojectAll` | 2 | preservación de referencia del target y de los ajenos |

Las dos de los extremos están bien particionadas. La del medio enrojece seis
porque proyectar antes de delegar no rompe una propiedad sino la semántica
entera de `delete`: la entidad sigue existiendo en el momento de proyectar, así
que el borrado no se refleja. Seis es honesto ahí, no señal de aserciones
dependientes.

**Medición.** Las tres magnitudes que el Camino 2 debía comprar, compradas:

| magnitud por mutación | snapshot | reactivo |
|---|---|---|
| `nebula.get` | N | **1** |
| `Object.freeze` | 3N+2 | **5** |
| invocaciones del testigo (200 tokens) | 200 | **0** |
| ms/mutación a N=1000 | 0.580 | 0.429 |

**El tiempo mejora sólo un 26 % a N=1000, y eso merece explicación.** Quedan
dos costes O(N) que el Camino 2 no toca y que ahora dominan:

1. El spread `{...actuales}` copia N punteros. Es inevitable sin romper la
   inmutabilidad de Pulsar, y el plan ya lo anticipaba.
2. **`_deepFreeze` sigue recorriendo N claves aunque sólo congele 5.** El mapa
   `entities` nuevo no está congelado, así que `_deepFreeze` lo congela e itera
   sus N claves; cada hija ya está congelada y la guarda `Object.isFrozen`
   corta de inmediato. Congelar cayó a O(1); **recorrer sigue siendo O(N)**.

El contador de `Object.freeze` no veía el punto 2, porque cuenta congelados y
no visitas. Es un recordatorio de que un contador mide lo que cuenta y no lo
que uno cree que cuenta.

Nada de esto invalida el cierre: `BRIDGE-REACTIVE` era sobre ruido reactivo, y
el ruido pasó de 200 de 200 a 0 de 200. Pero confirma que la frase "O(1)" del
registro de deuda hay que corregirla en los términos de la Fase 4, y con más
razón de la prevista.

### Fase 3 — Arneses, en dos corridas separadas

Las dos variables no se mezclan; un rojo tiene que decir cuál de los dos cambios
lo causó.

**3a — Adapters encadenados contra el Bridge snapshot.** Reejecutar los cinco
arneses de Fase 0 contra las versiones encadenadas y registrar el conteo
canónico nuevo. Esto cierra `CHAIN-HARNESS-PORT`, que es independiente de este
plan y no debe quedar colgando de él.

**3b — Bridge reactivo contra la línea base de 3a.** Una sola variable en
movimiento.

Qué mirar en 3b: Persistence observa nebula, no Pulsar, así que no debería
cambiar. Logging observa ambos: la frecuencia de eventos de Pulsar no cambia
—sigue habiendo un `setState` por mutación— pero el contenido sí. Cualquier
aserción que dependiera de ver la proyección completa en cada evento va a
enrojecer, y enrojecer ahí es correcto.

### Fase 4 — Registro canónico y documentos

**Test canónico.** La propiedad "el Bridge preserva la referencia de las
entidades no afectadas" pasa a `nebula-pulsar-bridge.test.html`, en términos de
la primitiva. Es la forma que sobrevive a la retirada del testigo.

**Invertir TEST 13.** El arnés del Bridge lo tiene escrito como test
aspiracional. Pasar la versión invertida es la evidencia empírica del arreglo, y
es el momento para el que se escribió.

**Documentos que dejan de ser ciertos el mismo día:**

| Documento | Qué cambia |
|---|---|
| `PHASE_0_DEFERRED.md` | `BRIDGE-REACTIVE` a *Closed After Phase 0*: camino tomado, medición antes/después, corrección del "O(1)" |
| `nebula-pulsar-bridge.spec.md` §7 | Describe entera la implementación snapshot y sus dos diferencias con la reactiva. Deja de aplicar |
| `nebula-pulsar-bridge.spec.md` §3 | Deja de ser la versión correcta aspiracional y pasa a describir el código |
| `Nexus_Adapter_Contract_Specification.md` §5.2 | Afirma que la implementación inicial es snapshot-based. Es lo primero que lee alguien de fuera |

**La corrección del "O(1)".** El texto actual dice que todos los métodos salvo
`delete` son O(1). No lo son: `{...actuales, [id]: entidad}` copia N punteros y
no hay forma de evitarlo sin romper la inmutabilidad de Pulsar. Lo que el Camino
2 compra es invocaciones de listener, llamadas a `get` y trabajo de congelado por
mutación, no trabajo total. Corregir la frase antes de cerrar, no después.


## 7. Riesgos y condición de abandono

**R1 — Desincronización silenciosa.** El snapshot garantizaba por construcción
que `entities` coincidía con `nebula.allIds()`. El reactivo depende de que cada
mutación pase por el wrapper. Quien guardó `const put = nebula.put` antes de
instalar el Bridge tiene el método original y lo sigue teniendo;
`adapter-chain.js` no cierra eso porque no puede.

*Mitigación, sin API nueva.* La reconciliación completa ya existe:
`bridge.destroy()` más un `createNebulaPulsarBridge` nuevo con
`skipInitialSync: false` hace un barrido completo. `_reprojectAll` se conserva
**sólo** para la sincronización inicial, que es donde siempre fue correcto.
Anotar el efecto secundario: recrear el Bridge lo deja como wrapper más externo
de la cadena, así que cambia el orden de emisión respecto a Persistence y
Logging.

**R2 — Cascadas futuras.** Si algún día `delete` de una conversación arrastra
sus mensajes, hay que extender `_projectMany` y no volver a `_reprojectAll` por
comodidad. Documentarlo en la spec, no confiarlo a la memoria.

**R3 — `path` punteado.** El Bridge acepta `path: 'domain.entities'`. La versión
por entidad toca el mapa directamente y es fácil saltarse un nivel. `_setByPath`
ya preserva las otras claves bajo `domain`, pero hace falta un test específico
porque el reactivo ejercita esa ruta de otra manera.

**Condición de abandono.** Si al terminar 2c la tabla de §5 no mejora y el
argumento de §2 no se sostiene en revisión, se revierte y el ítem vuelve a
diferirse con la tabla nueva anexada. Un plan sin condición de abandono se
ejecuta igual salga lo que salga, y entonces medir en la Fase 0 es decorativo.


## 8. Definición de cerrado

1. Con B activa y 100 tokens en A, las invocaciones del reloj de B no cambian.
2. Con A activa, renombrar `conversation:A` sí hace cambiar las invocaciones
   del reloj de A.
3. Los siete métodos de mutación proyectan por entidad o por conjunto acotado.
   Ninguna **ruta de mutación** llama a `_reprojectAll`; la sincronización
   inicial sí lo hace, y eso es correcto.
4. TEST 13 invertido y verde en `nebula-pulsar-bridge.test.html`.
5. La tabla de §5 medida antes y después, registrada diga lo que diga.
6. Los cuatro documentos de la Fase 4 actualizados, incluida la corrección del
   "O(1)".


## 9. Retirada del testigo

El testigo se retira al cerrar la Fase 4, cuando la propiedad ya vive en el
arnés canónico. Se quita de una pieza: el behavior, su registro en `boot.js`, su
marca en `index.html` y el test de app que lo acompaña.

Lo que se conserva es el test de `nebula-pulsar-bridge.test.html` y la tabla de
§5. Ésa es la forma durable de lo que el testigo demostró, y no depende de que
el reloj siga existiendo ni de que la aplicación mantenga una cabecera.

Conservarlo apagado "por si acaso" es la opción tentadora y no la recomiendo: un
andamio que se queda deja de estar marcado como andamio en cuanto pasa un mes, y
entonces alguien lo mantiene, lo estiliza, o lo hereda un widget nuevo. Si más
adelante hace falta una guardia contra regresiones del Bridge, la forma correcta
es una aserción en el arnés, no un widget vivo en la cabecera.
