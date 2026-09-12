/**
 * Logging / Observability Adapter (initial implementation)
 *
 * Contrato: adapters/logging-adapter.spec.md v0.1.0
 * Implementation version: 0.1.0
 *
 * Observa mutaciones en nebula y/o transiciones en Pulsar,
 * emitiendo eventos estructurados a un sink pluggable. Estrictamente
 * read-only: no modifica el comportamiento de las primitivas observadas.
 *
 * Uso:
 *   import { createLoggingAdapter } from './adapters/logging-adapter.js';
 *
 *   // Observar ambas primitivas con sink default (console)
 *   const log = createLoggingAdapter({ nebula, pulsar });
 *
 *   // Sink custom, con filtro
 *   const log = createLoggingAdapter(
 *     { nebula },
 *     {
 *       sink: (event) => myBuffer.push(event),
 *       filter: (event) => event.op !== 'link',
 *     }
 *   );
 *
 *   // ... vida útil ...
 *   log.destroy();
 */

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

function _isPulsarInstance(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.getState === 'function' &&
    typeof value.setState === 'function'
  );
}

// ============================================
// FORMATTER DEFAULT (para el sink console)
// ============================================

function _formatTimestamp() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function _summarizeArg(arg, maxLen = 80) {
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
  try {
    const s = JSON.stringify(arg);
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen - 3) + '...';
  } catch {
    return String(arg);
  }
}

function _formatEvent(event) {
  const argsPart = event.args.map(a => _summarizeArg(a)).join(', ');
  // Padding fijo para 'source' de modo que las líneas se alineen visualmente
  // en el console. 'nebula' es 8 chars, 'pulsar' es 6.
  const sourcePadded = event.source.padEnd(8);
  return `[${_formatTimestamp()}] [${sourcePadded}] ${event.op}(${argsPart})`;
}

function _defaultSink(event) {
  console.log(_formatEvent(event));
}

// ============================================
// FACTORY
// ============================================

/**
 * Crea un Logging Adapter.
 *
 * @param {Object} context
 * @param {nebulaInstance} [context.nebula] - nebula a observar (opcional).
 * @param {PulsarInstance} [context.pulsar] - Pulsar a observar (opcional).
 *   Al menos uno debe estar presente.
 * @param {Object} [options]
 * @param {(event: object) => void} [options.sink] - Función que recibe cada evento.
 *   Default: formatter interno que loguea a console.
 * @param {(event: object) => boolean} [options.filter] - Predicado para descartar eventos.
 *   Default: pasa todo.
 * @returns {{destroy: () => void}}
 */
export function createLoggingAdapter(context, options = {}) {
  // ---------- Validación del context ----------
  if (!context || typeof context !== 'object') {
    throw new TypeError('[LoggingAdapter] context debe ser un objeto');
  }

  const hasnebula = context.nebula !== undefined;
  const hasPulsar = context.pulsar !== undefined;

  if (!hasnebula && !hasPulsar) {
    throw new TypeError(
      '[LoggingAdapter] al menos context.nebula o context.pulsar debe estar presente'
    );
  }

  if (hasnebula && !_isnebulaInstance(context.nebula)) {
    throw new TypeError(
      '[LoggingAdapter] context.nebula debe ser una instancia de nebula'
    );
  }

  if (hasPulsar && !_isPulsarInstance(context.pulsar)) {
    throw new TypeError(
      '[LoggingAdapter] context.pulsar debe ser una instancia de Pulsar'
    );
  }

  // ---------- Validación de opciones ----------
  const sink = options.sink !== undefined ? options.sink : _defaultSink;
  if (typeof sink !== 'function') {
    throw new TypeError('[LoggingAdapter] options.sink debe ser una función');
  }

  const filter = options.filter !== undefined ? options.filter : null;
  if (filter !== null && typeof filter !== 'function') {
    throw new TypeError('[LoggingAdapter] options.filter debe ser una función');
  }

  const { nebula, pulsar } = context;

  // ---------- Estado interno ----------
  let _destroyed = false;
  const _nebulaOriginals = hasnebula ? {
    put: nebula.put,
    upsert: nebula.upsert,
    update: nebula.update,
    delete: nebula.delete,
    link: nebula.link,
    unlink: nebula.unlink,
    unlinkAll: nebula.unlinkAll,
  } : null;

  const _pulsarOriginals = hasPulsar ? {
    setState: pulsar.setState,
  } : null;

  // ============================================
  // EMISIÓN
  // ============================================

  /**
   * Construye el evento y lo pasa por filter (si hay) y sink. Los errores
   * de filter o sink se capturan silenciosamente vía console.warn — no
   * pueden propagar porque romperían la mutación observada.
   */
  function _emit(source, op, args) {
    if (_destroyed) return;

    const event = {
      ts: performance.now(),
      source,
      op,
      args,
    };

    // Filter: si lanza, tratamos como rechazo (defensivo) y logueamos.
    if (filter !== null) {
      let pass;
      try {
        pass = filter(event);
      } catch (error) {
        console.warn('[LoggingAdapter] filter lanzó, tratando como rechazo:', error);
        return;
      }
      if (!pass) return;
    }

    // Sink: si lanza, capturamos y avisamos; no propagamos.
    try {
      sink(event);
    } catch (error) {
      console.warn('[LoggingAdapter] sink lanzó:', error);
    }
  }

  // ============================================
  // HELPERS PARA SET SEMANTICS DETECTION (nebula)
  // ============================================

  function _snapshotLinksOf(id) {
    if (!hasnebula) return null;
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
  // WRAPPERS DE nebula
  // ============================================

  if (hasnebula) {
    nebula.put = function(id, properties) {
      const result = _nebulaOriginals.put.call(nebula, id, properties);
      _emit('nebula', 'put', [id, properties]);
      return result;
    };

    nebula.upsert = function(id, properties) {
      const result = _nebulaOriginals.upsert.call(nebula, id, properties);
      _emit('nebula', 'upsert', [id, properties]);
      return result;
    };

    nebula.update = function(id, patch) {
      const result = _nebulaOriginals.update.call(nebula, id, patch);
      _emit('nebula', 'update', [id, patch]);
      return result;
    };

    nebula.delete = function(id) {
      const result = _nebulaOriginals.delete.call(nebula, id);
      _emit('nebula', 'delete', [id]);
      return result;
    };

    nebula.link = function(sourceId, relation, targetId) {
      const before = _snapshotLinksOf(sourceId);
      const result = _nebulaOriginals.link.call(nebula, sourceId, relation, targetId);
      const after = _snapshotLinksOf(sourceId);

      // Set semantics: no emitir si fue no-op de nebula
      if (!_sameShallowLinks(before, after)) {
        _emit('nebula', 'link', [sourceId, relation, targetId]);
      }
      return result;
    };

    nebula.unlink = function(sourceId, relation, targetId) {
      const before = _snapshotLinksOf(sourceId);
      const result = _nebulaOriginals.unlink.call(nebula, sourceId, relation, targetId);
      const after = _snapshotLinksOf(sourceId);

      if (!_sameShallowLinks(before, after)) {
        _emit('nebula', 'unlink', [sourceId, relation, targetId]);
      }
      return result;
    };

    nebula.unlinkAll = function(sourceId, relation) {
      const before = _snapshotLinksOf(sourceId);
      const result = _nebulaOriginals.unlinkAll.call(nebula, sourceId, relation);
      const after = _snapshotLinksOf(sourceId);

      if (!_sameShallowLinks(before, after)) {
        _emit('nebula', 'unlinkAll', [sourceId, relation]);
      }
      return result;
    };
  }

  // ============================================
  // WRAPPERS DE PULSAR
  // ============================================

  if (hasPulsar) {
    pulsar.setState = function(partial) {
      const result = _pulsarOriginals.setState.call(pulsar, partial);
      _emit('pulsar', 'setState', [partial]);
      return result;
    };
  }

  // ============================================
  // API PÚBLICA
  // ============================================

  function destroy() {
    if (_destroyed) return;
    _destroyed = true;

    if (hasnebula && _nebulaOriginals) {
      nebula.put = _nebulaOriginals.put;
      nebula.upsert = _nebulaOriginals.upsert;
      nebula.update = _nebulaOriginals.update;
      nebula.delete = _nebulaOriginals.delete;
      nebula.link = _nebulaOriginals.link;
      nebula.unlink = _nebulaOriginals.unlink;
      nebula.unlinkAll = _nebulaOriginals.unlinkAll;
    }

    if (hasPulsar && _pulsarOriginals) {
      pulsar.setState = _pulsarOriginals.setState;
    }
  }

  return {
    destroy,
  };
}

export default createLoggingAdapter;
