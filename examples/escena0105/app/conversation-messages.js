/**
 * Behavior `conversation-messages` — migrado en la Escena 1.5.
 *
 * Las dos suscripciones que la Escena 1.3 estableció siguen existiendo y
 * siguen siendo el núcleo del widget. Lo que cambió es que la estructural ya
 * no reconstruye: la factory reconcilia con clave.
 *
 *   estructural  qué mensajes hay, en qué orden, de quién y en qué estado.
 *                Excluye el texto. La lleva `crearListaDeEntidades`.
 *
 *   contenido    el texto del mensaje en vuelo. Escribe UN nodo de texto.
 *                Ocurre una vez por token. Sigue aquí porque no es estructura.
 *
 * Con la reconciliación, la estructural también hace ahora el mínimo: añadir
 * un mensaje crea un nodo y cerrarlo cambia un atributo. Antes cada una de esas
 * cosas reconstruía la lista entera.
 */

import { crearListaDeEntidades } from './lista-de-entidades.js';
import { zonas } from './zonas.js';
import {
  listarMensajes,
  mensajeEnVuelo,
  mismaEstructuraDeMensajes,
} from './modelo.js';

/** Distancia al fondo, en píxeles, bajo la cual se considera "siguiendo". */
const UMBRAL_FONDO = 48;

export function conversationMessages(elemento, ctx) {
  const z = zonas(elemento, {
    mensajes: true,
    'mensajes-scroll': false,
    'sin-mensajes': false,
  }, 'conversation-messages');

  // El elemento que desplaza no tiene por qué ser el que contiene los
  // mensajes: en el shell real es el hilo que los envuelve.
  const desplazable = z['mensajes-scroll'] || z.mensajes;

  /**
   * Se evalúa ANTES de escribir, porque después el contenido ya creció y la
   * medida diría que el usuario se quedó atrás cuando estaba al día.
   */
  function siguiendoElFinal() {
    const resto = desplazable.scrollHeight - desplazable.scrollTop - desplazable.clientHeight;
    return !Number.isFinite(resto) || resto <= UMBRAL_FONDO;
  }

  function irAlFinal() {
    desplazable.scrollTop = desplazable.scrollHeight;
  }

  function conversacionActiva(estado) {
    return (estado.ui && estado.ui.activeConversation) || null;
  }

  // ----------------------------------------------------------------
  // Suscripción estructural, vía la factory
  // ----------------------------------------------------------------
  const lista = crearListaDeEntidades(elemento, ctx, {
    nombre: 'conversation-messages',
    contenedor: 'mensajes',
    plantilla: 'message-item',
    vacio: 'sin-mensajes',
    raizDelClon: '[data-mensaje]',

    selector: (estado) => {
      const conversacion = conversacionActiva(estado);
      return conversacion ? listarMensajes(estado.entities, conversacion) : [];
    },
    equality: mismaEstructuraDeMensajes,

    atributos: (mensaje) => ({ rol: mensaje.rol, estado: mensaje.estado }),

    zonas: {
      quien: (mensaje) => (mensaje.rol === 'user' ? 'Tú' : 'Asistente'),
      texto: (mensaje) => mensaje.texto,
    },

    antesDePintar: () => siguiendoElFinal(),
    despuesDePintar: (seguia) => { if (seguia) irAlFinal(); },
  });

  // ----------------------------------------------------------------
  // Suscripción de contenido
  // ----------------------------------------------------------------
  //
  // ORDEN DE REGISTRO: esta suscripción DEBE registrarse después de la
  // estructural. Pulsar invoca a los listeners en orden de registro, así que
  // cuando llega el primer token de un mensaje recién abierto, la estructural
  // ya creó su nodo y `lista.zonaDe` lo encuentra. Al revés, el primer token
  // se perdería hasta la siguiente notificación.
  //
  // Es una dependencia implícita en el orden de dos líneas de este archivo.
  // Hay una aserción que la protege: el primer token de un mensaje nuevo debe
  // aparecer en el DOM en esa misma notificación.
  //
  // Deriva la lista una segunda vez por notificación. Es trabajo duplicado y
  // consciente: la alternativa era denormalizar el id en vuelo dentro de
  // `ui.*`, que desincroniza dos fuentes para la misma verdad. La medición de
  // la Escena 1.3 deja holgura de sobra — 0.578 ms por token en el peor caso
  // medido, contra 16 ms de presupuesto de fotograma.
  //
  ctx.subscribeSelector(
    (estado) => {
      const conversacion = conversacionActiva(estado);
      if (!conversacion) return null;
      const enVuelo = mensajeEnVuelo(listarMensajes(estado.entities, conversacion));
      return enVuelo ? { id: enVuelo.id, texto: enVuelo.texto } : null;
    },
    (actual) => {
      if (!actual) return;
      const zona = lista.zonaDe(actual.id, 'texto');
      if (!zona) return;                       // aún no pintado; la estructural lo hará
      const seguia = siguiendoElFinal();
      zona.textContent = actual.texto;
      if (seguia) irAlFinal();
    },
    {
      equality: (a, b) => a === b || (!!a && !!b && a.id === b.id && a.texto === b.texto),
      immediate: true,
    }
  );

  // ----------------------------------------------------------------
  // Superficie de inspección para el harness
  // ----------------------------------------------------------------
  //
  // Contar operaciones de DOM es la única forma de afirmar que el streaming no
  // crea ni destruye nodos: el DOM resultante es idéntico se haya llegado a él
  // recreando todo o escribiendo un nodo. Disciplina D-7.
  //
  return {
    get cuenta() { return lista.cuenta; },
    reiniciarCuenta() { lista.reiniciarCuenta(); },
    nodoDe(id) { return lista.nodoDe(id); },
  };
}

export default conversationMessages;
