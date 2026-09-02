/**
 * ChunkletJS - CP3: Integración con Pulsar
 * 
 * - define(name, factory)
 * - mount(element, options)
 * - unmount(element)
 * - Suscripción a Pulsar para estado de habilitación
 * - Gestión de recursos (ctx)
 * - ID consistente para elementos (prioriza element.id)
 */

const _behaviors = new Map();
const _mounts = new Map();
let _pulsarStore = null;
let _statePath = 'ui.behaviors';
let _unsubscribe = null;
let _isObserving = false;

// ============================================
// CONTEXTO (CP2)
// ============================================

function _createContext(element, onDestroy) {
  const resources = [];

  function addResource(cleanupFn) {
    if (typeof cleanupFn === 'function') {
      resources.push(cleanupFn);
    }
  }

  const ctx = {
    listen(target, event, handler, options = {}) {
      if (!target || typeof target.addEventListener !== 'function') {
        throw new TypeError('[Chunklet] ctx.listen: target debe ser un EventTarget');
      }
      target.addEventListener(event, handler, options);
      addResource(() => target.removeEventListener(event, handler, options));
    },

    subscribe(store, listener) {
      if (!store || typeof store.subscribe !== 'function') {
        throw new TypeError('[Chunklet] ctx.subscribe: store debe tener método subscribe');
      }
      const unsubscribe = store.subscribe(listener);
      addResource(unsubscribe);
    },

    subscribeSelector(store, selector, listener, options = {}) {
      if (!store || typeof store.subscribeSelector !== 'function') {
        throw new TypeError('[Chunklet] ctx.subscribeSelector: store debe tener subscribeSelector');
      }
      const unsubscribe = store.subscribeSelector(selector, listener, options);
      addResource(unsubscribe);
    },

    observe(target, callback, options = { childList: true, subtree: true }) {
      if (!target || typeof target.nodeType !== 'number') {
        throw new TypeError('[Chunklet] ctx.observe: target debe ser un Node');
      }
      const observer = new MutationObserver(callback);
      observer.observe(target, options);
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
  };

  const destroy = () => {
    for (let i = resources.length - 1; i >= 0; i--) {
      try {
        resources[i]();
      } catch (error) {
        console.error('[Chunklet] Error en cleanup de recurso:', error);
      }
    }
    resources.length = 0;
    if (typeof onDestroy === 'function') onDestroy();
  };

  return { ctx, destroy };
}

// ============================================
// UTILIDADES PRIVADAS
// ============================================

function getDepth(element) {
  let depth = 0;
  let current = element;
  while (current.parentNode) {
    depth++;
    current = current.parentNode;
  }
  return depth;
}

function _getElementId(element) {
  if (element.id) return element.id;
  let id = element.getAttribute('data-chunk-id');
  if (id) return id;
  id = 'el_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  element.setAttribute('data-chunk-id', id);
  return id;
}

// ============================================
// LÓGICA DE MONTAJE/DESMONTAJE (reactiva)
// ============================================

function _mountElement(element, enabledBehaviors) {
  const chunkAttr = element.getAttribute('data-chunk');
  if (!chunkAttr) return;

  // PASO 1: Desmontar TODOS los comportamientos existentes en este elemento
  const existingMounts = _mounts.get(element);
  if (existingMounts) {
    const names = Array.from(existingMounts.keys()).reverse();
    for (const name of names) {
      const entry = existingMounts.get(name);
      if (entry && typeof entry.destroy === 'function') {
        entry.destroy();
      }
    }
    _mounts.delete(element);
  }

  // PASO 2: Calcular los comportamientos a montar según enabledBehaviors
  const allNames = chunkAttr.split(/\s+/).filter(Boolean);
  let namesToMount;
  if (enabledBehaviors === null) {
    namesToMount = allNames;
  } else if (Array.isArray(enabledBehaviors) && enabledBehaviors.length === 0) {
    namesToMount = [];
  } else if (Array.isArray(enabledBehaviors)) {
    namesToMount = allNames.filter(name => enabledBehaviors.includes(name));
  } else {
    namesToMount = allNames;
  }

  if (namesToMount.length === 0) return;

  // PASO 3: Crear nuevo mapa para este elemento
  const newElementMounts = new Map();
  _mounts.set(element, newElementMounts);

  // PASO 4: Montar los comportamientos en orden
  for (const name of namesToMount) {
    const factory = _behaviors.get(name);
    if (!factory) {
      console.warn(`[Chunklet] Comportamiento "${name}" no registrado`);
      continue;
    }

    const { ctx, destroy: destroyContext } = _createContext(element, () => {
      newElementMounts.delete(name);
      if (newElementMounts.size === 0) {
        _mounts.delete(element);
      }
    });

    let result;
    try {
      result = factory(element, ctx);
    } catch (error) {
      console.error(`[Chunklet] Error en fábrica "${name}":`, error);
      destroyContext();
      continue;
    }

    let customDestroy = null;
    if (result && typeof result === 'object' && typeof result.destroy === 'function') {
      customDestroy = result.destroy;
    }

    newElementMounts.set(name, {
      ctx,
      destroy: () => {
        if (customDestroy) {
          try {
            customDestroy();
          } catch (error) {
            console.error(`[Chunklet] Error en destroy personalizado de "${name}":`, error);
          }
        }
        destroyContext();
      },
    });
  }
}

// ============================================
// SUSCRIPCIÓN A PULSAR (CORREGIDA)
// ============================================

function _subscribeToPulsar() {
  if (!_pulsarStore) return;

  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }

  _unsubscribe = _pulsarStore.subscribeSelector(
    (state) => state[_statePath],
    (behaviorsState) => {
      if (_isObserving) return;
      _isObserving = true;

      // 🔥 CORRECCIÓN: Hacer una copia de las claves antes de iterar
      const allElements = Array.from(_mounts.keys());
      for (const el of allElements) {
        const id = _getElementId(el);
        const enabled = behaviorsState && behaviorsState[id] ? behaviorsState[id] : null;
        _mountElement(el, enabled);
      }

      _isObserving = false;
    },
    { immediate: true }
  );
}

// ============================================
// API PÚBLICA
// ============================================

export function define(name, factory) {
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

export function mount(element, options = {}) {
  if (!element || element.nodeType !== 1) {
    throw new TypeError('[Chunklet] mount: element debe ser un Element');
  }

  const { pulsarStore = null, statePath = 'ui.behaviors' } = options;

  if (pulsarStore) {
    if (!_pulsarStore) {
      _pulsarStore = pulsarStore;
      _statePath = statePath;
      _subscribeToPulsar();
    } else if (_pulsarStore !== pulsarStore || _statePath !== statePath) {
      if (_unsubscribe) {
        _unsubscribe();
        _unsubscribe = null;
      }
      _pulsarStore = pulsarStore;
      _statePath = statePath;
      _subscribeToPulsar();
    }
  }

  const candidates = element.matches('[data-chunk]') ? [element] : [];
  candidates.push(...element.querySelectorAll('[data-chunk]'));

  let enabledMap = null;
  if (_pulsarStore) {
    const state = _pulsarStore.getState();
    const behaviorsState = state[_statePath] || {};
    enabledMap = behaviorsState;
  }

  for (const el of candidates) {
    let enabled = null;
    if (enabledMap) {
      const id = _getElementId(el);
      enabled = enabledMap[id] || null;
    }
    _mountElement(el, enabled);
  }
}

export function unmount(element) {
  if (!element || element.nodeType !== 1) {
    throw new TypeError('[Chunklet] unmount: element debe ser un Element');
  }

  const elementsToUnmount = [];
  for (const [el, _] of _mounts) {
    if (element.contains(el) || el === element) {
      elementsToUnmount.push(el);
    }
  }

  elementsToUnmount.sort((a, b) => {
    return getDepth(b) - getDepth(a);
  });

  for (const el of elementsToUnmount) {
    const elementMounts = _mounts.get(el);
    if (!elementMounts) continue;

    const names = Array.from(elementMounts.keys()).reverse();
    for (const name of names) {
      const entry = elementMounts.get(name);
      if (entry && typeof entry.destroy === 'function') {
        entry.destroy();
      }
    }
    if (_mounts.has(el) && _mounts.get(el).size === 0) {
      _mounts.delete(el);
    }
  }
}

export function disableBehavior(element, name, pulsarStore, statePath = 'ui.behaviors') {
  // ... (helper, sin cambios) ...
}

export function enableBehavior(element, name, pulsarStore, statePath = 'ui.behaviors') {
  // ... (helper, sin cambios) ...
}

export default {
  define,
  mount,
  unmount,
  disableBehavior,
  enableBehavior,
};