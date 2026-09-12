/**
 * nebula ↔ Pulsar Bridge (implementación inicial, snapshot-based)
 *
 * Contrato: adapters/nebula-pulsar-bridge.spec.md v0.1.0
 * Implementation version: 0.1.0
 * Status: initial (snapshot-based, NOT the reactive per-entity version)
 *
 * Cumple el contrato externo de la mini-spec pero con perfil de coste
 * distinto al ideal: cada mutación re-proyecta todas las entidades.
 * Aceptable para aplicaciones tempranas con conjuntos pequeños.
 * La versión reactiva por-entidad queda diferida (ver §7 de la mini-spec).
 *
 * Uso:
 *   import { createnebulaPulsarBridge } from './adapters/nebula-pulsar-bridge.js';
 *   const bridge = createnebulaPulsarBridge(
 *     { nebula, pulsar },
 *     { path: 'entities' }
 *   );
 *   // ... vida útil de la aplicación ...
 *   bridge.destroy();
 */

// ============================================
// UTILIDADES PRIVADAS (compartidas con Chunklet en filosofía)
// ============================================

function _getByPath(obj, path) {
  if (!path) return obj;
  const segments = path.split('.');
  let value = obj;
  for (const segment of segments) {
    if (value === null || value === undefined || typeof value !== 'object') {
      return undefined;
    }
    value = value[segment];
  }
  return value;
}

function _setByPath(obj, path, value) {
  const segments = path.split('.');
  if (segments.length === 1) {
    return { ...obj, [segments[0]]: value };
  }
  const [first, ...rest] = segments;
  const current = obj[first];
  const child = (current && typeof current === 'object' && !Array.isArray(current))
    ? current
    : {};
  return {
    ...obj,
    [first]: _setByPath(child, rest.join('.'), value)
  };
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

function _isPulsarInstance(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.getState === 'function' &&
    typeof value.setState === 'function'
  );
}

// ============================================
// FACTORY
// ============================================

/**
 * Crea un bridge nebula↔Pulsar.
 *
 * @param {Object} context
 * @param {nebulaInstance} context.nebula - Instancia nebula a observar.
 * @param {PulsarInstance} context.pulsar - Instancia Pulsar donde proyectar.
 * @param {Object} [options]
 * @param {string} [options.path='entities'] - Ruta en Pulsar donde escribir.
 *   Puede ser plana ('entities') o punteada ('domain.entities').
 * @param {boolean} [options.skipInitialSync=false] - Si true, no proyecta
 *   entidades existentes al instanciar.
 * @returns {{destroy: () => void}}
 */
export function createnebulaPulsarBridge(context, options = {}) {
  // Validación del context
  if (!context || typeof context !== 'object') {
    throw new TypeError('[nebulaPulsarBridge] context debe ser un objeto');
  }
  if (!_isnebulaInstance(context.nebula)) {
    throw new TypeError('[nebulaPulsarBridge] context.nebula debe ser una instancia de nebula');
  }
  if (!_isPulsarInstance(context.pulsar)) {
    throw new TypeError('[nebulaPulsarBridge] context.pulsar debe ser una instancia de Pulsar');
  }

  const { nebula, pulsar } = context;
  const path = (options.path && typeof options.path === 'string') ? options.path : 'entities';
  const skipInitialSync = options.skipInitialSync === true;

  // Guardar referencias a los métodos originales para restaurar en destroy.
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

  // ============================================
  // PROYECCIÓN (snapshot-based)
  // ============================================

  /**
   * Re-proyecta TODAS las entidades de nebula en Pulsar bajo `path`.
   * Es O(N) donde N = número de entidades. Aceptable para conjuntos
   * pequeños; la versión reactiva por-entidad reduce a O(1).
   */
  function _reprojectAll() {
    if (_destroyed) return;

    const projection = {};
    const ids = nebula.allIds();
    for (const id of ids) {
      projection[id] = nebula.get(id);
    }

    // Construir el nuevo estado preservando otras claves y respetando path.
    const currentState = pulsar.getState();
    const nextState = _setByPath(currentState, path, projection);
    pulsar.setState(nextState);
  }

  // ============================================
  // WRAPPERS DE MUTACIÓN
  // ============================================
  //
  // Cada wrapper llama al método original y luego re-proyecta.
  // Para `link`, se aplica set semantics detection: si el array de
  // targets del source no cambió (era no-op), no se re-proyecta.
  // Para `unlink`, análogamente: si el target no estaba, no se
  // re-proyecta.

  nebula.put = function(id, properties) {
    if (_destroyed) {
      // El adapter fue destruido pero alguien tiene aún la referencia
      // wrappeada. Delega al original si aún existe en _originals.
      // (En destroy restauramos los originals, así que esto solo
      // sucede si otro código guardó la referencia wrappeada.)
      return _originals.put.call(nebula, id, properties);
    }
    const result = _originals.put.call(nebula, id, properties);
    _reprojectAll();
    return result;
  };

  nebula.upsert = function(id, properties) {
    if (_destroyed) return _originals.upsert.call(nebula, id, properties);
    const result = _originals.upsert.call(nebula, id, properties);
    _reprojectAll();
    return result;
  };

  nebula.update = function(id, patch) {
    if (_destroyed) return _originals.update.call(nebula, id, patch);
    const result = _originals.update.call(nebula, id, patch);
    _reprojectAll();
    return result;
  };

  nebula.delete = function(id) {
    if (_destroyed) return _originals.delete.call(nebula, id);
    const result = _originals.delete.call(nebula, id);
    _reprojectAll();
    return result;
  };

  nebula.link = function(sourceId, relation, targetId) {
    if (_destroyed) return _originals.link.call(nebula, sourceId, relation, targetId);

    // Set semantics detection: capturar el shape del source antes.
    // Si no cambia después, era un no-op y no re-proyectamos.
    const before = _snapshotLinksOf(sourceId);
    const result = _originals.link.call(nebula, sourceId, relation, targetId);
    const after = _snapshotLinksOf(sourceId);

    if (!_sameShallowLinks(before, after)) {
      _reprojectAll();
    }
    return result;
  };

  nebula.unlink = function(sourceId, relation, targetId) {
    if (_destroyed) return _originals.unlink.call(nebula, sourceId, relation, targetId);

    const before = _snapshotLinksOf(sourceId);
    const result = _originals.unlink.call(nebula, sourceId, relation, targetId);
    const after = _snapshotLinksOf(sourceId);

    if (!_sameShallowLinks(before, after)) {
      _reprojectAll();
    }
    return result;
  };

  nebula.unlinkAll = function(sourceId, relation) {
    if (_destroyed) return _originals.unlinkAll.call(nebula, sourceId, relation);

    const before = _snapshotLinksOf(sourceId);
    const result = _originals.unlinkAll.call(nebula, sourceId, relation);
    const after = _snapshotLinksOf(sourceId);

    if (!_sameShallowLinks(before, after)) {
      _reprojectAll();
    }
    return result;
  };

  // ============================================
  // HELPERS PARA SET SEMANTICS DETECTION
  // ============================================

  /**
   * Snapshot ligero de los links de una entidad para comparación
   * pre/post mutación. Retorna una representación estable: para
   * cada relación, un array ordenado alfabéticamente de targets.
   * Si la entidad no existe, retorna null.
   */
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
  // INICIALIZACIÓN
  // ============================================

  if (!skipInitialSync) {
    _reprojectAll();
  }

  // ============================================
  // API PÚBLICA
  // ============================================

  function destroy() {
    if (_destroyed) return; // Idempotente
    _destroyed = true;

    // Restaurar los métodos originales en la instancia de nebula.
    // A partir de este punto, las mutaciones no producen re-proyección.
    nebula.put = _originals.put;
    nebula.upsert = _originals.upsert;
    nebula.update = _originals.update;
    nebula.delete = _originals.delete;
    nebula.link = _originals.link;
    nebula.unlink = _originals.unlink;
    nebula.unlinkAll = _originals.unlinkAll;

    // No tocamos Pulsar state. La proyección permanece; la aplicación
    // decide si limpiarla.
  }

  return {
    destroy,
  };
}

export default createnebulaPulsarBridge;
