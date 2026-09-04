/**
 * ChunkletJS - Orquestador de comportamientos sobre el stack Nexus
 * Versión: 0.4.0 (implementación del contrato v0.4.0)
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
 *   - Configuración diferida: `configure()` permite añadir Voyajer después del setup.
 *   - Los ctx acceden al stack mediante getters, por lo que una configuración
 *     posterior afecta también a comportamientos ya montados.
 *
 * Cambios respecto a v0.3.0 (breaking):
 *   - C-2: `enable` y `disable` son ahora simétricos. Ambas operaciones
 *     producen una entrada explícita en el mapa de habilitación cuando no
 *     existía una previa (consultando el DOM para conocer los behaviors
 *     declarados). El comportamiento anterior "enable sin entrada = no-op
 *     silencioso" queda reemplazado. Ver ChunkletJS_Contract_Specification
 *     §7.3.
 *   - C-1: Unificación de `_getEnabledMap` y `_getEnabledState` en un solo
 *     helper `_readEnabledMap` con criterio único (`_isPlainObject`).
 *   - `disable` sobre una entidad sin elementos con esa data-entity en el
 *     DOM ahora también crea una entrada explícita (vacía o con la lista
 *     residual), completando la simetría con `enable`. Antes salía temprano
 *     si `_getDeclaredBehaviorsForEntity` retornaba vacío, generando una
 *     inconsistencia con el nuevo modelo simétrico.
 */

import { createStatePulsar } from './pulsar.js';
import { createGraphlet } from './graphlet.js';
import { createVoyajer } from './voyajer.js';

// ============================================
// ESTADO INTERNO DEL MÓDULO (SINGLETON)
// ============================================

let _stack = null;               // { pulsar, graphlet, voyajer }
let _config = null;              // { entityAttr, enabledPath }

const _behaviors = new Map();    // name -> factory
const _mounts = new Map();       // element -> Map<name, { ctx, destroy }>
const _observers = new Set();    // MutationObserver activos
let _enabledUnsubscribe = null;  // unsubscribe de enabledPath

// ============================================
// UTILIDADES PRIVADAS
// ============================================

function _assertSetupCalled() {
  if (_stack === null || _config === null) {
    throw new Error('[Chunklet] setup() debe llamarse antes de usar esta API.');
  }
}

function _assertConfigured() {
  if (_stack === null) {
    throw new Error('[Chunklet] configure(): primero debe llamarse a setup().');
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

// Acceso a rutas punteadas en el estado de Pulsar
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

// ============================================
// RESOLUCIÓN DE DEPENDENCIAS
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
    throw new Error('[Chunklet] setup() ya fue llamado. Solo se permite una inicialización por módulo.');
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
  if (enabledPath !== undefined && (typeof enabledPath !== 'string' || enabledPath.trim() === '')) {
    throw new TypeError('[Chunklet] setup: enabledPath debe ser un string no vacío si se proporciona.');
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
// API PÚBLICA: configure
// ============================================

export function configure(options = {}) {
  _assertConfigured();
  if (!_isPlainObject(options)) {
    throw new TypeError('[Chunklet] configure: options debe ser un objeto plano.');
  }

  // Solo se permiten cambios en graphlet y voyajer; pulsar se mantiene fijo.
  if (options.graphlet !== undefined) {
    const resolvedGraphlet = _resolveGraphletOption(options.graphlet);
    _stack.graphlet = resolvedGraphlet;
  }

  if (options.voyajer !== undefined) {
    if (_stack.voyajer && typeof _stack.voyajer.destroy === 'function') {
      _stack.voyajer.destroy();
    }
    const resolvedVoyajer = _resolveVoyajerOption(options.voyajer, _stack.pulsar);
    _stack.voyajer = resolvedVoyajer;
  }

  return {
    pulsar: _stack.pulsar,
    graphlet: _stack.graphlet,
    voyajer: _stack.voyajer,
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
// CREACIÓN DE CONTEXTO
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
    // Getters para que una configuración posterior sea visible
    get pulsar() { return _stack ? _stack.pulsar : undefined; },
    get graphlet() { return _stack ? _stack.graphlet : undefined; },
    get voyajer() { return _stack ? _stack.voyajer : undefined; },

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
// MONTAJE DE COMPORTAMIENTOS
// ============================================

function _getEntityId(element) {
  if (!_config || !_config.entityAttr) return null;
  const id = element.getAttribute(_config.entityAttr);
  return id && id.trim() !== '' ? id.trim() : null;
}

/**
 * Refactor C-1: helper unificado para leer el mapa de habilitación.
 *
 * Reemplaza a los antiguos `_getEnabledMap` (retornaba null si el valor
 * no era objeto) y `_getEnabledState` (retornaba {} y no chequeaba
 * enabledPath). Ambos criterios se consolidan aquí bajo un solo
 * predicado (`_isPlainObject`), y cada consumidor decide cómo tratar
 * el `null`:
 *   - `mount` / `_handleEnabledStateChange`: tratan `null` como "sin
 *     restricción, montar todos los declarados".
 *   - `enable` / `disable`: tratan `null` como equivalente a `{}` y
 *     escriben una nueva entrada.
 *
 * Retorna:
 *   - el objeto del mapa si es un objeto plano válido,
 *   - `null` en cualquier otro caso (path no configurado, valor
 *     ausente, valor con tipo incorrecto).
 */
function _readEnabledMap() {
  if (!_config || !_config.enabledPath) return null;
  const state = _stack.pulsar.getState();
  const value = _getByPath(state, _config.enabledPath);
  return _isPlainObject(value) ? value : null;
}

function _setEnabledState(newMap) {
  const state = _stack.pulsar.getState();
  const nextState = _setByPath(state, _config.enabledPath, newMap);
  _stack.pulsar.setState(nextState);
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

/**
 * Monta comportamientos en un elemento.
 * Mantiene el elemento en _mounts incluso si la lista permitida está vacía,
 * para permitir futuras reconciliaciones.
 */
function _mountElement(element, enabledBehaviors = null) {
  const namesToMount = _computeBehaviorsToMount(element, enabledBehaviors);

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

  // No eliminar el elemento de _mounts aunque quede vacío.
}

function _destroyExistingBehaviors(element) {
  const elementMounts = _mounts.get(element);
  if (!elementMounts) return;

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

  _destroyExistingBehaviors(element);

  for (const name of namesToMount) {
    const entry = _instantiateBehavior(element, name);
    if (entry) {
      elementMounts.set(name, entry);
    }
  }
}

function _unmountElement(element) {
  const elementMounts = _mounts.get(element);
  if (elementMounts) {
    _destroyExistingBehaviors(element);
  }
  _mounts.delete(element); // En unmount real, eliminamos el registro
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

  const enabledMap = _readEnabledMap();

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
// RECONCILIACIÓN ENABLE/DISABLE
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

function _handleEnabledStateChange(enabledMap) {
  if (_mounts.size === 0) return;

  if (enabledMap !== undefined && !_isPlainObject(enabledMap)) {
    console.warn('[Chunklet] El valor en enabledPath debe ser un objeto plano. Se ignoran los cambios.');
    return;
  }

  const effectiveMap = _isPlainObject(enabledMap) ? enabledMap : null;
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
      _setElementBehaviors(element, desiredNames);
    }
  }
}

// ============================================
// OBSERVADOR DE MUTACIONES
// ============================================

export function observe(root) {
  if (_stack === null || _config === null) {
    throw new Error('[Chunklet] observe: setup() debe llamarse antes de observar.');
  }
  if (!root || typeof root.nodeType !== 'number') {
    throw new TypeError('[Chunklet] observe: root debe ser un Node.');
  }

  const observer = new MutationObserver((mutations) => {
    // Remociones primero (para que un "mover" no pierda el montaje)
    for (const mutation of mutations) {
      for (const node of mutation.removedNodes) {
        if (node.nodeType === 1) {
          try {
            unmount(node);
          } catch (error) {
            console.error('[Chunklet] observe: error en unmount de nodo removido', node, error);
          }
        }
      }
    }

    // Adiciones después
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) {
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

  return () => {
    observer.disconnect();
    _observers.delete(observer);
  };
}

export function disconnect() {
  for (const observer of _observers) {
    observer.disconnect();
  }
  _observers.clear();
}

// ============================================
// HELPERS DE ENABLE/DISABLE
// ============================================

/**
 * Consulta el DOM para conocer los behaviors declarados en `data-chunk`
 * de todos los elementos con `data-entity` igual a `entity`.
 *
 * Depende del `document` global (constraint documentado en el Contract
 * §11). Retorna un array deduplicado; si no hay elementos con esa
 * `data-entity`, retorna array vacío — el llamador decide qué hacer.
 */
function _getDeclaredBehaviorsForEntity(entity) {
  if (!_config) return [];
  const names = new Set();
  const selector = `[${_config.entityAttr}="${entity}"]`;
  const elements = document.querySelectorAll(selector);

  for (const el of elements) {
    const chunk = el.getAttribute('data-chunk');
    if (!chunk) continue;
    for (const name of chunk.split(/\s+/)) {
      if (name) names.add(name);
    }
  }

  return Array.from(names);
}

// ============================================
// API PÚBLICA: enable / disable
// ============================================

/**
 * Habilita un behavior para una entidad, con semántica simétrica a
 * `disable` (ver ChunkletJS_Contract_Specification §7.3).
 *
 * Comportamiento (refactor C-2):
 *   1. Lee el mapa actual (o `{}` si no existe).
 *   2. Si no hay entrada para `entity`, consulta el DOM para obtener
 *      los behaviors declarados (la lista base). Si `name` no está
 *      declarado, se agrega igualmente al conjunto — el mapa refleja
 *      intent del consumidor, no realidad del DOM.
 *   3. Computa la unión de la lista base con `{name}`.
 *   4. Escribe la nueva entrada en el mapa. Si la operación no cambió
 *      nada (ya estaba habilitado con esa misma lista), se emite el
 *      setState igual, para consistencia — el consumidor puede usar
 *      `skipEqualUpdates` de Pulsar si desea evitar la notificación
 *      redundante.
 */
export function enable(entity, name) {
  _assertSetupCalled();
  if (!_config.enabledPath) {
    throw new Error('[Chunklet] enable: enabledPath no configurado en setup().');
  }
  if (typeof entity !== 'string' || entity.trim() === '') {
    throw new TypeError('[Chunklet] enable: entity debe ser un string no vacío.');
  }
  if (typeof name !== 'string' || name.trim() === '') {
    throw new TypeError('[Chunklet] enable: name debe ser un string no vacío.');
  }

  const map = _readEnabledMap() || {};
  const hasEntry = Object.prototype.hasOwnProperty.call(map, entity);

  let baseList;
  if (hasEntry) {
    const entry = map[entity];
    baseList = Array.isArray(entry) ? entry : [];
  } else {
    // Sin entrada previa: consultamos el DOM para materializar el estado.
    baseList = _getDeclaredBehaviorsForEntity(entity);
  }

  // Unión: agregar `name` si no está.
  const nextEntry = baseList.includes(name)
    ? [...baseList]
    : [...baseList, name];

  const nextMap = { ...map, [entity]: nextEntry };
  _setEnabledState(nextMap);
}

/**
 * Deshabilita un behavior para una entidad, con semántica simétrica a
 * `enable` (ver ChunkletJS_Contract_Specification §7.3).
 *
 * Comportamiento (refactor C-2):
 *   1. Lee el mapa actual (o `{}` si no existe).
 *   2. Si no hay entrada para `entity`, consulta el DOM para obtener
 *      los behaviors declarados (la lista base).
 *   3. Computa la diferencia de la lista base menos `{name}`.
 *   4. Escribe la nueva entrada en el mapa, incluso si la lista
 *      resultante es vacía o si la operación no cambia el efecto
 *      observable. La escritura materializa el intent del consumidor.
 */
export function disable(entity, name) {
  _assertSetupCalled();
  if (!_config.enabledPath) {
    throw new Error('[Chunklet] disable: enabledPath no configurado en setup().');
  }
  if (typeof entity !== 'string' || entity.trim() === '') {
    throw new TypeError('[Chunklet] disable: entity debe ser un string no vacío.');
  }
  if (typeof name !== 'string' || name.trim() === '') {
    throw new TypeError('[Chunklet] disable: name debe ser un string no vacío.');
  }

  const map = _readEnabledMap() || {};
  const hasEntry = Object.prototype.hasOwnProperty.call(map, entity);

  let baseList;
  if (hasEntry) {
    const entry = map[entity];
    baseList = Array.isArray(entry) ? entry : [];
  } else {
    // Sin entrada previa: consultamos el DOM para materializar el estado.
    baseList = _getDeclaredBehaviorsForEntity(entity);
  }

  // Diferencia: quitar `name`.
  const nextEntry = baseList.filter(n => n !== name);

  const nextMap = { ...map, [entity]: nextEntry };
  _setEnabledState(nextMap);
}

// ============================================
// EXPORTACIÓN FINAL
// ============================================

const Chunklet = {
  setup,
  configure,
  define,
  mount,
  unmount,
  observe,
  disconnect,
  enable,
  disable,
};

export default Chunklet;