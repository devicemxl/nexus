/**
 * exo — secuencia de arranque.
 *
 * Versión 0.1.0.
 *
 * POR QUÉ ESTÁ EN UN ARCHIVO APARTE
 *
 * `exo.js` tiene una cláusula que le paga: no importa Nexus, y por eso su
 * cargador se puede usar en una página sin stack. Este módulo sí lo importa
 * —nebula, Hydration, Chunklet— así que vive aparte. Quien sólo quiera
 * cargar piezas no arrastra el stack entero.
 *
 * QUÉ FIJA
 *
 * El ORDEN, que es lo único que dos arranques distintos han tenido en común:
 *
 *   1. hidratar sobre el grafo CRUDO
 *   2. setup del stack
 *   3. cargar piezas (registrar behaviors + traer markup)
 *   4. un solo montaje
 *
 * El paso 1 va primero y no es negociable. Con un Bridge montado, cada upsert
 * y cada link de la hidratación atraviesa su wrapper: N entidades producen 2N
 * setState, cada uno O(N). Medido en el chat: 800 entidades cuestan 1.2 ms en
 * este orden y 515 ms en el inverso, con el mismo estado final. El orden
 * equivocado no falla, sólo tarda.
 *
 * FUENTES DE DATOS
 *
 * `fuente` es cualquier función `() => Promise<snapshot> | snapshot`. Ésa es
 * toda la costura. Un lector nuevo —un binding de Go en Wails, un comando de
 * Tauri, un WebSocket, un archivo embebido— es una función más, y este
 * archivo no cambia para admitirlo:
 *
 *     await arrancar({ fuente: () => window.go.app.Backend.Cargar() });
 *
 * Aquí se incluye UN lector, `desdeUrl`, que es el caso que existe. No hay
 * catálogo. En particular NO hay lector de localStorage: el único caso real
 * —el chat— trae validación de forma, ensayo de hidratación y cuarentena del
 * blob ilegible, y eso es política de la aplicación. Una versión ingenua aquí
 * sería una trampa: parecería la vía buena y perdería datos en silencio.
 *
 * LÍMITE DECLARADO
 *
 * Con dos arranques de evidencia, esto cubre uno entero y medio del otro. El
 * chat además monta Bridge y Persistence, que aquí no están porque este
 * ejemplo no los usa y añadirlos sería diseñar contra un caso que no tengo
 * delante. Ver REFINAMIENTOS al final.
 */

import { createNebula } from '../src/nebula.js';
import { createHydrationAdapter } from '../src/adapters/hydration-adapter.js';
import * as Chunklet from '../src/chunklet.js';

import { cargarPiezas, traerJson } from './exo.js';

export const VERSION = '0.1.0';

/**
 * Los cuatro espacios que el Nexus Contract §5.1 reserva, declarados desde el
 * arranque para que un selector sobre `ui.algo` no vea `undefined` antes de
 * la primera escritura y notifique la aparición de la rama como si fuera un
 * cambio de valor.
 */
export function estadoInicial() {
  return { route: {}, entities: {}, ui: {}, net: {} };
}

/** Lector: un snapshot servido por HTTP. */
export function desdeUrl(url) {
  return () => traerJson(url);
}

/**
 * @param {object} [opciones]
 * @param {function} [opciones.fuente] - `() => Promise<snapshot>|snapshot`.
 *   Sin ella se arranca con el grafo vacío.
 * @param {Element|false} [opciones.piezas=document.body] - Raíz donde buscar
 *   anclajes `data-pieza`. `false` los omite.
 * @param {string} [opciones.base] - Directorio de piezas, para `cargarPiezas`.
 * @param {Element} [opciones.raiz=document.body] - Raíz del montaje.
 * @param {object} [opciones.estadoInicial] - Sustituye al de arriba.
 * @returns {Promise<{nebula, pulsar, stack, modulos}>}
 */
export async function arrancar(opciones = {}) {
  const {
    fuente,
    piezas = document.body,
    base,
    raiz = document.body,
    estadoInicial: inicial = estadoInicial(),
  } = opciones;

  // ------------------------------------------------------------------
  // 1. Hidratar sobre el grafo crudo.
  // ------------------------------------------------------------------
  const nebula = createNebula();

  if (fuente !== undefined) {
    if (typeof fuente !== 'function') {
      throw new TypeError(
        '[exo] `fuente` debe ser una función que devuelva un snapshot; ' +
        'para una URL, usa desdeUrl(url)'
      );
    }
    createHydrationAdapter(
      { nebula },
      { snapshot: await fuente(), mode: 'merge', onMissingTarget: 'skip' }
    );
  }

  // ------------------------------------------------------------------
  // 2. Setup.
  // ------------------------------------------------------------------
  const stack = Chunklet.setup({ pulsar: { initialState: inicial }, nebula });

  // ------------------------------------------------------------------
  // 3. Piezas. Registran behaviors y aportan markup; no montan nada.
  // ------------------------------------------------------------------
  const modulos = piezas
    ? await cargarPiezas(piezas, base !== undefined ? { base } : {})
    : [];

  // ------------------------------------------------------------------
  // 4. Un solo montaje. Cada pieza monta su contenido dentro de forma
  //    síncrona, así que al volver de aquí el árbol está completo.
  // ------------------------------------------------------------------
  Chunklet.mount(raiz);

  return { nebula, pulsar: stack.pulsar, stack, modulos };
}

/**
 * REFINAMIENTOS
 *
 * Anotados, no decididos. Cada uno entra cuando exista un segundo caso que
 * lo pida, no antes.
 *
 * 1. NAVEGACIÓN. Hoy la aplicación llama a `Chunklet.configure({ voyajer })`
 *    después de `arrancar`, porque las rutas válidas suelen derivarse del
 *    modelo y ése no existía al llamar a `setup`. Funciona y no acopla nada.
 *    La forma candidata sería una opción `ruta: (nebula) => opcionesVoyajer`,
 *    invocada entre los pasos 2 y 4. Lo que hay que resolver antes: si el
 *    montaje debe ocurrir con la ruta ya sincronizada o sin ella. Los dos
 *    casos que tengo montan primero, pero ninguno lo eligió — salió así.
 *
 * 2. BRIDGE Y PERSISTENCE. El chat los monta entre la hidratación y el resto;
 *    este ejemplo no los usa. Si entran, el orden que este archivo protege se
 *    vuelve aún más cargante de sentido, porque es justo el Bridge el que
 *    convierte el orden inverso en O(N²).
 *
 * 3. RECARGA DE PIEZAS. `cargarPieza` lanza si el anclaje no está vacío:
 *    reemplazar dejaría huérfanos los chunklets de dentro. Aquí sí hay
 *    `Chunklet.unmount` disponible, así que este módulo podría ofrecer un
 *    `recargar(anclaje)` que `exo.js` no puede. Falta el caso que lo pida.
 */
