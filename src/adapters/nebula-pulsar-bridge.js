/**
 * nebula ↔ Pulsar Bridge (implementación inicial, snapshot-based)
 *
 * Contrato: adapters/nebula-pulsar-bridge.spec.md v0.3.0
 * Implementation version: 0.3.0
 * Status: reactive per-entity projection (Camino 2)
 *
 * Cambios respecto a v0.2.0 (sin cambio de API pública):
 * - Proyección por entidad. Ninguna ruta de mutación llama a
 *   `_reprojectAll`; queda reservado para la sincronización inicial.
 *   Las entidades no afectadas conservan su referencia, de modo que un
 *   consumidor suscrito a `entities[X]` con `Object.is` deja de
 *   despertarse por mutaciones ajenas a X. Cierra `BRIDGE-REACTIVE`.
 * - `delete` escanea los links entrantes antes de borrar y proyecta el
 *   conjunto `[id, ...afectados]` en un solo `setState`. Es el único
 *   método con coste O(N), tal como anticipaba el Camino 2.
 *
 * Cambios respecto a v0.1.0 (sin cambio de API pública):
 * - Los wrappers se instalan vía `adapter-chain.js` en vez de capturar
 *   y restaurar `nebula.put` etc. directamente. Destruir adapters en
 *   cualquier orden deja de romper la cadena en silencio.
 *
 * Uso:
 *   import { createNebulaPulsarBridge } from './adapters/nebula-pulsar-bridge.js';
 *   const bridge = createNebulaPulsarBridge(
 *     { nebula, pulsar },
 *     { path: 'entities' }
 *   );
 *   // ... vida útil de la aplicación ...
 *   bridge.destroy();
 */

import { wrap, unwrap } from './adapter-chain.js';

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
export function createNebulaPulsarBridge(context, options = {}) {
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

  // Handles de la cadena de wrappers (adapter-chain.js). Sustituyen al
  // antiguo `_originals`: la cadena se empalma al retirar una entrada,
  // de modo que el orden de `destroy` entre adapters deja de importar.
  const _handles = [];

  let _destroyed = false;

  // ============================================
  // PROYECCIÓN (snapshot-based)
  // ============================================

  /**
   * Proyecta TODAS las entidades de nebula bajo `path`.
   *
   * Desde v0.3.0 esta función se usa ÚNICAMENTE en la sincronización
   * inicial, que es donde un barrido completo siempre fue lo correcto.
   * Ninguna ruta de mutación la llama.
   *
   * Es también el mecanismo de reconciliación completa disponible para la
   * aplicación, sin API nueva: `bridge.destroy()` seguido de un
   * `createNebulaPulsarBridge` nuevo con `skipInitialSync: false` rehace la
   * proyección desde cero. Efecto lateral a tener en cuenta: recrear el
   * bridge lo coloca como wrapper más externo de la cadena, así que cambia
   * el orden de emisión respecto a Persistence y Logging.
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

  /**
   * Proyecta UNA entidad. Si dejó de existir, la retira de la proyección.
   *
   * Las N-1 entidades no tocadas conservan su referencia, que es la
   * propiedad que compra el Camino 2: un consumidor suscrito a
   * `entities[X]` con `Object.is` deja de despertarse por mutaciones
   * ajenas a X.
   *
   * Sobre el coste: el spread copia N punteros y no hay forma de evitarlo
   * sin romper la inmutabilidad de Pulsar. Lo que baja de N a 1 es el
   * número de llamadas a `nebula.get`, el número de objetos que
   * `deepFreeze` recorre — 3 por entidad más 2 fijos, medido — y el
   * número de listeners de entidad que se invocan. No el trabajo total.
   */
  function _projectEntity(id) {
    if (_destroyed) return;
    _projectMany([id]);
  }

  /**
   * Proyecta un conjunto acotado de entidades en un solo `setState`, para
   * que no haya ventana intermedia en la que Pulsar describa un grafo que
   * nunca existió.
   */
  function _projectMany(ids) {
    if (_destroyed) return;

    const currentState = pulsar.getState();
    const actuales = _getByPath(currentState, path) || {};
    const siguientes = { ...actuales };

    for (const id of ids) {
      const entidad = nebula.get(id);
      if (entidad) siguientes[id] = entidad;
      else delete siguientes[id];
    }

    pulsar.setState(_setByPath(currentState, path, siguientes));
  }

  /**
   * Ids de entidades con un link entrante hacia `objetivo`. Es el escaneo
   * O(N) que el Camino 2 acepta pagar sólo en `delete`, porque nebula no
   * mantiene índice inverso y el borrado limpia esas referencias.
   */
  function _idsQueApuntanA(objetivo) {
    return nebula.query((id, _props, links) => {
      if (id === objetivo) return false;
      for (const targets of Object.values(links)) {
        if (targets.includes(objetivo)) return true;
      }
      return false;
    });
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

  // --- 2a: conocen el id afectado por argumento ---

  _handles.push(wrap(nebula, 'put', function (next, id, properties) {
    const result = next(id, properties);
    _projectEntity(id);
    return result;
  }));

  _handles.push(wrap(nebula, 'upsert', function (next, id, properties) {
    const result = next(id, properties);
    _projectEntity(id);
    return result;
  }));

  _handles.push(wrap(nebula, 'update', function (next, id, patch) {
    const result = next(id, patch);
    _projectEntity(id);
    return result;
  }));

  // --- 2b: mutan los links del source ---
  //
  // Set semantics detection: si el shape de links del source no cambia, la
  // mutación fue no-op de nebula (G-0) y no se proyecta nada.

  _handles.push(wrap(nebula, 'link', function (next, sourceId, relation, targetId) {
    const before = _snapshotLinksOf(sourceId);
    const result = next(sourceId, relation, targetId);
    const after = _snapshotLinksOf(sourceId);
    if (!_sameShallowLinks(before, after)) _projectEntity(sourceId);
    return result;
  }));

  _handles.push(wrap(nebula, 'unlink', function (next, sourceId, relation, targetId) {
    const before = _snapshotLinksOf(sourceId);
    const result = next(sourceId, relation, targetId);
    const after = _snapshotLinksOf(sourceId);
    if (!_sameShallowLinks(before, after)) _projectEntity(sourceId);
    return result;
  }));

  _handles.push(wrap(nebula, 'unlinkAll', function (next, sourceId, relation) {
    const before = _snapshotLinksOf(sourceId);
    const result = next(sourceId, relation);
    const after = _snapshotLinksOf(sourceId);
    if (!_sameShallowLinks(before, after)) _projectEntity(sourceId);
    return result;
  }));

  // --- 2c: el único que no conoce a todos los afectados ---
  //
  // El orden es load-bearing y por eso está escrito paso a paso:
  //
  //   1. escanear y capturar los afectados, ANTES de borrar (después ya no
  //      hay forma de saber quién apuntaba a la entidad);
  //   2. delegar;
  //   3. proyectar SÓLO si (2) retornó.
  //
  // `nebula.delete` lanza si la entidad no existe. Con `_reprojectAll` esto
  // era gratis porque nunca se llegaba a proyectar; con la lista capturada
  // de antemano es fácil proyectar un borrado que no ocurrió y dejar Pulsar
  // describiendo un grafo distinto del real.

  _handles.push(wrap(nebula, 'delete', function (next, id) {
    const afectados = _idsQueApuntanA(id);
    const result = next(id);
    _projectMany([id, ...afectados]);
    return result;
  }));

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

    // Retirar las entradas de la cadena. Los demás adapters montados
    // sobre la misma nebula siguen operativos, se hayan montado antes o
    // después de éste.
    for (const handle of _handles) unwrap(handle);
    _handles.length = 0;

    // No tocamos Pulsar state. La proyección permanece; la aplicación
    // decide si limpiarla.
  }

  return {
    destroy,
  };
}

export default createNebulaPulsarBridge;
