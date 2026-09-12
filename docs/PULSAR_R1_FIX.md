# Fix R-1 — Coherencia de `previousValue` bajo reentrada

**Primitiva:** PulsarJS
**Código:** v0.2.1 → v0.2.2
**Contrato:** v0.2.0 (sin cambio de API; ver §6 para la adición propuesta)
**Naturaleza:** corrección de defecto, no capacidad nueva
**Evidencia:** harness `pulsar-r1.test.html`, 33/33 verdes; 26/33 al revertir


## 1. Causa raíz

En `_notify`, la rama de selector listeners capturaba tres valores antes de
invocar al listener y escribía uno de vuelta después:

- `currentValue` se evaluaba **una vez por selector**, fuera del bucle de listeners.
- `previousValue` se desestructuraba del **snapshot** del registro.
- La escritura de `previousValue` ocurría **después** de que el listener retornaba.

Mientras ningún listener mute el estado, las tres cosas son equivalentes a
leerlas en vivo. En cuanto un listener dispara un `setState` reentrante, el
frame externo trabaja sobre una foto vencida y la escribe encima de lo que la
reentrada dejó correcto.


## 2. Síntomas observados

Los tres salen de la misma causa. Cada uno tiene su aserción en el harness.

**(a) Sobrescritura obsoleta.** La reentrada avanza `previousValue` correctamente;
al desenrollarse, el frame externo lo pisa con el valor que capturó antes. El
registro queda describiendo un estado que ya no existe, y el siguiente `setState`
con un valor idéntico al actual dispara una notificación espuria.

**(b) `previousValue` desactualizado en la reentrada.** La llamada anidada recibe
como `prev` el valor de dos transiciones atrás en vez del inmediato anterior.
Encadenando reentradas el efecto se agrava: con tres saltos, la versión anterior
entregaba `[[1,0],[2,0],[3,0]]` — todos los `prev` clavados en el valor inicial.

**(c) `currentValue` obsoleto en multi-listener.** Con dos listeners sobre el
mismo selector (misma referencia de función), si el primero reentra, el segundo
recibe en el frame externo el valor previo a la mutación. Entrega fuera de orden:
la versión anterior le daba `x=3` y **después** `x=2`.


## 3. Corrección

Tres cambios dentro del bucle de listeners, sin tocar la API:

1. **Leer la entrada viva del registro**, cayendo al snapshot solo si el listener
   se desuscribió durante la pasada. Resuelve (a) y (b).
2. **Evaluar el selector por listener** en vez de una vez por grupo. Resuelve (c).
3. **Avanzar `previousValue` antes de invocar** al listener, para que la
   notificación anidada parta del valor correcto. Cierra (a) y (b).

Ver `pulsar.js` v0.2.2, método `_notify`.


## 4. Lo que deliberadamente no cambia

Dos asimetrías del diseño anterior se preservan, y hay aserciones que las fijan
para que un refactor futuro no las mueva por accidente:

- **Un listener desuscrito durante la pasada aún se invoca.** Es la semántica de
  snapshot que el contrato §6 ya establece. El fix cae al snapshot precisamente
  para no alterarla.
- **Un listener que lanza igualmente avanza su `previousValue`.** En v0.2.1 la
  escritura estaba fuera del `catch`; el fix la mueve antes de la invocación, lo
  que produce el mismo resultado observable.


## 5. Compensación aceptada

El selector pasa a evaluarse una vez por listener en lugar de una por grupo. Solo
cuesta cuando varios listeners comparten **la misma referencia** de función
selector; los selectores por ruta string generan un closure nuevo en cada
`subscribeSelector`, así que nunca comparten registro. Los selectores son puros y
baratos por contrato (§5.3), y la corrección de la entrega vale más que evitar
una evaluación redundante en un caso poco frecuente.

Efecto lateral menor: un selector que lanza con N listeners registrados produce N
entradas en consola en vez de una.


## 6. Adición aplicada al contrato

El defecto existía porque el contrato no obligaba a nada en este punto. Se
añadió una fila a `PulsarJS_Contract_Specification.md` §6 y el contrato subió a
v0.2.1 (patch, solo documentación):

> | **Reentrancy value coherence** | If a `subscribeSelector` listener triggers a `setState` during `_notify`, the nested notification receives as `previousValue` the value immediately preceding it, and the outer frame does not overwrite the advance made by the reentrant call. Remaining listeners of the same selector are evaluated against the post-mutation state. The sequence of values delivered to any single listener is monotonic with respect to the actual order of transitions. |

Describe lo que el código hace desde `pulsar.js` v0.2.2. La fila hace explícita
una promesa que antes vivía solo en la implementación, para que un refactor
futuro no pueda regresar silenciosamente.


## 7. Sobre un cuarto defecto sospechado y descartado

Al revisar `_notify` noté que el bucle externo itera `this._selectorListeners`
en vivo, sin snapshot, mientras que la rama de listeners globales sí snapshotea.
Aparentaba contradecir la garantía de reentrancy del contrato §6.

Se intentaron tres reproducciones: suscribir un selector nuevo durante la pasada
y mutar después, mutar y suscribir después, y suscribir desde un listener global.
Ninguna produjo una invocación indebida. La razón es que `subscribeSelector` fija
su `previousValue` contra el estado del momento de suscripción, y el check de
equality actúa como guarda natural: cuando el bucle externo alcanza el registro
nuevo, el valor no ha cambiado y el listener no se invoca.

**No es observable, no se corrige.** Registrado además en
`PHASE_0_DEFERRED.md` bajo la sección **Not Debt (Recorded for Clarity)** con
el identificador `PULSAR-SELECTOR-REGISTRY-SNAPSHOT`, para que la próxima
lectura del código no vuelva a gastar el tiempo y para que si un refactor
futuro remueve la fijación del baseline en `subscribeSelector`, esta
observación deje de estar cerrada.


## 8. Alcance del cambio en Chunklet

`chunklet.js` pasa a v0.4.1 con dos adiciones **solo de comentario**, verificadas
por diff:

- `_enabledUnsubscribe` se declara explícitamente como retenido a propósito para
  el futuro `Chunklet.reset()` del Contract §12, no como cabo suelto.
- `configure({ graphlet })` documenta que no recablea los adapters vivos: siguen
  envolviendo la instancia anterior y la nueva queda sin observar. Chunklet no
  puede resolverlo solo porque, por el Adapter Contract §2, no conoce a los
  adapters ni puede enumerarlos. La aplicación es responsable de destruirlos y
  reinstanciarlos.


## 9. Evidencia

| Instrumento | Resultado |
|---|---|
| `pulsar-r1.test.html` contra v0.2.2 | 33/33 verdes |
| `pulsar-r1.test.html` contra v0.2.1 | 26/33 — los 7 rojos son el grupo R-1 |
| Batería de equivalencia v0.2.1 vs v0.2.2, 30 casos | 28 idénticos, 2 divergencias esperadas, **0 regresiones** |
| `diff` de `chunklet.js` | solo comentarios |

La batería de equivalencia corrió ambas versiones sobre los mismos 30 casos y
comparó trazas. Las dos únicas divergencias son los síntomas de R-1. Es la
evidencia de que el fix no arrastró daño colateral.

Node se usó como instrumento de verificación previa porque `pulsar.js` no tiene
dependencias de browser. El harness canónico sigue siendo el HTML browser-native,
y es el que hay que correr para el registro.
