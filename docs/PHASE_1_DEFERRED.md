# Deuda diferida — Fase 1

**Estado:** documento vivo, abierto durante la Escena 1.3
**Alcance:** deuda técnica generada durante la Fase 1 (chatbot sobre Nexus)

Sigue la misma regla que `PHASE_0_DEFERRED.md`: ningún ítem queda como
"pendiente de ver". Cada uno lleva la evidencia que lo motiva y el punto donde
se resuelve. Si no se puede escribir el camino de resolución, el ítem no está
listo para diferirse.

---

## Ítems diferidos

### RECONCILIACION-CON-CLAVE — reconstrucción total en los widgets de lista

**Qué es.** `conversation-list` y `conversation-messages` reconstruyen su lista
entera ante cualquier cambio estructural: vacían el contenedor, clonan la
plantilla por cada elemento y remontan los Chunklets anidados. No hay
comparación con lo ya pintado.

**Qué NO es.** Esto no afecta al streaming. El texto del mensaje en vuelo se
escribe de forma incremental sobre un solo nodo, y hay aserciones que fijan que
los tokens no provocan ninguna reconstrucción. La deuda está en los cambios
estructurales: añadir un mensaje, abrirlo y cerrarlo.

**Evidencia.** Medido en navegador durante la Escena 1.3, coste de una
reconstrucción completa según el número de mensajes en pantalla:

| mensajes | una reconstrucción | por turno de conversación (3) |
|---|---|---|
| 10 | 0.30 ms | 0.9 ms |
| 50 | 1.19 ms | 3.6 ms |
| 200 | 4.22 ms | 12.7 ms |
| 500 | 10.41 ms | 31.2 ms |

Un turno de conversación produce tres reconstrucciones: al añadir el mensaje
del usuario, al abrir el del asistente y al cerrarlo. Las tres podrían ser
incrementales — añadir es insertar un nodo al final, cerrar es cambiar un
atributo.

El crecimiento es lineal con el número de mensajes. A 500 mensajes un turno
consume 31 ms, casi dos fotogramas.

**Por qué se difiere.** La solución es reconciliación con clave: comparar la
lista derivada con la pintada y tocar sólo lo que cambió. Es el patrón que la
Escena 1.5 debe descubrir a partir de los cuatro widgets construidos, no
inventarse ahora para uno solo. Disciplina D-2: dos usos antes de estabilizar
la forma de un helper.

Resolverlo ahora significaría diseñar la reconciliación con dos casos delante
en vez de cuatro, y hacerlo dos veces por separado en vez de una en la factory.

**Dónde se resuelve.** Escena 1.5, consolidación y widget factory. Si al llegar
allí la factory no cubre la reconciliación, este ítem se resuelve igualmente
antes de cerrar la escena.

**Qué lo haría urgente antes.** Que una conversación real supere los doscientos
mensajes durante las Escenas 1.4 o 1.6, o que aparezca estado en el DOM que se
pierda al recrear un nodo — foco, selección de texto, edición en curso,
desplazamiento interno. Ese segundo caso convierte la deuda de coste en
defecto funcional.

**Descubierto.** Escena 1.3, a partir de una observación sobre el alcance del
repintado durante el streaming.

---

### BRIDGE-SYNC — reconciliación completa bajo demanda en el Bridge

**Qué es.** El Bridge no expone hoy una forma de reconciliar toda la
proyección con `nebula.allIds()` sin desmontarlo. La única receta disponible
es `bridge.destroy()` seguido de un `createNebulaPulsarBridge` nuevo con
`skipInitialSync: false`. Funciona, pero es awkward: recrear el Bridge lo
coloca como wrapper más externo de la cadena, así que cambia el orden de
emisión respecto a Persistence y Logging para el resto de la sesión.

Un consumidor que pase `skipInitialSync: true` probablemente espera poder
disparar "proyecta todo ahora" en algún momento posterior. Hoy no tiene esa
capacidad más que a través de la receta.

**Qué NO es.** No es un bug del Bridge reactivo. La proyección refleja
correctamente cada mutación que atraviesa el wrapper; lo que falta es la vía
para reconciliar el conjunto tras un `skipInitialSync` o tras cualquier
operación que puentee la cadena.

**Descubierto.** Al correr `graphlet-pulsar-bridge_test.html` contra el
Bridge v0.3.0. El TEST 2 afirmaba "la proyección incluye TODAS las entidades
tras la primera mutación", que era efecto lateral de la implementación
snapshot, no propiedad del contrato. Se reescribió (v0.2.0 del arnés) para
afirmar sólo lo que el contrato garantiza — la mutación proyecta la entidad
tocada — y el hueco pasó aquí.

**Por qué se difiere.** Es una adición no breaking al contrato del Bridge, y
merece pensarse con más de un caso de uso antes de fijar la forma. Dos
candidatas de partida:

- Un método `bridge.sync()` que reproyecte todo, equivalente a un
  `_reprojectAll` público. Simple, resuelve el escenario post-
  `skipInitialSync` y el de reconciliación tras un puenteo. La cadena queda
  como está.
- Una opción `syncOn: 'firstMutation'` que la primera mutación tras
  `skipInitialSync: true` haga un reproject completo en lugar de por entidad.
  Preserva la conducta que el TEST 2 daba por sentada, pero introduce dos
  modos en el mismo camino de código y hace que el coste de la primera
  mutación dependa del tamaño del grafo, en silencio.

La primera es más fácil de justificar. La segunda respeta una expectativa
que existía sin haberse pedido, lo cual es doble filo.

**Dónde se resuelve.** Cuando aparezca un segundo caso real que la necesite,
por D-2. El escenario del arnés (probar `skipInitialSync` en un test) no
cuenta como caso real por sí solo. Si un widget de Fase 1 o 2 pasa
`skipInitialSync: true` porque hidrata de otro sitio y luego necesita
reconciliar, ése sí lo activa.

**Qué lo haría urgente antes.** Que un widget o adapter llegue a usar la
receta destroy()+createBridge en producción y esa mudanza a la cadena
produzca efectos observables (un log fuera de orden, una escritura de
Persistence antes de una emisión que debía precederla). Ese día la receta
deja de ser awkward y pasa a ser incorrecta.

