/**
 * Behavior `conversation-messages` — Escena 1.3.
 *
 * El núcleo de esta escena son sus DOS suscripciones, que existen por razones
 * distintas y no se pueden fusionar:
 *
 *   estructural  qué mensajes hay, en qué orden, de quién y en qué estado.
 *                Excluye el texto. Dispara reconstrucción completa.
 *                Ocurre al cambiar de conversación y al abrir o cerrar un
 *                mensaje.
 *
 *   contenido    el texto del mensaje en vuelo. Dispara la escritura de UN
 *                nodo de texto. Ocurre una vez por token.
 *
 * Con una sola suscripción habría que elegir entre reconstruir la lista
 * entera por cada token o no reaccionar al streaming. Ver §5 de
 * `ESCENA_1_3_MENSAJES.md`.
 */

import {
  listarMensajes,
  mensajeEnVuelo,
  mismaEstructuraDeMensajes,
  ESTADO_EN_VUELO,
  ESTADO_INTERRUMPIDO,
} from './modelo.js';

/** Distancia al fondo, en píxeles, bajo la cual se considera "siguiendo". */
const UMBRAL_FONDO = 48;

export function conversationMessages(elemento, ctx) {
  const contenedor = elemento.querySelector('[data-zona="mensajes"]');
  const plantilla = elemento.querySelector('template[data-plantilla="message-item"]');
  const vacio = elemento.querySelector('[data-zona="sin-mensajes"]');

  // El elemento que desplaza no tiene por qué ser el que contiene los
  // mensajes: en el shell real es el hilo que los envuelve. Si no se declara
  // uno aparte, se usa el propio contenedor.
  const desplazable = elemento.querySelector('[data-zona="mensajes-scroll"]') || contenedor;

  if (!contenedor || !plantilla) {
    throw new Error(
      '[conversation-messages] falta [data-zona="mensajes"] o ' +
      'template[data-plantilla="message-item"]'
    );
  }

  /** Nodo de texto de cada mensaje pintado, por id. */
  let textosPorId = new Map();
  /** Contador expuesto para las aserciones del harness. */
  let reconstrucciones = 0;

  // ----------------------------------------------------------------
  // Desplazamiento
  // ----------------------------------------------------------------

  /**
   * Se evalúa ANTES de escribir, porque después el contenido ya creció y la
   * medida diría que el usuario se quedó atrás cuando en realidad estaba al
   * día.
   */
  function siguiendoElFinal() {
    const resto = desplazable.scrollHeight - desplazable.scrollTop - desplazable.clientHeight;
    return !Number.isFinite(resto) || resto <= UMBRAL_FONDO;
  }

  function irAlFinal() {
    desplazable.scrollTop = desplazable.scrollHeight;
  }

  // ----------------------------------------------------------------
  // Reconstrucción completa
  // ----------------------------------------------------------------
  function pintar(mensajes) {
    const seguia = siguiendoElFinal();

    reconstrucciones++;
    textosPorId = new Map();
    contenedor.textContent = '';

    for (const mensaje of mensajes) {
      const fragmento = plantilla.content.cloneNode(true);
      const nodo = fragmento.querySelector('[data-mensaje]');
      if (!nodo) continue;

      nodo.dataset.entity = mensaje.id;
      nodo.dataset.rol = mensaje.rol;
      nodo.dataset.estado = mensaje.estado;

      const zonaQuien = nodo.querySelector('[data-zona="quien"]');
      if (zonaQuien) zonaQuien.textContent = mensaje.rol === 'user' ? 'Tú' : 'Asistente';

      const zonaTexto = nodo.querySelector('[data-zona="texto"]');
      if (zonaTexto) {
        zonaTexto.textContent = mensaje.texto;
        textosPorId.set(mensaje.id, zonaTexto);
      }

      contenedor.appendChild(fragmento);
    }

    if (vacio) vacio.hidden = mensajes.length > 0;
    if (seguia) irAlFinal();
  }

  /**
   * Escritura incremental: toca un solo nodo de texto y no reconstruye nada.
   * Es la ruta caliente, la que se ejecuta una vez por token.
   */
  function actualizarTexto(id, texto) {
    const zona = textosPorId.get(id);
    if (!zona) return;              // aún no pintado; la estructural lo hará
    const seguia = siguiendoElFinal();
    zona.textContent = texto;
    if (seguia) irAlFinal();
  }

  // ----------------------------------------------------------------
  // Suscripción estructural
  // ----------------------------------------------------------------
  ctx.subscribeSelector(
    (estado) => {
      const conversacion = estado.ui && estado.ui.activeConversation;
      return conversacion ? listarMensajes(estado.entities, conversacion) : [];
    },
    (mensajes) => pintar(mensajes),
    { equality: mismaEstructuraDeMensajes, immediate: true }
  );

  // ----------------------------------------------------------------
  // Suscripción de contenido
  // ----------------------------------------------------------------
  //
  // Deriva la lista una segunda vez por notificación. Es trabajo duplicado y
  // consciente: la alternativa era denormalizar el id en vuelo dentro de
  // `ui.*`, que desincroniza dos fuentes para la misma verdad. La medición de
  // §4 de la mini-spec deja holgura de sobra para pagarlo.
  //
  ctx.subscribeSelector(
    (estado) => {
      const conversacion = estado.ui && estado.ui.activeConversation;
      if (!conversacion) return null;
      const enVuelo = mensajeEnVuelo(listarMensajes(estado.entities, conversacion));
      return enVuelo ? { id: enVuelo.id, texto: enVuelo.texto } : null;
    },
    (actual) => { if (actual) actualizarTexto(actual.id, actual.texto); },
    {
      equality: (a, b) =>
        a === b || (!!a && !!b && a.id === b.id && a.texto === b.texto),
      immediate: true,
    }
  );

  // ----------------------------------------------------------------
  // Superficie de inspección para el harness
  // ----------------------------------------------------------------
  //
  // Contar reconstrucciones es la única forma de afirmar que el streaming no
  // las provoca: el DOM resultante es idéntico se haya llegado a él
  // reconstruyendo o escribiendo un nodo. Es la disciplina D-7 — un invariante
  // que ninguna aserción sobre la salida puede detectar.
  //
  return {
    get reconstrucciones() { return reconstrucciones; },
    destroy() {
      textosPorId = new Map();
      contenedor.textContent = '';
    },
  };
}

export default conversationMessages;
