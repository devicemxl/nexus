/**
 * External Event Adapter (initial implementation, BroadcastChannel-based)
 *
 * Contrato: adapters/external-event-adapter.spec.md v0.1.0
 * Implementation version: 0.1.0
 *
 * Sincronización bidireccional cross-tab de mutaciones de Graphlet vía
 * BroadcastChannel, con anti-eco explícito por origin+original.
 *
 * Limitaciones documentadas (mini-spec §4.1, §4.2, §6):
 * - No re-proyecta a Pulsar en el tab receptor (Bridge no se dispara).
 * - No persiste en el tab receptor (Persistence no se dispara).
 * - No ordena eventos entre tabs; no resuelve conflictos.
 * Ambas limitaciones son deuda técnica documentada; ver §7 de la spec.
 *
 * Uso:
 *   import { createExternalEventAdapter } from './adapters/external-event-adapter.js';
 *   const ev = createExternalEventAdapter(
 *     { graphlet },
 *     { channelName: 'my-app-sync' }
 *   );
 *   // ... vida útil ...
 *   ev.destroy();
 */

// ============================================
// UTILIDADES PRIVADAS
// ============================================

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

function _isChannelLike(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.postMessage === 'function' &&
    typeof value.addEventListener === 'function' &&
    typeof value.removeEventListener === 'function' &&
    typeof value.close === 'function'
  );
}

function _isValidMutationEvent(payload) {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    payload.type === 'graphlet-mutation' &&
    typeof payload.origin === 'string' &&
    typeof payload.op === 'string' &&
    Array.isArray(payload.args)
  );
}

/**
 * Genera un UUID v4 usando crypto.randomUUID (Chrome 92+, Firefox 95+, Safari 15.4+).
 * El adapter requiere el soporte moderno; sin él, lanza en el constructor.
 */
function _generateOrigin() {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error(
      '[ExternalEventAdapter] crypto.randomUUID() no está disponible. ' +
      'Se requiere un navegador con soporte (Chrome 92+, Firefox 95+, Safari 15.4+).'
    );
  }
  return crypto.randomUUID();
}

// ============================================
// FACTORY
// ============================================

/**
 * Crea un External Event Adapter (BroadcastChannel-based).
 *
 * @param {Object} context
 * @param {GraphletInstance} context.graphlet - Graphlet a observar y actualizar.
 * @param {Object} options
 * @param {string} options.channelName - Nombre del BroadcastChannel. Requerido.
 * @param {BroadcastChannel} [options.channel] - Canal preexistente inyectable (útil en tests).
 * @param {(error: Error, event: object) => void} [options.onRemoteError] - Handler de errores remotos.
 * @returns {{origin: string, destroy: () => void}}
 */
export function createExternalEventAdapter(context, options = {}) {
  // ---------- Validación del context ----------
  if (!context || typeof context !== 'object') {
    throw new TypeError('[ExternalEventAdapter] context debe ser un objeto');
  }
  if (!_isGraphletInstance(context.graphlet)) {
    throw new TypeError(
      '[ExternalEventAdapter] context.graphlet debe ser una instancia de Graphlet'
    );
  }

  // ---------- Validación de opciones ----------
  if (typeof options.channelName !== 'string' || options.channelName.trim() === '') {
    throw new TypeError(
      '[ExternalEventAdapter] options.channelName es requerido y debe ser un string no vacío'
    );
  }

  // Canal: usar el inyectado o crear uno.
  let channel;
  let _ownsChannel;
  if (options.channel !== undefined) {
    if (!_isChannelLike(options.channel)) {
      throw new TypeError(
        '[ExternalEventAdapter] options.channel debe exponer postMessage/addEventListener/removeEventListener/close'
      );
    }
    channel = options.channel;
    _ownsChannel = false;
  } else {
    if (typeof BroadcastChannel === 'undefined') {
      throw new Error(
        '[ExternalEventAdapter] BroadcastChannel no está disponible en este entorno. ' +
        'Inyecta un canal compatible via options.channel o corre en un navegador moderno.'
      );
    }
    channel = new BroadcastChannel(options.channelName);
    _ownsChannel = true;
  }

  const onRemoteError = typeof options.onRemoteError === 'function'
    ? options.onRemoteError
    : (error, event) => {
        console.warn(
          `[ExternalEventAdapter] fallo al aplicar evento remoto (op=${event.op}):`,
          error
        );
      };

  const { graphlet } = context;
  const origin = _generateOrigin();

  // ---------- Estado interno ----------
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
  // OUTBOUND: broadcast tras mutación local
  // ============================================

  function _broadcast(op, args) {
    if (_destroyed) return;
    const event = {
      type: 'graphlet-mutation',
      origin: origin,
      op: op,
      args: args,
    };
    try {
      channel.postMessage(event);
    } catch (error) {
      // structured clone puede fallar si args contiene algo no-serializable.
      // No propagamos (rompería la mutación local, que ya ocurrió con éxito).
      console.warn(
        `[ExternalEventAdapter] fallo al broadcast (op=${op}):`,
        error
      );
    }
  }

  // ============================================
  // HELPERS PARA SET SEMANTICS DETECTION
  // ============================================
  // Reutiliza el patrón de Bridge y Persistence.

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
  // WRAPPERS DE MUTACIÓN (outbound)
  // ============================================

  graphlet.put = function(id, properties) {
    if (_destroyed) return _originals.put.call(graphlet, id, properties);
    const result = _originals.put.call(graphlet, id, properties);
    _broadcast('put', [id, properties]);
    return result;
  };

  graphlet.upsert = function(id, properties) {
    if (_destroyed) return _originals.upsert.call(graphlet, id, properties);
    const result = _originals.upsert.call(graphlet, id, properties);
    _broadcast('upsert', [id, properties]);
    return result;
  };

  graphlet.update = function(id, patch) {
    if (_destroyed) return _originals.update.call(graphlet, id, patch);
    const result = _originals.update.call(graphlet, id, patch);
    _broadcast('update', [id, patch]);
    return result;
  };

  graphlet.delete = function(id) {
    if (_destroyed) return _originals.delete.call(graphlet, id);
    const result = _originals.delete.call(graphlet, id);
    _broadcast('delete', [id]);
    return result;
  };

  graphlet.link = function(sourceId, relation, targetId) {
    if (_destroyed) return _originals.link.call(graphlet, sourceId, relation, targetId);

    const before = _snapshotLinksOf(sourceId);
    const result = _originals.link.call(graphlet, sourceId, relation, targetId);
    const after = _snapshotLinksOf(sourceId);

    if (!_sameShallowLinks(before, after)) {
      _broadcast('link', [sourceId, relation, targetId]);
    }
    return result;
  };

  graphlet.unlink = function(sourceId, relation, targetId) {
    if (_destroyed) return _originals.unlink.call(graphlet, sourceId, relation, targetId);

    const before = _snapshotLinksOf(sourceId);
    const result = _originals.unlink.call(graphlet, sourceId, relation, targetId);
    const after = _snapshotLinksOf(sourceId);

    if (!_sameShallowLinks(before, after)) {
      _broadcast('unlink', [sourceId, relation, targetId]);
    }
    return result;
  };

  graphlet.unlinkAll = function(sourceId, relation) {
    if (_destroyed) return _originals.unlinkAll.call(graphlet, sourceId, relation);

    const before = _snapshotLinksOf(sourceId);
    const result = _originals.unlinkAll.call(graphlet, sourceId, relation);
    const after = _snapshotLinksOf(sourceId);

    if (!_sameShallowLinks(before, after)) {
      _broadcast('unlinkAll', [sourceId, relation]);
    }
    return result;
  };

  // ============================================
  // INBOUND: aplicar mutaciones remotas
  // ============================================

  function _handleMessage(messageEvent) {
    if (_destroyed) return;

    const payload = messageEvent.data;

    // Validación de forma: mensajes que no son nuestros se ignoran silenciosamente.
    if (!_isValidMutationEvent(payload)) return;

    // Anti-eco por origin: descartar si el evento es propio.
    if (payload.origin === origin) return;

    // Verificar que op es un método conocido antes de intentar aplicar.
    if (!(payload.op in _originals)) {
      // Op desconocido: no lanzamos, no aplicamos. Podría ser una versión
      // futura del adapter emitiendo ops adicionales. Registramos en la
      // vía de errores para diagnóstico.
      onRemoteError(
        new Error(`op '${payload.op}' no reconocida`),
        payload
      );
      return;
    }

    // Aplicar vía el ORIGINAL — bypassa nuestro wrapper. Este es el
    // mecanismo primario de anti-eco: si aplicáramos vía el wrapped,
    // re-broadcastearíamos y crearíamos un loop.
    try {
      _originals[payload.op].apply(graphlet, payload.args);
    } catch (error) {
      onRemoteError(error, payload);
    }
  }

  channel.addEventListener('message', _handleMessage);

  // ============================================
  // API PÚBLICA
  // ============================================

  function destroy() {
    if (_destroyed) return;
    _destroyed = true;

    // Restaurar métodos originales
    graphlet.put = _originals.put;
    graphlet.upsert = _originals.upsert;
    graphlet.update = _originals.update;
    graphlet.delete = _originals.delete;
    graphlet.link = _originals.link;
    graphlet.unlink = _originals.unlink;
    graphlet.unlinkAll = _originals.unlinkAll;

    // Desconectar listener
    channel.removeEventListener('message', _handleMessage);

    // Cerrar canal solo si es nuestro
    if (_ownsChannel) {
      try {
        channel.close();
      } catch (error) {
        // Best-effort; no propagar en destroy.
        console.warn('[ExternalEventAdapter] fallo al cerrar canal:', error);
      }
    }
  }

  return {
    origin,
    destroy,
  };
}

export default createExternalEventAdapter;
