/**
 * Lista de entidades — Escena 1.5.
 *
 * El único patrón con dos casos reales entre los cinco widgets construidos:
 * `conversation-list` y `conversation-messages`. Sus funciones de repintado
 * eran estructuralmente la misma, y esta factory la expresa como configuración.
 *
 * Cubre lo que esos dos casos necesitan y nada más. No hay filtros, ni
 * ordenación, ni paginación, ni animaciones: cada una entra cuando exista un
 * widget que la pida. Dos casos es el mínimo de la disciplina D-2, no una
 * licencia para generalizar.
 *
 * ---
 *
 * RECONCILIACIÓN CON CLAVE
 *
 * Resuelve `RECONCILIACION-CON-CLAVE` de `PHASE_1_DEFERRED.md`, y lo hace una
 * sola vez para los dos widgets — que era la razón de haberlo diferido hasta
 * tener la forma común delante.
 *
 * En vez de vaciar el contenedor y reconstruir, se compara la lista nueva con
 * la pintada por identificador y se toca el mínimo:
 *
 *   mismos ids en el mismo orden  -> actualizar atributos y zonas
 *   id nuevo                      -> crear el nodo e insertarlo en su posición
 *   id ausente                    -> retirar el nodo y desmontar su Chunklet
 *   orden distinto                -> mover los nodos, no recrearlos
 *
 * La ganancia medible es de coste, pero la que importa es otra: el nodo de una
 * entidad que no cambió deja de recrearse, así que su estado de DOM sobrevive
 * — foco, selección de texto, desplazamiento interno. Ésa era la condición que
 * convertía la deuda de coste en defecto funcional.
 */

import Chunklet from '../../../src/chunklet.js';
import { zonas as localizarZonas, plantilla as localizarPlantilla } from './zonas.js';

/**
 * @param {Element} elemento - Elemento raíz del widget.
 * @param {object} ctx - Contexto de Chunklet.
 * @param {object} config
 * @param {string} config.contenedor - Nombre de la zona que aloja los nodos.
 * @param {string} config.plantilla - Nombre de la plantilla de cada nodo.
 * @param {string} [config.vacio] - Zona a mostrar cuando la lista está vacía.
 * @param {string} [config.raizDelClon] - Selector del nodo raíz dentro del
 *   clon. Por defecto el primer elemento del fragmento.
 * @param {function} config.selector - `(estado) => Array<{id, ...}>`.
 * @param {function} [config.equality] - Igualdad del selector.
 * @param {function} [config.atributos] - `(entidad) => ({clave: valor})`,
 *   escritos como `data-*` en el nodo.
 * @param {object} [config.zonas] - `{nombreZona: (entidad) => texto}`.
 * @param {boolean} [config.montarAnidados=false] - Si cada nodo declara un
 *   `data-chunk` que hay que montar y desmontar.
 * @param {function} [config.antesDePintar] - Gancho previo. Su valor de
 *   retorno se pasa al gancho posterior.
 * @param {function} [config.despuesDePintar] - Gancho posterior.
 * @param {string} [config.nombre='lista'] - Para los mensajes de error.
 *
 * @returns {object} asa con contadores de operaciones de DOM y `zonaDe(id)`.
 */
export function crearListaDeEntidades(elemento, ctx, config) {
  const nombre = config.nombre || 'lista';

  const z = localizarZonas(
    elemento,
    { [config.contenedor]: true, ...(config.vacio ? { [config.vacio]: false } : {}) },
    nombre
  );
  const contenedor = z[config.contenedor];
  const zonaVacia = config.vacio ? z[config.vacio] : null;
  const plantilla = localizarPlantilla(elemento, config.plantilla, nombre);

  /** Nodo montado por identificador, en el orden en que están en el DOM. */
  const nodosPorId = new Map();
  /** Zonas de cada nodo, para que el widget pueda escribirlas sin buscarlas. */
  const zonasPorId = new Map();

  // Contadores. No son diagnóstico decorativo: son la única forma de afirmar
  // que la reconciliación hace lo mínimo. El DOM resultante es idéntico se
  // haya llegado a él recreando todo o moviendo un nodo — disciplina D-7.
  const cuenta = { creados: 0, destruidos: 0, movidos: 0, actualizados: 0 };

  // ----------------------------------------------------------------
  // Creación y actualización de un nodo
  // ----------------------------------------------------------------
  function crearNodo(entidad) {
    const fragmento = plantilla.content.cloneNode(true);
    const nodo = config.raizDelClon
      ? fragmento.querySelector(config.raizDelClon)
      : fragmento.firstElementChild;

    if (!nodo) {
      throw new Error(`[${nombre}] la plantilla "${config.plantilla}" no contiene un elemento`);
    }

    nodo.dataset.entity = entidad.id;
    cuenta.creados++;
    return nodo;
  }

  function escribirNodo(nodo, entidad) {
    if (config.atributos) {
      for (const [clave, valor] of Object.entries(config.atributos(entidad))) {
        if (valor === undefined || valor === null) delete nodo.dataset[clave];
        else if (nodo.dataset[clave] !== String(valor)) nodo.dataset[clave] = String(valor);
      }
    }

    if (config.zonas) {
      let mapa = zonasPorId.get(entidad.id);
      if (!mapa) {
        mapa = new Map();
        for (const clave of Object.keys(config.zonas)) {
          const z = nodo.querySelector(`[data-zona="${clave}"]`);
          if (z) mapa.set(clave, z);
        }
        zonasPorId.set(entidad.id, mapa);
      }
      for (const [clave, derivar] of Object.entries(config.zonas)) {
        const z = mapa.get(clave);
        if (!z) continue;
        const texto = String(derivar(entidad) ?? '');
        // Comparar antes de escribir: asignar textContent invalida el layout
        // aunque el valor sea el mismo.
        if (z.textContent !== texto) z.textContent = texto;
      }
    }
  }

  function retirarNodo(id) {
    const nodo = nodosPorId.get(id);
    if (!nodo) return;
    // El Chunklet anidado se desmonta ANTES de quitar el nodo del documento:
    // su cleanup puede necesitar el elemento todavía conectado.
    if (config.montarAnidados) Chunklet.unmount(nodo);
    nodo.remove();
    nodosPorId.delete(id);
    zonasPorId.delete(id);
    cuenta.destruidos++;
  }

  // ----------------------------------------------------------------
  // Reconciliación
  // ----------------------------------------------------------------
  function reconciliar(lista) {
    const previo = config.antesDePintar ? config.antesDePintar() : undefined;

    const idsNuevos = new Set(lista.map((e) => e.id));

    // 1. Retirar lo que ya no está. Se recogen primero para no mutar el mapa
    //    mientras se recorre.
    for (const id of [...nodosPorId.keys()]) {
      if (!idsNuevos.has(id)) retirarNodo(id);
    }

    // 2. Recorrer la lista deseada colocando cada nodo en su sitio.
    //
    //    `referencia` avanza por los hijos actuales del contenedor. Si el nodo
    //    que toca ya está ahí, no se toca nada; si no, se inserta o se mueve
    //    delante de la referencia. Un solo recorrido, sin índices que
    //    recalcular.
    let referencia = contenedor.firstElementChild;

    for (const entidad of lista) {
      let nodo = nodosPorId.get(entidad.id);
      const existia = !!nodo;

      if (!nodo) {
        nodo = crearNodo(entidad);
        nodosPorId.set(entidad.id, nodo);
      }

      if (nodo === referencia) {
        // Ya está en su sitio. Avanzar la referencia.
        referencia = referencia.nextElementSibling;
      } else {
        contenedor.insertBefore(nodo, referencia);
        if (existia) cuenta.movidos++;
      }

      escribirNodo(nodo, entidad);
      if (existia) cuenta.actualizados++;

      // El montaje va después de insertar y escribir: el factory anidado
      // recibe un elemento ya conectado y ya poblado.
      if (!existia && config.montarAnidados) Chunklet.mount(nodo);
    }

    if (zonaVacia) zonaVacia.hidden = lista.length > 0;
    if (config.despuesDePintar) config.despuesDePintar(previo, lista);
  }

  // ----------------------------------------------------------------
  // Suscripción
  // ----------------------------------------------------------------
  ctx.subscribeSelector(
    config.selector,
    (lista) => reconciliar(lista || []),
    { equality: config.equality, immediate: true }
  );

  // ----------------------------------------------------------------
  // Teardown
  // ----------------------------------------------------------------
  //
  // La suscripción la libera el contexto. Los nodos no: son Chunklets que esta
  // factory montó a mano, así que esta factory los desmonta a mano.
  //
  ctx.cleanup(() => {
    for (const id of [...nodosPorId.keys()]) retirarNodo(id);
    contenedor.textContent = '';
  });

  return {
    get cuenta() { return { ...cuenta }; },
    reiniciarCuenta() {
      cuenta.creados = 0; cuenta.destruidos = 0;
      cuenta.movidos = 0; cuenta.actualizados = 0;
    },
    nodoDe(id) { return nodosPorId.get(id) || null; },
    zonaDe(id, clave) {
      const mapa = zonasPorId.get(id);
      return mapa ? mapa.get(clave) || null : null;
    },
    get tamano() { return nodosPorId.size; },
  };
}

export default crearListaDeEntidades;
