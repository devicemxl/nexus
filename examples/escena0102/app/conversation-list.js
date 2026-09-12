/**
 * Behavior `conversation-list` — Escena 1.2.
 *
 * Renderiza la lista de conversaciones y es dueño del DOM que crea. Monta y
 * desmonta explícitamente los Chunklets `conversation-item` de cada fila:
 * como este widget sabe exactamente cuándo aparece y cuándo se va cada fila,
 * el descubrimiento automático vía `observe` sólo añadiría indeterminismo
 * sobre el momento del montaje (Chunklet Contract §10, "Manual discovery
 * priority").
 */

import Chunklet from '../../../src/chunklet.js';
import { crearConversacion, listarConversaciones, mismasConversaciones } from './modelo.js';

export function conversationList(elemento, ctx) {
  const contenedor = elemento.querySelector('[data-zona="lista"]');
  const plantilla = elemento.querySelector('template[data-plantilla="conversation-item"]');
  const botonNueva = elemento.querySelector('[data-accion="nueva-conversacion"]');
  const vacio = elemento.querySelector('[data-zona="vacio"]');

  if (!contenedor || !plantilla) {
    throw new Error(
      '[conversation-list] falta el contenedor [data-zona="lista"] o la ' +
      'plantilla [data-plantilla="conversation-item"]'
    );
  }

  /** Filas montadas, por id de conversación. */
  let filasMontadas = new Map();

  // ----------------------------------------------------------------
  // Renderizado
  // ----------------------------------------------------------------

  /**
   * Reconstruye la lista completa.
   *
   * Es una reconstrucción total, no un diff con clave. Para una lista de
   * conversaciones — decenas de filas, cambios poco frecuentes — el diff
   * sería complejidad sin evidencia que la justifique. La selección activa
   * no se pierde en el proceso porque no vive en el DOM: cada fila la lee
   * de `ui.activeConversation` al montarse.
   *
   * Si Escena 1.3 o posterior introduce algo que sí se pierda al recrear
   * la fila (foco, edición en curso, scroll interno), eso es la evidencia
   * que justificaría el diff, y hasta entonces no se construye.
   */
  function pintar(lista) {
    desmontarFilas();
    contenedor.textContent = '';

    for (const conversacion of lista) {
      const fragmento = plantilla.content.cloneNode(true);
      const fila = fragmento.querySelector('[data-chunk]');

      if (!fila) {
        console.warn('[conversation-list] la plantilla no contiene un [data-chunk]');
        continue;
      }

      // La identidad viene del modelo y se declara en el DOM. Chunklet nunca
      // genera identificadores (Contract §10); los lee de aquí.
      fila.dataset.entity = conversacion.id;

      const zonaTitulo = fila.querySelector('[data-zona="titulo"]');
      if (zonaTitulo) zonaTitulo.textContent = conversacion.titulo;

      contenedor.appendChild(fragmento);

      // La fila ya está en el documento: montarla ahora es seguro y
      // determinista. El elemento real es el que quedó en el contenedor,
      // no el del fragmento, que ya se vació al insertarse.
      const filaEnDom = contenedor.lastElementChild;
      Chunklet.mount(filaEnDom);
      filasMontadas.set(conversacion.id, filaEnDom);
    }

    if (vacio) vacio.hidden = lista.length > 0;
  }

  function desmontarFilas() {
    for (const fila of filasMontadas.values()) {
      Chunklet.unmount(fila);
    }
    filasMontadas = new Map();
  }

  // ----------------------------------------------------------------
  // Suscripción con firma estable
  // ----------------------------------------------------------------
  //
  // El selector deriva la lista; la `equality` compara sólo los campos que
  // la interfaz pinta. Sin esa comparación, el Bridge re-proyecta el grafo
  // completo en cada mutación (BRIDGE-REACTIVE) y esta lista se repintaría
  // por cada token de un mensaje en streaming, que es lo que llega en
  // Escena 1.3.
  //
  ctx.subscribeSelector(
    (estado) => listarConversaciones(estado.entities),
    (lista) => pintar(lista),
    { equality: mismasConversaciones, immediate: true }
  );

  // ----------------------------------------------------------------
  // Acciones
  // ----------------------------------------------------------------
  if (botonNueva) {
    ctx.listen(botonNueva, 'click', () => {
      const id = crearConversacion(ctx.graphlet);
      // La creación pasa por Graphlet; el repintado llega por el Bridge.
      // Seleccionar es estado de interfaz y va directo a Pulsar.
      ctx.setState({ ui: { ...ctx.getState().ui, activeConversation: id } });
    });
  }

  // ----------------------------------------------------------------
  // Teardown
  // ----------------------------------------------------------------
  //
  // La suscripción y el listener los libera el contexto. Las filas no: son
  // Chunklets que este widget montó a mano, así que este widget los
  // desmonta a mano. Quien adquiere un recurso es responsable de liberarlo.
  //
  ctx.cleanup(() => {
    desmontarFilas();
    contenedor.textContent = '';
  });
}

export default conversationList;
