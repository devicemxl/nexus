/**
 * Graphlet ↔ Pulsar Bridge (implementación inicial, snapshot-based)
 *
 * Contrato: adapters/graphlet-pulsar-bridge.spec.md v0.1.0
 * Implementation version: 0.1.0
 * Status: initial (snapshot-based, NOT the reactive per-entity version)
 *
 * Cumple el contrato externo de la mini-spec pero con perfil de coste
 * distinto al ideal: cada mutación re-proyecta todas las entidades.
 * Aceptable para aplicaciones tempranas con conjuntos pequeños.
 * La versión reactiva por-entidad queda diferida (ver §7 de la mini-spec).
 *
 * Uso:
 *   import { createGraphletPulsarBridge } from './adapters/graphlet-pulsar-bridge.js';
 *   const bridge = createGraphletPulsarBridge(
 *     { graphlet, pulsar },
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

function _isGraphletInstance(value) {
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
 * Crea un bridge Graphlet↔Pulsar.
 *
 * @param {Object} context
 * @param {GraphletInstance} context.graphlet - Instancia Graphlet a observar.
 * @param {PulsarInstance} context.pulsar - Instancia Pulsar donde proyectar.
 * @param {Object} [options]
 * @param {string} [options.path='entities'] - Ruta en Pulsar donde escribir.
 *   Puede ser plana ('entities') o punteada ('domain.entities').
 * @param {boolean} [options.skipInitialSync=false] - Si true, no proyecta
 *   entidades existentes al instanciar.
 * @returns {{destroy: () => void}}
 */
export function createGraphletPulsarBridge(context, options = {}) {
  // Validación del context
  if (!context || typeof context !== 'object') {
    throw new TypeError('[GraphletPulsarBridge] context debe ser un objeto');
  }
  if (!_isGraphletInstance(context.graphlet)) {
    throw new TypeError('[GraphletPulsarBridge] context.graphlet debe ser una instancia de Graphlet');
  }
  if (!_isPulsarInstance(context.pulsar)) {
    throw new TypeError('[GraphletPulsarBridge] context.pulsar debe ser una instancia de Pulsar');
  }

  const { graphlet, pulsar } = context;
  const path = (options.path && typeof options.path === 'string') ? options.path : 'entities';
  const skipInitialSync = options.skipInitialSync === true;

  // Guardar referencias a los métodos originales para restaurar en destroy.
  const _originals = {
    put: graphlet.put,
    upsert: graphlet.upsert,
    update: graphlet.update,
    delete: graphlet.delete,
    link: graphlet.link,
    unlink: graphlet.unlink,
    unlinkAll: graphlet.unlinkAll,
  };

  let _destroyed = false;

  // ============================================
  // PROYECCIÓN (snapshot-based)
  // ============================================

  /**
   * Re-proyecta TODAS las entidades de Graphlet en Pulsar bajo `path`.
   * Es O(N) donde N = número de entidades. Aceptable para conjuntos
   * pequeños; la versión reactiva por-entidad reduce a O(1).
   */
  function _reprojectAll() {
    if (_destroyed) return;

    const projection = {};
    const ids = graphlet.allIds();
    for (const id of ids) {
      projection[id] = graphlet.get(id);
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

  graphlet.put = function(id, properties) {
    if (_destroyed) {
      // El adapter fue destruido pero alguien tiene aún la referencia
      // wrappeada. Delega al original si aún existe en _originals.
      // (En destroy restauramos los originals, así que esto solo
      // sucede si otro código guardó la referencia wrappeada.)
      return _originals.put.call(graphlet, id, properties);
    }
    const result = _originals.put.call(graphlet, id, properties);
    _reprojectAll();
    return result;
  };

  graphlet.upsert = function(id, properties) {
    if (_destroyed) return _originals.upsert.call(graphlet, id, properties);
    const result = _originals.upsert.call(graphlet, id, properties);
    _reprojectAll();
    return result;
  };

  graphlet.update = function(id, patch) {
    if (_destroyed) return _originals.update.call(graphlet, id, patch);
    const result = _originals.update.call(graphlet, id, patch);
    _reprojectAll();
    return result;
  };

  graphlet.delete = function(id) {
    if (_destroyed) return _originals.delete.call(graphlet, id);
    const result = _originals.delete.call(graphlet, id);
    _reprojectAll();
    return result;
  };

  graphlet.link = function(sourceId, relation, targetId) {
    if (_destroyed) return _originals.link.call(graphlet, sourceId, relation, targetId);

    // Set semantics detection: capturar el shape del source antes.
    // Si no cambia después, era un no-op y no re-proyectamos.
    const before = _snapshotLinksOf(sourceId);
    const result = _originals.link.call(graphlet, sourceId, relation, targetId);
    const after = _snapshotLinksOf(sourceId);

    if (!_sameShallowLinks(before, after)) {
      _reprojectAll();
    }
    return result;
  };

  graphlet.unlink = function(sourceId, relation, targetId) {
    if (_destroyed) return _originals.unlink.call(graphlet, sourceId, relation, targetId);

    const before = _snapshotLinksOf(sourceId);
    const result = _originals.unlink.call(graphlet, sourceId, relation, targetId);
    const after = _snapshotLinksOf(sourceId);

    if (!_sameShallowLinks(before, after)) {
      _reprojectAll();
    }
    return result;
  };

  graphlet.unlinkAll = function(sourceId, relation) {
    if (_destroyed) return _originals.unlinkAll.call(graphlet, sourceId, relation);

    const before = _snapshotLinksOf(sourceId);
    const result = _originals.unlinkAll.call(graphlet, sourceId, relation);
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
    const entity = graphlet.get(id);
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

    // Restaurar los métodos originales en la instancia de Graphlet.
    // A partir de este punto, las mutaciones no producen re-proyección.
    graphlet.put = _originals.put;
    graphlet.upsert = _originals.upsert;
    graphlet.update = _originals.update;
    graphlet.delete = _originals.delete;
    graphlet.link = _originals.link;
    graphlet.unlink = _originals.unlink;
    graphlet.unlinkAll = _originals.unlinkAll;

    // No tocamos Pulsar state. La proyección permanece; la aplicación
    // decide si limpiarla.
  }

  return {
    destroy,
  };
}

export default createGraphletPulsarBridge;
