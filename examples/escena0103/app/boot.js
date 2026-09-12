/**
 * Secuencia canónica de arranque del stack Nexus.
 *
 * Escena 1.1 — Fase 1. Ver `ESCENA_1_1_ARRANQUE.md`.
 *
 * El orden de las llamadas de este archivo NO es estilístico. Hidratar
 * después de montar los adapters convierte el arranque de O(N) en O(N²)
 * sin fallar ni avisar. Ver §3 de la mini-spec y `bench/hidratacion.mjs`.
 *
 * El módulo se divide en dos capas porque tienen dependencias distintas:
 *
 *   arrancarDatos()      no toca el DOM. Se puede ejecutar N veces en la
 *                        misma página, y por eso es testeable en aislamiento.
 *   montarInterfaz()     llama a Chunklet.setup, que es one-shot por módulo.
 *
 * `arrancar()` orquesta ambas y es lo que usa la aplicación.
 */

import { createNebula } from '../../../src/nebula.js';
import { createStatePulsar } from '../../../src/pulsar.js';
import { createHydrationAdapter } from '../../../src/adapters/hydration-adapter.js';
import { createNebulaPulsarBridge } from '../../../src/adapters/nebula-pulsar-bridge.js';
import { createPersistenceAdapter } from '../../../src/adapters/persistence-adapter.js';
import Chunklet from '../../../src/chunklet.js';

import { CLAVE_SNAPSHOT, leerSnapshot, resolverStorage } from './persistencia.js';
import { appShell } from './shell.js';
import { conversationList } from './conversation-list.js';
import { conversationItem } from './conversation-item.js';
import { conversationMessages } from './conversation-messages.js';
import { crearMockProvider } from './mock-provider.js';
import { crearConversacion, agregarMensaje } from './modelo.js';

/**
 * Estado inicial de Pulsar, con los espacios de nombres reservados por el
 * Nexus Contract §5.1 ya declarados. Declararlos desde el arranque evita que
 * un `subscribeSelector` sobre `ui.algo` vea `undefined` antes de la primera
 * escritura y notifique un cambio que en realidad es la aparición de la rama.
 */
export function estadoInicial() {
  return {
    route: {},      // VoyajerJS
    entities: {},   // proyección del Bridge
    ui: {},         // estado propio de la aplicación
    net: {},        // estado de peticiones externas
  };
}

/**
 * Crea las primitivas crudas. Ningún wrapper instalado todavía.
 */
export function crearPrimitivas() {
  return {
    nebula: createNebula(),
    pulsar: createStatePulsar(estadoInicial()),
  };
}

/**
 * Capa de datos: hidratación y adapters, en el único orden correcto.
 *
 * No toca el DOM ni Chunklet. Recibe las primitivas en vez de crearlas para
 * que un test pueda instrumentarlas antes de que la secuencia corra — el
 * conteo de `setState` durante el arranque es la aserción que protege el
 * invariante de §6 de la mini-spec.
 *
 * @param {object} opciones
 * @param {nebulaInstance} opciones.nebula
 * @param {PulsarInstance} opciones.pulsar
 * @param {Storage} [opciones.storage] - Inyectable. Por defecto localStorage.
 * @param {string} [opciones.clave] - Clave de snapshot.
 * @param {number} [opciones.debounceMs]
 * @returns {{bridge, persistence, hidratacion, destruir}}
 */
export function arrancarDatos(opciones = {}) {
  const { nebula, pulsar } = opciones;
  if (!nebula || !pulsar) {
    throw new TypeError('[boot] arrancarDatos requiere nebula y pulsar');
  }

  const storage = resolverStorage(opciones.storage);
  const clave = opciones.clave || CLAVE_SNAPSHOT;
  const debounceMs = opciones.debounceMs !== undefined ? opciones.debounceMs : 300;

  // ----------------------------------------------------------------
  // 1. Hidratar sobre el grafo CRUDO.
  //
  //    Este paso va primero y no es negociable. Con Bridge o Persistence
  //    ya montados, cada upsert y cada link de la hidratación atraviesa
  //    sus wrappers: Bridge re-proyecta el grafo entero y Pulsar congela
  //    el resultado recursivamente. N entidades producen 2N setState, cada
  //    uno con coste O(N).
  //
  //    Medido: 800 entidades cuestan 1.2 ms en este orden y 515 ms en el
  //    inverso, con el mismo estado final. El orden equivocado no falla,
  //    sólo tarda, y por eso hay una aserción que lo vigila.
  // ----------------------------------------------------------------
  const hidratacion = leerSnapshot(storage, clave);

  if (hidratacion.estado === 'ok') {
    createHydrationAdapter(
      { nebula },
      { snapshot: hidratacion.snapshot, mode: 'merge', onMissingTarget: 'skip' }
    );
  }

  // ----------------------------------------------------------------
  // 2. Bridge. `skipInitialSync` queda en su default (false), de modo que
  //    todo lo hidratado se proyecta en UNA sola pasada.
  // ----------------------------------------------------------------
  const bridge = createNebulaPulsarBridge(
    { nebula, pulsar },
    { path: 'entities' }
  );

  // ----------------------------------------------------------------
  // 3. Persistence. `writeOnInit: false` porque acabamos de leer de ahí;
  //    reescribir lo recién leído es trabajo sin efecto. Modo debounced
  //    para que una ráfaga de mutaciones produzca una escritura y no una
  //    por mutación.
  // ----------------------------------------------------------------
  const persistence = createPersistenceAdapter(
    { nebula },
    { key: clave, mode: 'debounced', debounceMs, writeOnInit: false, storage }
  );

  /**
   * Libera los adapters en orden inverso al de montaje.
   *
   * `flush()` antes de `destroy()` es deliberado y explícito: Persistence
   * no hace flush implícito al destruirse (su mini-spec §3.4), así que si
   * hay una escritura en vuelo, éste es el punto donde se materializa.
   */
  function destruir({ guardarPendiente = true } = {}) {
    if (guardarPendiente) persistence.flush();
    persistence.destroy();
    bridge.destroy();
  }

  return { bridge, persistence, hidratacion, destruir };
}

/**
 * Capa de interfaz: stack de Chunklet, definición de behaviors y montaje.
 *
 * `Chunklet.setup` es one-shot por módulo. Una segunda llamada lanza, así que
 * esta función no se puede ejecutar dos veces en la misma página.
 */
export function montarInterfaz(opciones = {}) {
  const { nebula, pulsar } = opciones;
  const raiz = opciones.raiz || document.body;
  const modoRuta = opciones.modoRuta || 'hash';

  // Voyajer en modo `hash` por elección, no por imposición. Los hosts
  // objetivo sirven bajo orígenes con semántica http, así que `history`
  // también funcionaría con fallback a index.html en el AssetServer.
  // `hash` no requiere configurar nada en ningún host, y la normalización
  // de URL virtual de Voyajer (§5.4) hace que el mismo par parse/serialize
  // sirva en ambos modos: cambiar de opinión es esta línea.
  const stack = Chunklet.setup({
    pulsar,
    nebula,
    voyajer: { mode: modoRuta },
  });

  // Los behaviors se registran todos antes de montar. `conversation-item` se
  // define aquí aunque sea `conversation-list` quien lo monte: el registro es
  // global al módulo y la lista no puede montar lo que no está definido.
  Chunklet.define('app-shell', appShell);
  Chunklet.define('conversation-list', conversationList);
  Chunklet.define('conversation-item', conversationItem);
  Chunklet.define('conversation-messages', conversationMessages);

  // ANDAMIO TEMPORAL — se retira en la Escena 1.4.
  //
  // Esta escena tiene streaming pero no composer, así que hace falta algo que
  // dispare el mock. Se implementa como behavior para no meter lógica suelta
  // en index.html, y se marca aquí para que la retirada sea un borrado de
  // bloque y no una arqueología.
  if (opciones.provider) {
    Chunklet.define('andamio-disparador', crearAndamio(opciones.provider));
  }

  Chunklet.mount(raiz);

  return stack;
}

/**
 * Arranque completo. Es lo que llama `index.html`.
 *
 * @param {object} [opciones]
 * @param {boolean} [opciones.exponerGlobal=false] - Publica el stack en
 *   `window.__nexus` para inspección desde consola. Apagado por defecto:
 *   con Chunklet 0.4.x los behaviors reciben todo por `ctx`, así que un
 *   global no hace falta para funcionar y su única razón de ser es comodidad
 *   de desarrollo. Encenderlo a voluntad, nunca por costumbre.
 */
/**
 * ANDAMIO TEMPORAL — Escena 1.3, se retira en 1.4.
 *
 * Crea una conversación si no hay ninguna activa, añade un mensaje de usuario
 * y lanza la respuesta simulada. Sustituye al composer que llega en 1.4.
 */
function crearAndamio(provider) {
  return function andamioDisparador(elemento, ctx) {
    let enCurso = null;

    ctx.listen(elemento, 'click', () => {
      if (enCurso && enCurso.activo) { enCurso.detener(); return; }

      let conversacion = ctx.getState().ui && ctx.getState().ui.activeConversation;
      if (!conversacion || !ctx.entity(conversacion)) {
        conversacion = crearConversacion(ctx.nebula);
        ctx.setState({ ui: { ...ctx.getState().ui, activeConversation: conversacion } });
      }

      agregarMensaje(ctx.nebula, conversacion, {
        rol: 'user',
        texto: 'Mensaje de prueba del andamio.',
      });
      enCurso = provider.responder(conversacion);
    });

    // El stream sobrevive al elemento si no se cancela: es un temporizador
    // encadenado, no un listener. Liberarlo es responsabilidad de quien lo
    // adquirió.
    ctx.cleanup(() => { if (enCurso && enCurso.activo) enCurso.detener(); });
  };
}

export function arrancar(opciones = {}) {
  const { nebula, pulsar } = crearPrimitivas();

  const datos = arrancarDatos({ nebula, pulsar, ...opciones });
  const provider = crearMockProvider({ nebula }, opciones.provider || {});
  const stack = montarInterfaz({ nebula, pulsar, provider, ...opciones });

  const nexus = {
    nebula: stack.nebula,
    pulsar: stack.pulsar,
    voyajer: stack.voyajer,
    bridge: datos.bridge,
    persistence: datos.persistence,
    hidratacion: datos.hidratacion,
    provider,
    destruir: datos.destruir,
  };

  if (opciones.exponerGlobal === true) {
    window.__nexus = nexus;
  }

  return nexus;
}
