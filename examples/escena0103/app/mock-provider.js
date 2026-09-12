/**
 * Provider simulado — Escena 1.3.
 *
 * Emite una respuesta token a token para ejercitar el streaming sin depender
 * de un LLM real. No conoce el DOM ni Chunklet: recibe `nebula` y opera
 * sobre el modelo, igual que lo hará el provider real de la Escena 1.6.
 *
 * Esa equivalencia de interfaz es la razón de que esto sea un módulo aparte y
 * no una función dentro del widget: sustituirlo debe ser cambiar un import.
 */

import {
  agregarMensaje,
  anexarTexto,
  finalizarMensaje,
  ESTADO_EN_VUELO,
  ESTADO_COMPLETO,
  ESTADO_INTERRUMPIDO,
} from './modelo.js';

const RESPUESTAS = [
  'Entiendo lo que planteas. Déjame desarrollarlo por partes para que quede claro dónde está el punto importante y dónde solamente hay ruido.',
  'Buena pregunta. La respuesta corta es que depende del contexto, y la larga requiere distinguir entre dos casos que suelen confundirse.',
  'Hay varias formas de abordar eso. La más directa funciona bien en el caso simple, pero se rompe en cuanto aparece concurrencia.',
  'Vale la pena separar dos cosas que estás tratando como una sola: el mecanismo, que es sencillo, y la política, que es donde está la decisión real.',
];

/**
 * Trocea un texto en fragmentos con forma de token: palabras con su espacio.
 * No pretende imitar la tokenización de ningún modelo, sólo producir una
 * cadencia parecida.
 */
function trocear(texto) {
  return texto.split(/(\s+)/).filter((t) => t !== '');
}

/**
 * @param {object} dependencias
 * @param {nebulaInstance} dependencias.nebula
 * @param {object} [opciones]
 * @param {number} [opciones.intervaloMs=35] - Separación entre tokens.
 * @param {function} [opciones.programar=setTimeout] - Planificador inyectable.
 * @param {function} [opciones.cancelar=clearTimeout]
 * @param {string[]} [opciones.respuestas] - Banco de respuestas.
 */
export function crearMockProvider({ nebula }, opciones = {}) {
  if (!nebula) throw new TypeError('[mock-provider] falta nebula');

  const intervaloMs = opciones.intervaloMs !== undefined ? opciones.intervaloMs : 35;
  // El planificador se inyecta para que las pruebas puedan avanzar el stream
  // paso a paso en vez de esperar temporizadores reales. En producción son
  // los de la plataforma.
  const programar = opciones.programar || ((fn, ms) => setTimeout(fn, ms));
  const cancelar = opciones.cancelar || ((h) => clearTimeout(h));
  const respuestas = opciones.respuestas || RESPUESTAS;

  let cuenta = 0;

  /**
   * Inicia una respuesta en la conversación indicada.
   *
   * @returns {{mensajeId: string, detener: function, activo: boolean}}
   *   Un asa. `detener()` cancela el stream, libera el temporizador y deja el
   *   mensaje en estado `interrumpido`. Un stream que no se puede cancelar es
   *   un recurso que no se puede liberar, y en la Escena 1.4 el usuario podrá
   *   cambiar de conversación a media respuesta.
   */
  function responder(conversacionId, opcionesRespuesta = {}) {
    const texto = opcionesRespuesta.texto || respuestas[cuenta++ % respuestas.length];
    const tokens = trocear(texto);

    const mensajeId = agregarMensaje(nebula, conversacionId, {
      rol: 'assistant',
      texto: '',
      estado: ESTADO_EN_VUELO,
    });

    let indice = 0;
    let handle = null;
    let terminado = false;

    function paso() {
      handle = null;
      if (terminado) return;

      if (indice >= tokens.length) {
        terminado = true;
        finalizarMensaje(nebula, mensajeId, ESTADO_COMPLETO);
        if (typeof opcionesRespuesta.alTerminar === 'function') {
          opcionesRespuesta.alTerminar(mensajeId);
        }
        return;
      }

      anexarTexto(nebula, mensajeId, tokens[indice++]);
      handle = programar(paso, intervaloMs);
    }

    handle = programar(paso, intervaloMs);

    return {
      mensajeId,
      get activo() { return !terminado; },
      detener() {
        if (terminado) return;
        terminado = true;
        if (handle !== null) { cancelar(handle); handle = null; }
        finalizarMensaje(nebula, mensajeId, ESTADO_INTERRUMPIDO);
      },
    };
  }

  return { responder };
}

export default crearMockProvider;
