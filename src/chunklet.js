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
 *   - Fase 2: define(name, factory) completo.
 *   - Fase 3: _createContext(element) completo.
 *   - Fase 4: mount(element) y lógica de montaje.
 *   - Fase 5: unmount(element) y reconciliación enable/disable.
 *   - Fases 6-8: pendientes (observe, disconnect, enable, disable, exportaciones finales).
 */

import { createStatePulsar } from './pulsar.js';
import { createGraphlet } from './graphlet.js';
import { createVoyajer } from './voyajer.js';

// ============================================
// ESTADO INTERNO DEL MÓDULO (SINGLETON)
// ============================================

let _stack = null;

let _config = null;

const _behaviors = new Map();

const _mounts = new Map();

const _observers = new Set();

let _enabledUnsubscribe = null;

// ============================================
// UTILIDADES PRIVADAS
// ============================================

function _assertSetupCalled() {
  if (_stack === null || _config === null) {
    throw new Error('[Chunklet] setup() debe llamarse antes de usar esta API.');
  }
}

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

function _isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

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
// API PÚBLICA: setup
// ============================================

export function setup(options = {}) {
  if (_stack !== null || _config !== null) {
    throw new Error(
      '[Chunklet] setup() ya fue llamado. Solo se permite una inicialización por módulo.'
    );
  }

  if (!_isPlainObject(options)) {
    throw new TypeError('[Chunklet] setup: options debe ser un objeto plano.');
  }

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

  const pulsarInstance = _resolvePulsarOption(pulsarOption);
  const graphletInstance = _resolveGraphletOption(graphletOption);
  const voyajerInstance = _resolveVoyajerOption(voyajerOption, pulsarInstance);

  _stack = {
    pulsar: pulsarInstance,
    graphlet: graphletInstance,
    voyajer: voyajerInstance,
  };

  _config = {
    entityAttr,
    enabledPath: enabledPath || undefined,
  };

  if (_config.enabledPath) {
    _enabledUnsubscribe = pulsarInstance.subscribeSelector(
      _config.enabledPath,
      _handleEnabledStateChange
    );
  }

  return {
    pulsar: pulsarInstance,
    graphlet: graphletInstance,
    voyajer: voyajerInstance,
  };
}

// ============================================
// API PÚBLICA: define
// ============================================

export function define(name, factory) {
  _assertSetupCalled();

  if (typeof name !== 'string' || name.trim() === '') {
    throw new TypeError('[Chunklet] define: name debe ser un string no vacío');
  }
  if (/\s/.test(name)) {
    throw new TypeError('[Chunklet] define: name no puede contener espacios');
  }

  if (typeof factory !== 'function') {
    throw new TypeError('[Chunklet] define: factory debe ser una función');
  }

  _behaviors.set(name, factory);
}

// ============================================
// CREACIÓN DE CONTEXTO (Fase 3)
// ============================================

function _createContext(element) {
  if (_stack === null) {
    throw new Error('[Chunklet] _createContext: setup() debe llamarse antes de crear contextos.');
  }

  const resources = [];

  function addResource(cleanupFn) {
    if (typeof cleanupFn === 'function') {
      resources.push(cleanupFn);
    }
  }

  const ctx = {
    // --- Stack accessors ---
    pulsar: _stack.pulsar,
    graphlet: _stack.graphlet,
    voyajer: _stack.voyajer,

    // --- Registro de recursos ---
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

    // --- Shortcuts puros ---
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

  function destroy() {
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
// MONTAJE DE COMPORTAMIENTOS (Fase 4)
// ============================================

function _getEntityId(element) {
  if (!_config || !_config.entityAttr) return null;
  const id = element.getAttribute(_config.entityAttr);
  return id && id.trim() !== '' ? id.trim() : null;
}

function _getEnabledMap() {
  if (!_config || !_config.enabledPath) return null;
  const state = _stack.pulsar.getState();
  const value = state[_config.enabledPath];
  return value && typeof value === 'object' ? value : null;
}

function _computeBehaviorsToMount(element, enabledBehaviors) {
  const chunkAttr = element.getAttribute('data-chunk');
  if (!chunkAttr) return [];

  const allNames = chunkAttr.split(/\s+/).filter(Boolean);

  if (enabledBehaviors === null) {
    return allNames;
  }

  if (Array.isArray(enabledBehaviors)) {
    return allNames.filter(name => enabledBehaviors.includes(name));
  }

  return allNames;
}

function _instantiateBehavior(element, name) {
  const factory = _behaviors.get(name);
  if (!factory) {
    console.warn(`[Chunklet] Comportamiento "${name}" no registrado. Se omite.`);
    return null;
  }

  const { ctx, destroy: destroyContext } = _createContext(element);

  let factoryResult;
  try {
    factoryResult = factory(element, ctx);
  } catch (error) {
    console.error(`[Chunklet] Error al montar "${name}":`, error);
    destroyContext();
    return null;
  }

  let customDestroy = null;
  if (
    factoryResult &&
    typeof factoryResult === 'object' &&
    typeof factoryResult.destroy === 'function'
  ) {
    customDestroy = factoryResult.destroy;
  }

  const destroy = () => {
    if (customDestroy) {
      try {
        customDestroy();
      } catch (error) {
        console.error(`[Chunklet] Error en destroy personalizado de "${name}":`, error);
      }
    }
    destroyContext();
  };

  return { ctx, destroy };
}

function _mountElement(element, enabledBehaviors = null) {
  const namesToMount = _computeBehaviorsToMount(element, enabledBehaviors);

  // Si el elemento no está registrado, lo registramos aunque montemos 0.
  let elementMounts = _mounts.get(element);
  if (!elementMounts) {
    elementMounts = new Map();
    _mounts.set(element, elementMounts);
  }

  for (const name of namesToMount) {
    if (elementMounts.has(name)) continue;

    const entry = _instantiateBehavior(element, name);
    if (entry) {
      elementMounts.set(name, entry);
    }
  }

  // NO eliminar el elemento de _mounts aunque quede vacío.
  // Así el enable/disable posterior puede encontrarlo.
}

// ============================================
// API PÚBLICA: mount
// ============================================

export function mount(element) {
  if (_stack === null || _config === null) {
    throw new Error('[Chunklet] mount: setup() debe llamarse antes de montar.');
  }

  if (!element || element.nodeType !== 1) {
    throw new TypeError('[Chunklet] mount: element debe ser un Element DOM.');
  }

  const candidates = [];
  if (element.matches && element.matches('[data-chunk]')) {
    candidates.push(element);
  }
  if (element.querySelectorAll) {
    candidates.push(...element.querySelectorAll('[data-chunk]'));
  }

  if (candidates.length === 0) return;

  const enabledMap = _getEnabledMap();

  for (const el of candidates) {
    let enabledBehaviors = null;

    if (enabledMap) {
      const entityId = _getEntityId(el);
      if (entityId && Object.prototype.hasOwnProperty.call(enabledMap, entityId)) {
        enabledBehaviors = enabledMap[entityId];
        if (!Array.isArray(enabledBehaviors)) {
          enabledBehaviors = null;
        }
      }
    }

    _mountElement(el, enabledBehaviors);
  }
}

// ============================================
// DESMONTAJE DE COMPORTAMIENTOS (Fase 5)
// ============================================

function _unmountElement(element) {
  const elementMounts = _mounts.get(element);
  if (elementMounts) {
    const names = Array.from(elementMounts.keys()).reverse();
    for (const name of names) {
      const entry = elementMounts.get(name);
      if (!entry) continue;
      try {
        entry.destroy();
      } catch (error) {
        console.error(`[Chunklet] Error al destruir "${name}":`, error);
      }
      elementMounts.delete(name);
    }
  }
  // En unmount real, sí eliminamos el elemento del registro.
  _mounts.delete(element);
}

// ============================================
// API PÚBLICA: unmount
// ============================================

export function unmount(element) {
  if (_stack === null || _config === null) {
    throw new Error('[Chunklet] unmount: setup() debe llamarse antes de desmontar.');
  }

  if (!element || element.nodeType !== 1) {
    throw new TypeError('[Chunklet] unmount: element debe ser un Element DOM.');
  }

  const affected = [];
  for (const el of _mounts.keys()) {
    if (el === element || element.contains(el)) {
      affected.push(el);
    }
  }

  affected.sort((a, b) => _getDepth(b) - _getDepth(a));

  for (const el of affected) {
    _unmountElement(el);
  }
}

// ============================================
// RECONCILIACIÓN ENABLE/DISABLE (Fase 5)
// ============================================

function _sameBehaviorSet(a, b) {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((name, i) => name === sortedB[i]);
}

function _computeDesiredBehaviors(element, restriction) {
  const chunkAttr = element.getAttribute('data-chunk');
  if (!chunkAttr) return [];
  const allNames = chunkAttr.split(/\s+/).filter(Boolean);

  if (restriction === null) return allNames;
  if (Array.isArray(restriction)) {
    return allNames.filter(name => restriction.includes(name));
  }
  return allNames;
}

function _destroyExistingBehaviors(element, elementMounts) {
  const names = Array.from(elementMounts.keys()).reverse();
  for (const name of names) {
    const entry = elementMounts.get(name);
    if (!entry) continue;
    try {
      entry.destroy();
    } catch (error) {
      console.error(`[Chunklet] Error al destruir "${name}":`, error);
    }
    elementMounts.delete(name);
  }
}

function _setElementBehaviors(element, namesToMount) {
  let elementMounts = _mounts.get(element);
  if (!elementMounts) {
    elementMounts = new Map();
    _mounts.set(element, elementMounts);
  }

  // Destruir todos los comportamientos actuales
  _destroyExistingBehaviors(element, elementMounts);

  // Montar los deseados
  for (const name of namesToMount) {
    const entry = _instantiateBehavior(element, name);
    if (entry) {
      elementMounts.set(name, entry);
    }
  }

  // Conservar el elemento en _mounts aunque quede vacío
}

function _handleEnabledStateChange(enabledMap) {
  if (_mounts.size === 0) return;

  if (enabledMap !== undefined && !_isPlainObject(enabledMap)) {
    console.warn(
      '[Chunklet] El valor en enabledPath debe ser un objeto plano. ' +
      'Se ignoran los cambios.'
    );
    return;
  }

  const effectiveMap = enabledMap && _isPlainObject(enabledMap) ? enabledMap : null;

  const mountedElements = Array.from(_mounts.keys());

  for (const element of mountedElements) {
    const entityId = _getEntityId(element);
    if (!entityId) continue;

    let restriction = null;
    if (effectiveMap && Object.prototype.hasOwnProperty.call(effectiveMap, entityId)) {
      const value = effectiveMap[entityId];
      restriction = Array.isArray(value) ? value : null;
    }

    const elementMounts = _mounts.get(element);
    const currentNames = elementMounts ? Array.from(elementMounts.keys()) : [];
    const desiredNames = _computeDesiredBehaviors(element, restriction);

    if (!_sameBehaviorSet(currentNames, desiredNames)) {
      // Reemplazar comportamientos sin eliminar el elemento del registro.
      _setElementBehaviors(element, desiredNames);
    }
  }
}

// ============================================
// OBSERVADOR DE MUTACIONES (Fase 6)
// ============================================

/**
 * Observa dinámicamente el DOM: cuando se añaden nodos con `data-chunk`,
 * los monta automáticamente; cuando se eliminan, los desmonta.
 *
 * @param {Node} root - Nodo raíz a observar (childList + subtree).
 * @returns {Function} Función para desconectar SOLO este observador.
 * @throws {Error} Si setup() no ha sido llamado.
 * @throws {TypeError} Si root no es un Node.
 */
export function observe(root) {
  // Exigir setup previo
  if (_stack === null || _config === null) {
    throw new Error('[Chunklet] observe: setup() debe llamarse antes de observar.');
  }
  if (!root || typeof root.nodeType !== 'number') {
    throw new TypeError('[Chunklet] observe: root debe ser un Node.');
  }

  const observer = new MutationObserver((mutations) => {
    // 1. Procesar primero REMOCIONES (para que un "mover" no desmonte al final)
    for (const mutation of mutations) {
      for (const node of mutation.removedNodes) {
        if (node.nodeType === 1) { // Element
          try {
            unmount(node);
          } catch (error) {
            console.error('[Chunklet] observe: error en unmount de nodo removido', node, error);
          }
        }
      }
    }

    // 2. Procesar ADICIONES después
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) { // Element
          try {
            mount(node);
          } catch (error) {
            console.error('[Chunklet] observe: error en mount de nodo agregado', node, error);
          }
        }
      }
    }
  });

  observer.observe(root, { childList: true, subtree: true });
  _observers.add(observer);

  // Devolver desconectador específico
  return () => {
    observer.disconnect();
    _observers.delete(observer);
  };
}

/**
 * Desconecta TODOS los observadores activos.
 * No desmonta los comportamientos ya montados.
 */
export function disconnect() {
  for (const observer of _observers) {
    observer.disconnect();
  }
  _observers.clear();
}


// ============================================
// PRÓXIMAS FASES (a implementar)
// ============================================
// ✅ Fase 0: preparación, imports, estado interno y utilidades privadas.
// ✅ Fase 1: setup(options) completo.
// ✅ Fase 2: define(name, factory) completo.
// ✅ Fase 3: _createContext(element) completo.
// ✅ Fase 4: mount(element) y lógica de montaje.
// ✅ Fase 5: unmount(element) y reconciliación enable/disable.
// ✅ Fase 6: observe(root) y disconnect().
// ⏳ Fase 7: enable(entity, name) y disable(entity, name)
// ⏳ Fase 8: exportaciones finales y pruebas