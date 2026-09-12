/**
 * Secuencia canónica de arranque del stack Nexus.
 *
 * Escena 1.4 — Fase 1. Ver `ESCENA_1_1_ARRANQUE.md` para el orden de los
 * adapters y `ESCENA_1_4_COMPOSER.md` para el puente de ruta.
 *
 * El orden de las llamadas NO es estilístico. Hidratar después de montar los
 * adapters convierte el arranque de O(N) en O(N²) sin fallar ni avisar. Hay
 * una aserción que lo vigila.
 *
 * El módulo se divide en dos capas porque tienen dependencias distintas:
 *
 *   arrancarDatos()      no toca el DOM. Se puede ejecutar N veces en la
 *                        misma página, y por eso es testeable en aislamiento.
 *   montarInterfaz()     llama a Chunklet.setup, que es one-shot por módulo.
 *
 * Voyajer se creó aquí, en la capa de datos, a partir de esta escena: es una
 * primitiva del stack, no una pieza de interfaz, y el adapter de ruta lo
 * necesita instanciado antes de que ningún widget monte.
 */

import { createNebula } from '../../../src/nebula.js';
import { createStatePulsar } from '../../../src/pulsar.js';
import { createVoyajer } from '../../../src/voyajer.js';
import { createHydrationAdapter } from '../../../src/adapters/hydration-adapter.js';
import { createNebulaPulsarBridge } from '../../../src/adapters/nebula-pulsar-bridge.js';
import { createPersistenceAdapter } from '../../../src/adapters/persistence-adapter.js';
import Chunklet from '../../../src/chunklet.js';

import { CLAVE_SNAPSHOT, leerSnapshot, resolverStorage } from './persistencia.js';
import { crearRutaAdapter, opcionesVoyajer } from './ruta-adapter.js';
import { crearMockProvider } from './mock-provider.js';
import { appShell } from './shell.js';
import { conversationList } from './conversation-list.js';
import { conversationItem } from './conversation-item.js';
import { conversationMessages } from './conversation-messages.js';
import { composer } from './composer.js';

/**
 * Estado inicial de Pulsar con los espacios de nombres reservados por el
 * Nexus Contract §5.1 ya declarados, para que un `subscribeSelector` sobre
 * `ui.algo` no vea `undefined` antes de la primera escritura.
 */
export function estadoInicial() {
  return { route: {}, entities: {}, ui: {}, net: {} };
}

export function crearPrimitivas() {
  return {
    nebula: createNebula(),
    pulsar: createStatePulsar(estadoInicial()),
  };
}

/**
 * Capa de datos: hidratación, adapters y navegación, en el único orden
 * correcto.
 *
 * Recibe las primitivas en vez de crearlas para que un test pueda
 * instrumentarlas antes de que la secuencia corra — el conteo de `setState`
 * durante el arranque es la aserción que protege el invariante de orden.
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
  //    Con Bridge o Persistence ya montados, cada upsert y cada link de la
  //    hidratación atraviesa sus wrappers: N entidades producen 2N setState,
  //    cada uno con coste O(N). Medido: 800 entidades cuestan 1.2 ms en este
  //    orden y 515 ms en el inverso, con el mismo estado final.
  // ----------------------------------------------------------------
  const hidratacion = leerSnapshot(storage, clave);

  if (hidratacion.estado === 'ok') {
    createHydrationAdapter(
      { nebula },
      { snapshot: hidratacion.snapshot, mode: 'merge', onMissingTarget: 'skip' }
    );
  }

  // ----------------------------------------------------------------
  // 2. Bridge. Una sola proyección de todo lo hidratado.
  // ----------------------------------------------------------------
  const bridge = createNebulaPulsarBridge({ nebula, pulsar }, { path: 'entities' });

  // ----------------------------------------------------------------
  // 3. Persistence. `writeOnInit: false`: acabamos de leer de ahí.
  // ----------------------------------------------------------------
  const persistence = createPersistenceAdapter(
    { nebula },
    { key: clave, mode: 'debounced', debounceMs, writeOnInit: false, storage }
  );

  // ----------------------------------------------------------------
  // 4. Voyajer y el puente de ruta.
  //
  //    Después de la hidratación a propósito: el adapter comprueba contra el
  //    modelo si la conversación que pide la URL existe, y para eso el modelo
  //    tiene que estar cargado.
  // ----------------------------------------------------------------
  const voyajer = opciones.voyajer !== undefined
    ? opciones.voyajer
    : createVoyajer(pulsar, { ...opcionesVoyajer, ...(opciones.opcionesVoyajer || {}) });

  const rutaAdapter = voyajer
    ? crearRutaAdapter({ pulsar, nebula, voyajer })
    : null;

  /**
   * Libera en orden inverso al de montaje.
   *
   * `flush()` antes de `destroy()` es deliberado: Persistence no hace flush
   * implícito al destruirse, así que éste es el punto donde una escritura en
   * vuelo se materializa.
   */
  function destruir({ guardarPendiente = true } = {}) {
    if (rutaAdapter) rutaAdapter.destroy();
    if (voyajer && typeof voyajer.destroy === 'function') voyajer.destroy();
    if (guardarPendiente) persistence.flush();
    persistence.destroy();
    bridge.destroy();
  }

  return { bridge, persistence, voyajer, rutaAdapter, hidratacion, destruir };
}

/**
 * Capa de interfaz: stack de Chunklet, definición de behaviors y montaje.
 *
 * `Chunklet.setup` es one-shot por módulo: esta función no se puede ejecutar
 * dos veces en la misma página.
 */
export function montarInterfaz(opciones = {}) {
  const { nebula, pulsar, voyajer, provider } = opciones;
  const raiz = opciones.raiz || document.body;

  const stack = Chunklet.setup({ pulsar, nebula, voyajer });

  Chunklet.define('app-shell', appShell);
  Chunklet.define('conversation-list', conversationList);
  Chunklet.define('conversation-item', conversationItem);
  Chunklet.define('conversation-messages', conversationMessages);

  // El composer recibe el provider por cierre. Es la misma vía que usaba el
  // andamio de la Escena 1.3, que esta escena retira.
  Chunklet.define('composer', (elemento, ctx) => composer(elemento, ctx, { provider }));

  Chunklet.mount(raiz);

  return stack;
}

/**
 * Arranque completo. Es lo que llama `index.html`.
 *
 * @param {object} [opciones]
 * @param {boolean} [opciones.exponerGlobal=false] - Publica el stack en
 *   `window.__nexus` para inspección desde consola. Apagado por defecto: los
 *   behaviors reciben todo por `ctx`, así que un global no hace falta para
 *   funcionar. Encenderlo a voluntad, nunca por costumbre.
 */
export function arrancar(opciones = {}) {
  const { nebula, pulsar } = crearPrimitivas();

  const datos = arrancarDatos({ nebula, pulsar, ...opciones });
  const provider = crearMockProvider({ nebula }, opciones.provider || {});

  const stack = montarInterfaz({
    nebula, pulsar, provider,
    voyajer: datos.voyajer,
    raiz: opciones.raiz,
  });

  const nexus = {
    nebula: stack.nebula,
    pulsar: stack.pulsar,
    voyajer: stack.voyajer,
    bridge: datos.bridge,
    persistence: datos.persistence,
    rutaAdapter: datos.rutaAdapter,
    hidratacion: datos.hidratacion,
    provider,
    destruir: datos.destruir,
  };

  if (opciones.exponerGlobal === true) window.__nexus = nexus;

  return nexus;
}
