/**
 * Persistence Adapter (initial implementation)
 *
 * Contrato: adapters/persistence-adapter.spec.md v0.1.0
 * Implementation version: 0.1.0
 *
 * Observa mutaciones en nebula y persiste el grafo completo a un
 * backend de storage (por defecto localStorage) en la forma canónica
 * que Hydration consume.
 *
 * Modos:
 *   'eager'     - escribe síncrono tras cada mutación
 *   'debounced' - escribe tras N ms de silencio (trailing debounce)
 *
 * Uso:
 *   import { createPersistenceAdapter } from './adapters/persistence-adapter.js';
 *   const p = createPersistenceAdapter(
 *     { nebula },
 *     { key: 'my-app-graph', mode: 'debounced', debounceMs: 300 }
 *   );
 *   // ... vida útil ...
 *   p.flush();   // guardar ya, cancela debounce pendiente
 *   p.destroy(); // desmontar (NO hace flush implícito)
 */

// ============================================
// UTILIDADES PRIVADAS
// ============================================

function _isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function _isnebulaInstance(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.get === 'function' &&
    typeof value.put === 'function' &&
    typeof value.upsert === 'function' &&
    typeof value.update === 'function' &&
    typeof value.delete === 'function' &&
    typeof value.link === 'function' &&
    typeof value.unlink === 'function' &&
    typeof value.unlinkAll === 'function' &&
    typeof value.allIds === 'function'
  );
}

function _isStorageLike(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.getItem === 'function' &&
    typeof value.setItem === 'function' &&
    typeof value.removeItem === 'function'
  );
}

// ============================================
// FACTORY
// ============================================

/**
 * Crea un Persistence Adapter.
 *
 * @param {Object} context
 * @param {nebulaInstance} context.nebula - nebula a observar.
 * @param {Object} options
 * @param {string} options.key - Storage key. Requerido.
 * @param {'eager'|'debounced'} [options.mode='debounced'] - Cuándo escribir.
 * @param {number} [options.debounceMs=200] - Silencio antes de escribir (solo debounced).
 * @param {boolean} [options.writeOnInit=false] - Escribir el estado actual al instanciar.
 * @param {Storage} [options.storage=localStorage] - Backend Web Storage API compatible.
 * @param {(error: Error, phase: 'serialize'|'write') => void} [options.onError] - Handler de errores.
 * @returns {{flush: () => void, destroy: () => void}}
 */
export function createPersistenceAdapter(context, options = {}) {
  // ---------- Validación del context ----------
  if (!context || typeof context !== 'object') {
    throw new TypeError('[PersistenceAdapter] context debe ser un objeto');
  }
  if (!_isnebulaInstance(context.nebula)) {
    throw new TypeError(
      '[PersistenceAdapter] context.nebula debe ser una instancia de nebula'
    );
  }

  // ---------- Validación de opciones ----------
  if (typeof options.key !== 'string' || options.key.trim() === '') {
    throw new TypeError(
      '[PersistenceAdapter] options.key es requerido y debe ser un string no vacío'
    );
  }

  const mode = options.mode !== undefined ? options.mode : 'debounced';
  if (mode !== 'eager' && mode !== 'debounced') {
    throw new TypeError(
      `[PersistenceAdapter] options.mode debe ser 'eager' o 'debounced', recibido: '${mode}'`
    );
  }

  const debounceMs = options.debounceMs !== undefined ? options.debounceMs : 200;
  if (typeof debounceMs !== 'number' || debounceMs < 0) {
    throw new TypeError(
      '[PersistenceAdapter] options.debounceMs debe ser un número no negativo'
    );
  }

  const writeOnInit = options.writeOnInit === true;

  // Storage: default localStorage si estamos en browser; si no, exigir uno inyectado.
  let storage = options.storage;
  if (storage === undefined) {
    if (typeof window !== 'undefined' && window.localStorage) {
      storage = window.localStorage;
    } else {
      throw new TypeError(
        '[PersistenceAdapter] options.storage es requerido cuando window.localStorage no está disponible'
      );
    }
  }
  if (!_isStorageLike(storage)) {
    throw new TypeError(
      '[PersistenceAdapter] options.storage debe exponer getItem/setItem/removeItem'
    );
  }

  const onError = typeof options.onError === 'function'
    ? options.onError
    : (error, phase) => {
        console.warn(`[PersistenceAdapter] fallo en ${phase}:`, error);
      };

  const { nebula } = context;
  const key = options.key;

  // ---------- Estado interno ----------
  const _originals = {
    put: nebula.put,
    upsert: nebula.upsert,
    update: nebula.update,
    delete: nebula.delete,
    link: nebula.link,
    unlink: nebula.unlink,
    unlinkAll: nebula.unlinkAll,
  };

  let _destroyed = false;
  let _pendingTimer = null;

  // ============================================
  // SERIALIZACIÓN Y ESCRITURA
  // ============================================

  /**
   * Serializa el estado actual de nebula en la shape canónica que
   * Hydration consume (ver hydration-adapter.spec.md §3.1) y lo escribe
   * al storage. Los errores se reportan por onError; no se propagan.
   */
  function _serializeAndWrite() {
    if (_destroyed) return;

    let snapshotString;
    try {
      const entities = {};
      const ids = nebula.allIds();
      for (const id of ids) {
        const entity = nebula.get(id);
        // Estructura canónica: { properties, links }
        // Omitimos el 'id' interno del get() porque en la shape del
        // snapshot el id ya es la clave del map de entities.
        entities[id] = {
          properties: entity.properties,
          links: entity.links,
        };
      }
      const snapshot = { entities };
      snapshotString = JSON.stringify(snapshot);
    } catch (error) {
      onError(error, 'serialize');
      return;
    }

    try {
      storage.setItem(key, snapshotString);
    } catch (error) {
      onError(error, 'write');
    }
  }

  /**
   * Programa una escritura según el mode.
   * - eager: escribe síncrono ya.
   * - debounced: (re)inicia el timer.
   */
  function _scheduleWrite() {
    if (_destroyed) return;

    if (mode === 'eager') {
      _serializeAndWrite();
      return;
    }

    // debounced: cancelar timer previo si hay, arrancar nuevo.
    if (_pendingTimer !== null) {
      clearTimeout(_pendingTimer);
    }
    _pendingTimer = setTimeout(() => {
      _pendingTimer = null;
      _serializeAndWrite();
    }, debounceMs);
  }

  // ============================================
  // HELPERS PARA SET SEMANTICS DETECTION
  // ============================================
  //
  // Reutiliza el patrón del Bridge: para link/unlink/unlinkAll,
  // comparamos el shape de links del source pre y post mutación.
  // Si no cambió, era no-op de nebula (G-0), y no programamos
  // escritura.

  function _snapshotLinksOf(id) {
    const entity = nebula.get(id);
    if (!entity || !entity.links) return null;
    const out = {};
    for (const [rel, targets] of Object.entries(entity.links)) {
      out[rel] = [...targets].sort();
    }
    return out;
  }

  function _sameShallowLinks(a, b) {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
      if (!(key in b)) return false;
      const arrA = a[key];
      const arrB = b[key];
      if (arrA.length !== arrB.length) return false;
      for (let i = 0; i < arrA.length; i++) {
        if (arrA[i] !== arrB[i]) return false;
      }
    }
    return true;
  }

  // ============================================
  // WRAPPERS DE MUTACIÓN
  // ============================================

  nebula.put = function(id, properties) {
    if (_destroyed) return _originals.put.call(nebula, id, properties);
    const result = _originals.put.call(nebula, id, properties);
    _scheduleWrite();
    return result;
  };

  nebula.upsert = function(id, properties) {
    if (_destroyed) return _originals.upsert.call(nebula, id, properties);
    const result = _originals.upsert.call(nebula, id, properties);
    _scheduleWrite();
    return result;
  };

  nebula.update = function(id, patch) {
    if (_destroyed) return _originals.update.call(nebula, id, patch);
    const result = _originals.update.call(nebula, id, patch);
    _scheduleWrite();
    return result;
  };

  nebula.delete = function(id) {
    if (_destroyed) return _originals.delete.call(nebula, id);
    const result = _originals.delete.call(nebula, id);
    _scheduleWrite();
    return result;
  };

  nebula.link = function(sourceId, relation, targetId) {
    if (_destroyed) return _originals.link.call(nebula, sourceId, relation, targetId);

    const before = _snapshotLinksOf(sourceId);
    const result = _originals.link.call(nebula, sourceId, relation, targetId);
    const after = _snapshotLinksOf(sourceId);

    if (!_sameShallowLinks(before, after)) {
      _scheduleWrite();
    }
    return result;
  };

  nebula.unlink = function(sourceId, relation, targetId) {
    if (_destroyed) return _originals.unlink.call(nebula, sourceId, relation, targetId);

    const before = _snapshotLinksOf(sourceId);
    const result = _originals.unlink.call(nebula, sourceId, relation, targetId);
    const after = _snapshotLinksOf(sourceId);

    if (!_sameShallowLinks(before, after)) {
      _scheduleWrite();
    }
    return result;
  };

  nebula.unlinkAll = function(sourceId, relation) {
    if (_destroyed) return _originals.unlinkAll.call(nebula, sourceId, relation);

    const before = _snapshotLinksOf(sourceId);
    const result = _originals.unlinkAll.call(nebula, sourceId, relation);
    const after = _snapshotLinksOf(sourceId);

    if (!_sameShallowLinks(before, after)) {
      _scheduleWrite();
    }
    return result;
  };

  // ============================================
  // INICIALIZACIÓN
  // ============================================

  if (writeOnInit) {
    _serializeAndWrite();
  }

  // ============================================
  // API PÚBLICA
  // ============================================

  /**
   * Fuerza una serialización + escritura inmediata, cancelando cualquier
   * timer pendiente. Idempotente: sin pendiente y sin cambios recientes
   * sigue siendo seguro llamarla (escribe el estado actual otra vez).
   *
   * NOTA: flush() escribe el estado actual siempre que se llame. Si se
   * llama sin haber ocurrido mutaciones, escribe la misma snapshot que
   * ya estaba (idempotente en resultado, no en trabajo). Esto es
   * deliberado — la alternativa "solo escribir si hay timer pendiente"
   * introduce confusión sobre cuándo se garantiza persistencia.
   */
  function flush() {
    if (_destroyed) return;

    if (_pendingTimer !== null) {
      clearTimeout(_pendingTimer);
      _pendingTimer = null;
    }
    _serializeAndWrite();
  }

  /**
   * Restaura los métodos originales de nebula, cancela cualquier
   * escritura pendiente y marca el adapter como inerte.
   *
   * NO llama a flush() implícitamente. El caller que quiera "guardar
   * antes de cerrar" debe hacer explícito:
   *   adapter.flush(); adapter.destroy();
   */
  function destroy() {
    if (_destroyed) return;
    _destroyed = true;

    if (_pendingTimer !== null) {
      clearTimeout(_pendingTimer);
      _pendingTimer = null;
    }

    nebula.put = _originals.put;
    nebula.upsert = _originals.upsert;
    nebula.update = _originals.update;
    nebula.delete = _originals.delete;
    nebula.link = _originals.link;
    nebula.unlink = _originals.unlink;
    nebula.unlinkAll = _originals.unlinkAll;
  }

  return {
    flush,
    destroy,
  };
}

export default createPersistenceAdapter;
