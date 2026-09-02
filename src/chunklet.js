/**
 * ChunkletJS - Orquestador de comportamientos sobre el stack Nexus
 * Versión objetivo: 0.3.0 (contrato)
 *
 * Dependencias explícitas:
 *   - PulsarJS   → estado reactivo
 *   - GraphletJS → modelo semántico (entidades, relaciones)
 *   - VoyajerJS  → sincronización de URL (opcional)
 *
 * Decisiones de diseño:
 *   - Singleton implícito: un solo stack Nexus por módulo cargado.
 *   - Auto-create con override: setup crea instancias si no se le pasan.
 *   - Voyajer opcional: ctx.voyajer === undefined si no se configura.
 *   - Enable/disable keyed por data-entity del DOM, nunca por IDs generados.
 *   - Chunklet declara explícitamente su dependencia de Pulsar y Graphlet.
 *
 * Estado de implementación:
 *   - Fase 0: preparación, imports, estado interno y utilidades privadas.
 *   - Fase 1: setup(options) completo.
 *   - Fases 2-8: pendientes (define, ctx, mount, unmount, observe, enable, disable).
 */

import { createStatePulsar } from './pulsar.js';
import { createGraphlet } from './graphlet.js';
import { createVoyajer } from './voyajer.js';

// ============================================
// ESTADO INTERNO DEL MÓDULO (SINGLETON)
// ============================================

/**
 * Stack Nexus resuelto por setup().
 * Forma: { pulsar: Object, graphlet: Object, voyajer: Object | undefined }
 * Inicialmente null → indica que setup() aún no ha sido llamado.
 */
let _stack = null;

/**
 * Configuración global de Chunklet.
 * Forma: { entityAttr: string, enabledPath: string | undefined }
 */
let _config = null;

/**
 * Registro de comportamientos definidos con Chunklet.define().
 * Map<string, Function>  (name → factory)
 */
const _behaviors = new Map();

/**
 * Registro de comportamientos montados por elemento.
 * Map<Element, Map<string, { ctx, destroy }>>
 *   element → (nombre de comportamiento → entries con contexto y destroy)
 */
const _mounts = new Map();

/**
 * Observadores activos creados con Chunklet.observe().
 * Set<MutationObserver>
 */
const _observers = new Set();

/**
 * Función para cancelar la suscripción al enabledPath.
 */
let _enabledUnsubscribe = null;

// ============================================
// UTILIDADES PRIVADAS
// ============================================

/**
 * Verifica que setup() ya fue llamado.
 * Lanza un error descriptivo si no.
 */
function _assertSetupCalled() {
  if (_stack === null || _config === null) {
    throw new Error('[Chunklet] setup() debe llamarse antes de usar esta API.');
  }
}

/**
 * Duck typing para detectar una instancia de Pulsar.
 */
function _isPulsarInstance(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.getState === 'function' &&
    typeof value.setState === 'function' &&
    typeof value.subscribe === 'function' &&
    typeof value.subscribeSelector === 'function'
  );
}

/**
 * Duck typing para detectar una instancia de Graphlet.
 */
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
    typeof value.query === 'function'
  );
}

/**
 * Duck typing para detectar una instancia de Voyajer.
 */
function _isVoyajerInstance(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.push === 'function' &&
    typeof value.replace === 'function' &&
    typeof value.getCurrent === 'function' &&
    typeof value.destroy === 'function'
  );
}

/**
 * Verifica que un valor es un objeto plano.
 */
function _isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Calcula la profundidad de un elemento en el DOM.
 * Útil para desmontar hijos antes que padres (Fase 5).
 */
function _getDepth(element) {
  let depth = 0;
  let current = element;
  while (current.parentNode) {
    depth++;
    current = current.parentNode;
  }
  return depth;
}

// ============================================
// RESOLUCIÓN DE DEPENDENCIAS (auto-create / override)
// ============================================

/**
 * Resuelve la instancia de Pulsar a partir de las opciones de setup.
 * - undefined → auto-crea con estado inicial vacío.
 * - instancia → la usa directamente.
 * - objeto plano { initialState, options } → crea una nueva instancia.
 */
function _resolvePulsarOption(pulsarOption) {
  if (pulsarOption === undefined) {
    return createStatePulsar({});
  }

  if (_isPulsarInstance(pulsarOption)) {
    return pulsarOption;
  }

  if (_isPlainObject(pulsarOption)) {
    const { initialState = {}, options = {} } = pulsarOption;
    return createStatePulsar(initialState, options);
  }

  throw new TypeError(
    '[Chunklet] setup: pulsar debe ser una instancia de Pulsar, ' +
    'un objeto { initialState, options }, o undefined.'
  );
}

/**
 * Resuelve la instancia de Graphlet a partir de las opciones de setup.
 * - undefined → auto-crea Graphlet vacío.
 * - instancia → la usa directamente.
 */
function _resolveGraphletOption(graphletOption) {
  if (graphletOption === undefined) {
    return createGraphlet();
  }

  if (_isGraphletInstance(graphletOption)) {
    return graphletOption;
  }

  throw new TypeError(
    '[Chunklet] setup: graphlet debe ser una instancia de Graphlet o undefined.'
  );
}

/**
 * Resuelve la instancia de Voyajer a partir de las opciones de setup.
 * - undefined → no crea Voyajer.
 * - instancia → la usa directamente.
 * - objeto plano de opciones → crea Voyajer con la instancia de Pulsar resuelta.
 */
function _resolveVoyajerOption(voyajerOption, pulsarInstance) {
  if (voyajerOption === undefined) {
    return undefined;
  }

  if (_isVoyajerInstance(voyajerOption)) {
    return voyajerOption;
  }

  if (_isPlainObject(voyajerOption)) {
    return createVoyajer(pulsarInstance, voyajerOption);
  }

  throw new TypeError(
    '[Chunklet] setup: voyajer debe ser una instancia de Voyajer, ' +
    'un objeto de opciones, o undefined.'
  );
}

// ============================================
// MECANISMO ENABLE/DISABLE
// ============================================

/**
 * Handler invocado cuando cambia el valor en `enabledPath`.
 * La reconciliación real se implementará en fases posteriores (Fase 5).
 */
function _handleEnabledStateChange(enabledMap) {
  if (_mounts.size === 0) return;

  if (enabledMap !== undefined && !_isPlainObject(enabledMap)) {
    console.warn(
      '[Chunklet] El valor en enabledPath debe ser un objeto plano. ' +
      'Se ignoran los cambios.'
    );
    return;
  }

  // TODO(Fase 5): iterar _mounts y aplicar la nueva máscara de comportamientos.
}

// ============================================
// API PÚBLICA: setup
// ============================================

/**
 * Inicializa el stack Nexus del módulo.
 * Solo puede llamarse una vez por carga del módulo.
 *
 * @param {Object} options
 * @param {Pulsar|{initialState, options}|undefined} [options.pulsar]
 * @param {Graphlet|undefined} [options.graphlet]
 * @param {Voyajer|{...voyajerOptions}|undefined} [options.voyajer]
 * @param {string} [options.entityAttr='data-entity']
 * @param {string} [options.enabledPath]
 * @returns {{ pulsar: Object, graphlet: Object, voyajer: Object|undefined }}
 *
 * @throws {Error} Si setup ya fue llamado.
 * @throws {TypeError} Si options no es objeto o alguna primitiva es inválida.
 */
export function setup(options = {}) {
  // 1. Protección del singleton
  if (_stack !== null || _config !== null) {
    throw new Error(
      '[Chunklet] setup() ya fue llamado. Solo se permite una inicialización por módulo.'
    );
  }

  // 2. Validación global de opciones
  if (!_isPlainObject(options)) {
    throw new TypeError('[Chunklet] setup: options debe ser un objeto plano.');
  }

  // 3. Extraer y validar configuración
  const {
    pulsar: pulsarOption,
    graphlet: graphletOption,
    voyajer: voyajerOption,
    entityAttr = 'data-entity',
    enabledPath,
  } = options;

  if (typeof entityAttr !== 'string' || entityAttr.trim() === '') {
    throw new TypeError('[Chunklet] setup: entityAttr debe ser un string no vacío.');
  }

  if (
    enabledPath !== undefined &&
    (typeof enabledPath !== 'string' || enabledPath.trim() === '')
  ) {
    throw new TypeError(
      '[Chunklet] setup: enabledPath debe ser un string no vacío si se proporciona.'
    );
  }

  // 4. Resolver instancias con auto-create / override
  const pulsarInstance = _resolvePulsarOption(pulsarOption);
  const graphletInstance = _resolveGraphletOption(graphletOption);
  const voyajerInstance = _resolveVoyajerOption(voyajerOption, pulsarInstance);

  // 5. Guardar el stack resuelto
  _stack = {
    pulsar: pulsarInstance,
    graphlet: graphletInstance,
    voyajer: voyajerInstance,
  };

  // 6. Guardar configuración
  _config = {
    entityAttr,
    enabledPath: enabledPath || undefined,
  };

  // 7. Suscripción al mecanismo enable/disable (si aplica)
  if (_config.enabledPath) {
    _enabledUnsubscribe = pulsarInstance.subscribeSelector(
      _config.enabledPath,
      _handleEnabledStateChange
    );
  }

  // 8. Retornar el stack para que la aplicación conserve referencias
  return {
    pulsar: pulsarInstance,
    graphlet: graphletInstance,
    voyajer: voyajerInstance,
  };
}

// ============================================
// API PÚBLICA: define
// ============================================

/**
 * Registra una nueva fábrica de comportamiento Chunklet.
 *
 * @param {string} name   Identificador único del comportamiento (sin espacios).
 *                        Se referencia en el atributo `data-chunk`.
 * @param {Function} factory
 *        Recibe `(element, ctx)` y opcionalmente devuelve `{ destroy }`.
 *
 * @throws {Error}      Si setup() no ha sido llamado todavía.
 * @throws {TypeError}  Si name no es string no vacío.
 * @throws {TypeError}  Si name contiene espacios en blanco.
 * @throws {TypeError}  Si factory no es una función.
 */
export function define(name, factory) {
  // El contrato exige que setup se ejecute antes de define.
  _assertSetupCalled();

  // Validaciones de nombre
  if (typeof name !== 'string' || name.trim() === '') {
    throw new TypeError('[Chunklet] define: name debe ser un string no vacío');
  }
  if (/\s/.test(name)) {
    throw new TypeError('[Chunklet] define: name no puede contener espacios');
  }

  // Validación de factory
  if (typeof factory !== 'function') {
    throw new TypeError('[Chunklet] define: factory debe ser una función');
  }

  // Si ya existe un comportamiento con el mismo nombre, se sobreescribe.
  _behaviors.set(name, factory);
}

// ============================================
// CREACIÓN DE CONTEXTO (Fase 3)
// ============================================

/**
 * Crea un contexto de comportamiento para un elemento.
 * Cada comportamiento montado recibe su propio ctx independiente.
 *
 * @param {Element} element - Elemento DOM que aloja el comportamiento.
 * @returns {{ ctx: Object, destroy: Function }}
 */
function _createContext(element) {
  // El contexto requiere que setup haya inicializado el stack.
  if (_stack === null) {
    throw new Error('[Chunklet] _createContext: setup() debe llamarse antes de crear contextos.');
  }

  const resources = [];

  // Registra una función de limpieza. Se ejecutará en LIFO al destruir el contexto.
  function addResource(cleanupFn) {
    if (typeof cleanupFn === 'function') {
      resources.push(cleanupFn);
    }
  }

  // ============================================
  // CONTEXTO PÚBLICO (lo que recibe la factory)
  // ============================================
  const ctx = {
    // --- Stack accessors ---
    pulsar: _stack.pulsar,
    graphlet: _stack.graphlet,
    voyajer: _stack.voyajer, // puede ser undefined

    // --- Registro de recursos (auto-cleanup) ---

    listen(target, event, handler, options) {
      if (!target || typeof target.addEventListener !== 'function') {
        throw new TypeError('[Chunklet] ctx.listen: target debe ser un EventTarget');
      }
      target.addEventListener(event, handler, options);
      addResource(() => target.removeEventListener(event, handler, options));
    },

    subscribe(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('[Chunklet] ctx.subscribe: listener debe ser una función');
      }
      const unsubscribe = _stack.pulsar.subscribe(listener);
      addResource(unsubscribe);
    },

    subscribeSelector(selector, listener, options) {
      if (typeof listener !== 'function') {
        throw new TypeError('[Chunklet] ctx.subscribeSelector: listener debe ser una función');
      }
      const unsubscribe = _stack.pulsar.subscribeSelector(selector, listener, options);
      addResource(unsubscribe);
    },

    observe(target, callback, options) {
      if (!target || typeof target.nodeType !== 'number') {
        throw new TypeError('[Chunklet] ctx.observe: target debe ser un Node');
      }
      const obsOptions = options || { childList: true, subtree: true };
      const observer = new MutationObserver(callback);
      observer.observe(target, obsOptions);
      addResource(() => observer.disconnect());
    },

    timeout(handler, delay, ...args) {
      const id = setTimeout(handler, delay, ...args);
      addResource(() => clearTimeout(id));
    },

    interval(handler, interval, ...args) {
      const id = setInterval(handler, interval, ...args);
      addResource(() => clearInterval(id));
    },

    cleanup(fn) {
      if (typeof fn !== 'function') {
        throw new TypeError('[Chunklet] ctx.cleanup: fn debe ser una función');
      }
      addResource(fn);
    },

    // --- Shortcuts puros (no registran recursos) ---

    getState() {
      return _stack.pulsar.getState();
    },

    setState(partial) {
      return _stack.pulsar.setState(partial);
    },

    entity(id) {
      return _stack.graphlet.get(id);
    },

    upsertEntity(id, props) {
      return _stack.graphlet.upsert(id, props);
    },

    updateEntity(id, patch) {
      return _stack.graphlet.update(id, patch);
    },

    deleteEntity(id) {
      return _stack.graphlet.delete(id);
    },

    navigate(state) {
      if (!_stack.voyajer) {
        throw new Error('[Chunklet] Voyajer no configurado');
      }
      return _stack.voyajer.push(state);
    },

    replace(state) {
      if (!_stack.voyajer) {
        throw new Error('[Chunklet] Voyajer no configurado');
      }
      return _stack.voyajer.replace(state);
    },
  };

  // ============================================
  // DESTRUCCIÓN DEL CONTEXTO
  // ============================================
  function destroy() {
    // Recorre en LIFO: último recurso registrado se libera primero.
    for (let i = resources.length - 1; i >= 0; i--) {
      try {
        resources[i]();
      } catch (error) {
        console.error('[Chunklet] Error en cleanup de recurso:', error);
      }
    }
    resources.length = 0;
  }

  return { ctx, destroy };
}

// ============================================
// PRÓXIMAS FASES (a implementar)
// ============================================
// ✅ Fase 0: preparación, imports, estado interno y utilidades privadas.
// ✅ Fase 1: setup(options) completo.
// ✅ Fase 2: define(name, factory) completo.
// ✅ Fase 3: _createContext(element) completo.
// ⏳ Fase 4: mount(element) y lógica de montaje.
// ⏳ Fase 5: unmount(element) y reconciliación enable/disable
// ⏳ Fase 6: observe(root) y disconnect()
// ⏳ Fase 7: enable(entity, name) y disable(entity, name)
// ⏳ Fase 8: exportaciones finales y pruebas