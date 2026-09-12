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
