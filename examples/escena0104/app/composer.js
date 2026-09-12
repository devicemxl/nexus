/**
 * Behavior `composer` — Escena 1.4.
 *
 * Sustituye al andamio de la Escena 1.3. Escribe el mensaje del usuario y
 * dispara la respuesta del provider.
 *
 * El asa del stream vive aquí porque aquí se inicia: un stream es una cadena
 * de temporizadores que sobrevive al elemento si nadie la cancela, así que
 * quien la adquiere es responsable de liberarla.
 */

import {
  crearConversacion,
  agregarMensaje,
  listarMensajes,
  mensajeEnVuelo,
} from './modelo.js';

export function composer(elemento, ctx, opciones = {}) {
  const provider = opciones.provider;
  if (!provider) throw new TypeError('[composer] falta el provider');

  const entrada = elemento.querySelector('[data-zona="entrada"]');
  const boton = elemento.querySelector('[data-accion="enviar"]');

  if (!entrada || !boton) {
    throw new Error('[composer] falta [data-zona="entrada"] o [data-accion="enviar"]');
  }

  /** Asa del stream en curso, si lo hay. */
  let enCurso = null;
  /** Conversación sobre la que corre el stream, para detectar el cambio. */
  let conversacionDelStream = null;

  // ----------------------------------------------------------------
  // Envío
  // ----------------------------------------------------------------
  function enviar() {
    const texto = entrada.value.trim();
    if (texto === '') return;

    let conversacion = ctx.getState().ui && ctx.getState().ui.activeConversation;

    // Sin conversación activa, escribir crea una. Es lo que un usuario espera
    // al abrir la aplicación y ponerse a escribir.
    if (!conversacion || !ctx.entity(conversacion)) {
      conversacion = crearConversacion(ctx.nebula, { titulo: tituloDesde(texto) });
      ctx.setState({ ui: { ...ctx.getState().ui, activeConversation: conversacion } });
    }

    agregarMensaje(ctx.nebula, conversacion, { rol: 'user', texto });
    entrada.value = '';
    ajustarAltura();

    conversacionDelStream = conversacion;
    enCurso = provider.responder(conversacion, { texto: opciones.respuesta });
  }

  function detener() {
    if (enCurso && enCurso.activo) enCurso.detener();
    enCurso = null;
    conversacionDelStream = null;
  }

  /**
   * Primeras palabras del primer mensaje como título. Mejor que
   * "Conversación 12/09 14:30" cuando hay contenido del que tirar.
   */
  function tituloDesde(texto) {
    const limpio = texto.replace(/\s+/g, ' ').trim();
    return limpio.length <= 42 ? limpio : limpio.slice(0, 41).trimEnd() + '…';
  }

  // ----------------------------------------------------------------
  // Estado del botón
  // ----------------------------------------------------------------
  //
  // Se deriva del modelo —hay un mensaje en vuelo en la conversación activa—
  // y no de una bandera en `ui.*`. Dos fuentes para la misma verdad se
  // desincronizan en cuanto una de ellas falla.
  //
  function pintarBoton(hayStream) {
    boton.textContent = hayStream ? 'Detener' : 'Enviar';
    boton.dataset.modo = hayStream ? 'detener' : 'enviar';
    entrada.disabled = hayStream;
  }

  ctx.subscribeSelector(
    (estado) => {
      const conversacion = estado.ui && estado.ui.activeConversation;
      if (!conversacion) return false;
      return mensajeEnVuelo(listarMensajes(estado.entities, conversacion)) !== null;
    },
    (hayStream) => pintarBoton(hayStream),
    { immediate: true }
  );

  // ----------------------------------------------------------------
  // Cambio de conversación con un stream vivo
  // ----------------------------------------------------------------
  //
  // Se detiene. Dejarlo correr en segundo plano suena más generoso pero
  // produce respuestas que se completan sin que nadie las mire, y abre la
  // pregunta de qué ocurre al volver. Es alcance que el roadmap no
  // comprometió. El mensaje queda `interrumpido`, que el widget de mensajes
  // ya sabe pintar.
  //
  ctx.subscribeSelector(
    (estado) => (estado.ui && estado.ui.activeConversation) || null,
    (conversacion) => {
      if (enCurso && enCurso.activo && conversacion !== conversacionDelStream) {
        detener();
      }
    }
  );

  // ----------------------------------------------------------------
  // Interacción
  // ----------------------------------------------------------------
  ctx.listen(boton, 'click', () => {
    if (boton.dataset.modo === 'detener') detener();
    else enviar();
  });

  ctx.listen(entrada, 'keydown', (evento) => {
    // Enter envía; Shift+Enter inserta salto de línea. Es la convención de
    // toda aplicación de chat y los usuarios la traen aprendida.
    if (evento.key === 'Enter' && !evento.shiftKey) {
      evento.preventDefault();
      enviar();
    }
  });

  // ----------------------------------------------------------------
  // Altura automática del área de texto
  // ----------------------------------------------------------------
  const ALTURA_MAXIMA = 180;
  function ajustarAltura() {
    entrada.style.height = 'auto';
    entrada.style.height = Math.min(entrada.scrollHeight, ALTURA_MAXIMA) + 'px';
  }
  ctx.listen(entrada, 'input', ajustarAltura);

  // ----------------------------------------------------------------
  // Teardown
  // ----------------------------------------------------------------
  ctx.cleanup(() => { detener(); });

  return {
    get hayStream() { return enCurso !== null && enCurso.activo; },
    destroy() { detener(); },
  };
}

export default composer;
