/**
 * Behavior `conversation-list` — migrado en la Escena 1.5.
 *
 * La reconstrucción manual que tenía este widget se sustituyó por
 * `crearListaDeEntidades`, que reconcilia con clave. Lo que queda aquí es lo
 * que de verdad es propio de las conversaciones: qué lista se deriva, cómo se
 * compara, y qué hace el botón.
 *
 * El widget sigue siendo dueño del DOM que crea: la factory monta y desmonta
 * los Chunklets anidados de cada fila porque sabe exactamente cuándo aparece y
 * cuándo se va cada una.
 */

import { crearListaDeEntidades } from './lista-de-entidades.js';
import { fijarUi } from './zonas.js';
import { crearConversacion, listarConversaciones, mismasConversaciones } from './modelo.js';

export function conversationList(elemento, ctx) {
  const lista = crearListaDeEntidades(elemento, ctx, {
    nombre: 'conversation-list',
    contenedor: 'lista',
    plantilla: 'conversation-item',
    vacio: 'vacio',
    raizDelClon: '[data-chunk]',

    selector: (estado) => listarConversaciones(estado.entities),
    equality: mismasConversaciones,

    zonas: {
      titulo: (conversacion) => conversacion.titulo,
    },

    // Cada fila es un Chunklet anidado con su propio ciclo de vida y su propio
    // contexto. La identidad la lleva el DOM en `data-entity`; Chunklet nunca
    // genera identificadores.
    montarAnidados: true,
  });

  const boton = elemento.querySelector('[data-accion="nueva-conversacion"]');
  if (boton) {
    ctx.listen(boton, 'click', () => {
      const id = crearConversacion(ctx.nebula);
      // Crear pasa por nebula; el repintado llega por el Bridge.
      // Seleccionar es estado de interfaz y va directo a Pulsar.
      fijarUi(ctx, { activeConversation: id });
    });
  }

  return {
    get cuenta() { return lista.cuenta; },
    reiniciarCuenta() { lista.reiniciarCuenta(); },
  };
}

export default conversationList;
