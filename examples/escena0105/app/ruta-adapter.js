/**
 * Adapter de ruta — Escena 1.4.
 *
 * Traduce en las dos direcciones entre la navegación y el estado de interfaz:
 *
 *   URL cambia   ->  route.*  ->  ui.activeConversation
 *   selección    ->  ui.*     ->  voyajer.push()
 *
 * Es un adapter y no un widget porque no hay DOM de por medio en ninguna de
 * las dos traducciones. El criterio está en Chunklet Contract §11.2: cuando
 * uno escribe "ante cada cambio de X, sincroniza Y", eso es trabajo de
 * adapter.
 *
 * Voyajer escribe la URL en Pulsar pero NO lee Pulsar para actualizar la URL
 * (Voyajer Contract §7, "No automatic store subscription"), precisamente para
 * no crear bucles. Este módulo cierra el circuito a mano.
 *
 * Qué corta el bucle, medido y no supuesto: la combinación de la idempotencia
 * de `push` —si el estado serializa a la URL actual, es un no-op sin historial
 * ni notificación— con la `equality` de `subscribeSelector`, que no invoca al
 * listener cuando el valor derivado no cambió. Con esas dos, el circuito
 * converge aunque ninguna de las dos suscripciones se guarde de nada.
 */

import { TIPO_CONVERSACION } from './modelo.js';

/** Prefijo de la ruta de conversación. */
const RUTA_CONVERSACION = '/c/';

/**
 * Convierte un identificador de conversación en el segmento de URL.
 *
 * Se retira el prefijo de tipo: `conversation:mt1a2b` se presenta como
 * `mt1a2b`. Esto acopla el formato de URL al de identificador, y es
 * deliberado — la alternativa produce URLs como `/c/conversation%3Amt1a2b`,
 * que nadie querría compartir. El acoplamiento queda contenido en este par de
 * funciones, que es donde el contrato de Voyajer sitúa el conocimiento del
 * formato de URL.
 */
function aSlug(id) {
  const prefijo = `${TIPO_CONVERSACION}:`;
  return id.startsWith(prefijo) ? id.slice(prefijo.length) : id;
}

function aId(slug) {
  return `${TIPO_CONVERSACION}:${slug}`;
}

/** `parse` para Voyajer: URL virtual normalizada -> estado de navegación. */
export function parse(url) {
  const ruta = url.pathname || '/';
  if (ruta.startsWith(RUTA_CONVERSACION)) {
    const slug = decodeURIComponent(ruta.slice(RUTA_CONVERSACION.length));
    if (slug) return { vista: 'conversacion', conversacionId: aId(slug) };
  }
  return { vista: 'inicio' };
}

/** `serialize` para Voyajer: estado de navegación -> ruta. */
export function serialize(estado) {
  if (estado && estado.vista === 'conversacion' && estado.conversacionId) {
    return RUTA_CONVERSACION + encodeURIComponent(aSlug(estado.conversacionId));
  }
  return '/';
}

/** Opciones listas para pasar a `Chunklet.setup({ voyajer })`. */
export const opcionesVoyajer = { mode: 'hash', parse, serialize };

/**
 * Instala el puente bidireccional.
 *
 * @param {object} dependencias
 * @param {PulsarInstance} dependencias.pulsar
 * @param {nebulaInstance} dependencias.nebula
 * @param {VoyajerInstance} dependencias.voyajer
 * @returns {{destroy: function}}
 */
export function crearRutaAdapter({ pulsar, nebula, voyajer }) {
  if (!pulsar || !nebula || !voyajer) {
    throw new TypeError('[ruta-adapter] faltan pulsar, nebula o voyajer');
  }

  // ----------------------------------------------------------------
  // URL -> interfaz
  // ----------------------------------------------------------------
  //
  // Una ruta que apunta a una conversación inexistente no selecciona nada y,
  // sobre todo, no la crea: fabricar entidades de dominio a partir de una
  // cadena en la barra de direcciones convertiría cualquier URL malformada en
  // un dato persistido.
  //
  // La comparación contra la selección actual NO es lo que corta el bucle —eso
  // lo hacen la idempotencia de `push` y la equality del selector—, sino una
  // economía: ahorra exactamente un `setState` redundante por selección.
  // Medido: 2 notificaciones con ella, 3 sin ella. Hay una aserción que fija
  // ese número, para que la línea no se pueda borrar en silencio.
  //
  const desuscribirRuta = pulsar.subscribeSelector(
    (estado) => {
      const ruta = estado.route;
      return ruta && ruta.vista === 'conversacion' ? ruta.conversacionId : null;
    },
    (idDeRuta) => {
      const ui = pulsar.getState().ui || {};
      const actual = ui.activeConversation || null;
      const objetivo = idDeRuta || null;

      // La comparación contra la selección actual NO corta el bucle —eso lo
      // hacen la idempotencia de `push` y la equality del selector— sino que
      // ahorra un `setState` redundante por selección. Pero no puede saltarse
      // la limpieza de `rutaNoEncontrada`: si la ruta anterior no existía y la
      // nueva sí, la selección puede coincidir ya y aun así habría que borrar
      // la constancia. Salir antes dejaría el aviso pegado para siempre.
      if (objetivo === actual && !ui.rutaNoEncontrada) return;

      if (idDeRuta && !nebula.get(idDeRuta)) {
        // La URL no se reescribe. Es lo que el usuario tecleó o pegó, y
        // sustituirla borraría la evidencia de qué intentaba abrir — además de
        // cambiarle la barra de direcciones sin pedirlo.
        //
        // Lo que sí se hace es dejar constancia en `ui.*` para que la interfaz
        // pueda decirlo. Un `console.warn` es invisible para quien usa la
        // aplicación, que es precisamente quien necesita enterarse.
        console.warn(`[ruta-adapter] la URL apunta a ${idDeRuta}, que no existe`);
        pulsar.setState({
          ui: { ...ui, activeConversation: null, rutaNoEncontrada: idDeRuta },
        });
        return;
      }
      pulsar.setState({
        ui: { ...ui, activeConversation: objetivo, rutaNoEncontrada: null },
      });
    },
    { immediate: true }
  );

  // ----------------------------------------------------------------
  // Interfaz -> URL
  // ----------------------------------------------------------------
  //
  // `push` es idempotente por contrato, así que cuando la selección llegó
  // desde la propia URL esta llamada no hace nada: ni navega, ni añade
  // historial, ni notifica. Eso es lo que corta el bucle.
  //
  const desuscribirSeleccion = pulsar.subscribeSelector(
    (estado) => (estado.ui && estado.ui.activeConversation) || null,
    (id) => {
      // Si la URL apunta a algo que no existe, no se reescribe.
      //
      // Sin esta comprobación la rama de arriba deja `activeConversation` en
      // null, ésta lo interpreta como "no hay nada abierto" y empuja `inicio`,
      // que sustituye la URL del usuario por la raíz. El aviso se borra junto
      // con la evidencia de qué intentaba abrir, y el mensaje de error nunca
      // llega a verse.
      //
      // Es la misma promesa que hace la rama de arriba: la URL es del usuario.
      if (!id && pulsar.getState().ui && pulsar.getState().ui.rutaNoEncontrada) return;

      voyajer.push(
        id
          ? { vista: 'conversacion', conversacionId: id }
          : { vista: 'inicio' }
      );
    },
    { immediate: true }
  );

  return {
    destroy() {
      desuscribirRuta();
      desuscribirSeleccion();
    },
  };
}

export default crearRutaAdapter;
