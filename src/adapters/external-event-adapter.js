/**
 * External Event Adapter (initial implementation, BroadcastChannel-based)
 *
 * Contrato: adapters/external-event-adapter.spec.md v0.2.0
 * Implementation version: 0.2.0
 *
 * Sincronización bidireccional cross-tab de mutaciones de nebula vía
 * BroadcastChannel, con anti-eco explícito por origin+original.
 *
 * Cambios respecto a v0.1.0:
 * - Wrappers vía `adapter-chain.js`; las mutaciones remotas se aplican
 *   con `invokeSkipping`, que salta sólo la entrada de este adapter.
 * - Queda retirada la limitación "no re-proyecta ni persiste en el tab
 *   receptor": era un artefacto del orden de instanciación, no una
 *   propiedad del adapter. Con la cadena, una mutación remota atraviesa
 *   Bridge, Persistence y Logging con independencia del orden de montaje.
 *
 * Limitaciones vigentes (mini-spec §6):
 * - No ordena eventos entre tabs; no resuelve conflictos.
 * - Ambos tabs escriben la misma clave de storage al aplicar la misma
 *   mutación remota. El contenido converge, el trabajo se duplica.
 *
 * Uso:
 *   import { createExternalEventAdapter } from './adapters/external-event-adapter.js';
 *   const ev = createExternalEventAdapter(
 *     { nebula },
 *     { channelName: 'my-app-sync' }
 *   );
 *   // ... vida útil ...
 *   ev.destroy();
 */

import { wrap, unwrap, invokeSkipping } from './adapter-chain.js';

// ============================================
// UTILIDADES PRIVADAS
// ============================================

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
    payload.type === 'nebula-mutation' &&
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
 * @param {nebulaInstance} context.nebula - nebula a observar y actualizar.
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
  if (!_isnebulaInstance(context.nebula)) {
    throw new TypeError(
      '[ExternalEventAdapter] context.nebula debe ser una instancia de nebula'
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

  const { nebula } = context;
  const origin = _generateOrigin();

  // ---------- Estado interno ----------
  // op -> handle de la cadena (adapter-chain.js). Reemplaza al antiguo
  // `_originals`, cuya captura en el constructor hacía que la conducta
  // del adapter dependiera del orden de instanciación: ver el bloque
  // INBOUND para el detalle.
  const _handleByOp = new Map();

  let _destroyed = false;

  // ============================================
  // OUTBOUND: broadcast tras mutación local
  // ============================================

  function _broadcast(op, args) {
    if (_destroyed) return;
    const event = {
      type: 'nebula-mutation',
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
  // WRAPPERS DE MUTACIÓN (outbound)
  // ============================================

  function _wrapOp(op, fn) {
    _handleByOp.set(op, wrap(nebula, op, fn));
  }

  _wrapOp('put', function (next, id, properties) {
    const result = next(id, properties);
    _broadcast('put', [id, properties]);
    return result;
  });

  _wrapOp('upsert', function (next, id, properties) {
    const result = next(id, properties);
    _broadcast('upsert', [id, properties]);
    return result;
  });

  _wrapOp('update', function (next, id, patch) {
    const result = next(id, patch);
    _broadcast('update', [id, patch]);
    return result;
  });

  _wrapOp('delete', function (next, id) {
    const result = next(id);
    _broadcast('delete', [id]);
    return result;
  });

  _wrapOp('link', function (next, sourceId, relation, targetId) {
    const before = _snapshotLinksOf(sourceId);
    const result = next(sourceId, relation, targetId);
    const after = _snapshotLinksOf(sourceId);
    if (!_sameShallowLinks(before, after)) {
      _broadcast('link', [sourceId, relation, targetId]);
    }
    return result;
  });

  _wrapOp('unlink', function (next, sourceId, relation, targetId) {
    const before = _snapshotLinksOf(sourceId);
    const result = next(sourceId, relation, targetId);
    const after = _snapshotLinksOf(sourceId);
    if (!_sameShallowLinks(before, after)) {
      _broadcast('unlink', [sourceId, relation, targetId]);
    }
    return result;
  });

  _wrapOp('unlinkAll', function (next, sourceId, relation) {
    const before = _snapshotLinksOf(sourceId);
    const result = next(sourceId, relation);
    const after = _snapshotLinksOf(sourceId);
    if (!_sameShallowLinks(before, after)) {
      _broadcast('unlinkAll', [sourceId, relation]);
    }
    return result;
  });

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
    if (!_handleByOp.has(payload.op)) {
      // Op desconocido: no lanzamos, no aplicamos. Podría ser una versión
      // futura del adapter emitiendo ops adicionales. Registramos en la
      // vía de errores para diagnóstico.
      onRemoteError(
        new Error(`op '${payload.op}' no reconocida`),
        payload
      );
      return;
    }

    // Aplicar SALTÁNDOSE nuestra propia entrada de la cadena, pero
    // atravesando la de todos los demás adapters. Éste es el mecanismo
    // primario de anti-eco: aplicar vía el método envuelto por nosotros
    // re-broadcastearía y crearía un loop.
    //
    // La versión anterior llamaba a `_originals[op]`, capturado en el
    // constructor. Eso saltaba no sólo nuestro wrapper sino el de todo
    // adapter montado DESPUÉS de nosotros, de modo que si este adapter
    // se instanciaba antes que Bridge y Persistence, una mutación remota
    // entraba al grafo pero no se proyectaba a Pulsar ni se persistía —
    // y si se instanciaba después, sí. Medido en los dos órdenes: la
    // "limitación conocida" del tab receptor era en realidad un efecto
    // del orden de montaje. `invokeSkipping` la elimina: la mutación
    // remota alcanza siempre al resto de la cadena, se haya montado
    // antes o después.
    try {
      invokeSkipping(_handleByOp.get(payload.op), payload.args);
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

    // Retirar nuestras entradas de la cadena (en cualquier orden
    // respecto a los demás adapters).
    for (const handle of _handleByOp.values()) unwrap(handle);
    _handleByOp.clear();

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
