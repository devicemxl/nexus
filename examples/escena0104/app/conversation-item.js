/**
 * Behavior `conversation-item` — Escena 1.2.
 *
 * Una fila de la lista. Chunklet anidado: lo monta `conversation-list`, pero
 * su ciclo de vida es independiente y su contexto es propio.
 *
 * Es el primer sitio donde se ve la forma que WIDGET-COMPOSITION querrá
 * resolver: la fila necesita la entidad que le corresponde y además reaccionar
 * a estado de interfaz sobre esa misma entidad. Hoy son dos accesos distintos
 * — `ctx.entity(id)` contra nebula y `subscribeSelector` contra Pulsar — y
 * el widget los cose a mano.
 */

export function conversationItem(elemento, ctx) {
  const id = elemento.dataset.entity;

  if (!id) {
    // Sin identidad no hay nada que representar. No es un error del sistema:
    // es una fila mal construida, y avisar es más útil que lanzar porque el
    // resto de la lista sigue siendo válida.
    console.warn('[conversation-item] elemento sin data-entity, se omite');
    return;
  }

  const zonaTitulo = elemento.querySelector('[data-zona="titulo"]');

  // Lectura del modelo. nebula no es reactivo por contrato, así que esto
  // es una foto del momento del montaje. Cuando el título cambia, quien
  // repinta es `conversation-list`, que sí está suscrito a la proyección.
  const entidad = ctx.entity(id);
  if (entidad && zonaTitulo && !zonaTitulo.textContent) {
    zonaTitulo.textContent = entidad.properties.titulo || '(sin título)';
  }

  // La selección es estado de interfaz, no de dominio: vive en `ui.*`
  // (Nexus Contract §5.1). Cada fila observa si le toca a ella, en vez de
  // que un coordinador central reparta clases.
  ctx.subscribeSelector(
    (estado) => estado.ui?.activeConversation === id,
    (activa) => {
      elemento.classList.toggle('activa', activa);
      elemento.setAttribute('aria-selected', activa ? 'true' : 'false');
    },
    { immediate: true }
  );

  ctx.listen(elemento, 'click', () => {
    ctx.setState({ ui: { ...ctx.getState().ui, activeConversation: id } });
  });

  // Teclado: la fila es un elemento interactivo y debe poder alcanzarse sin
  // ratón. `Enter` y `Espacio` son las teclas que el rol espera.
  ctx.listen(elemento, 'keydown', (evento) => {
    if (evento.key === 'Enter' || evento.key === ' ') {
      evento.preventDefault();
      ctx.setState({ ui: { ...ctx.getState().ui, activeConversation: id } });
    }
  });
}

export default conversationItem;
