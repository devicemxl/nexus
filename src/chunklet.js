/**
 * ChunkletJS - DOM behaviors (Contrato v0.2.0)
 * Sistema de componentes y comportamientos para el DOM.
 * 
 * Características:
 * - Definición de comportamientos con Chunklet.define(name, factory)
 * - Montaje/desmontaje manual con mount/unmount
 * - Descubrimiento automático con observe/disconnect
 * - Contexto (ctx) con gestión automática de recursos
 * - Soporte para múltiples comportamientos por elemento (data-chunk)
 */

// ============================================
// ALMACENAMIENTO INTERNO
// ============================================

const _behaviors = new Map(); // nombre -> función fábrica
const _mounts = new Map(); // elemento -> Map<nombre, { ctx, destroy }>  (Map normal para poder iterar)
let _observer = null; // MutationObserver para descubrimiento automático
let _observing = false;

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
    // LIFO: ejecutar recursos en orden inverso
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
// API GLOBAL (CP1)
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

export function mount(element) {
  if (!element || element.nodeType !== 1) {
    throw new TypeError('[Chunklet] mount: element debe ser un Element');
  }

  const candidates = element.matches('[data-chunk]') ? [element] : [];
  const descendants = element.querySelectorAll('[data-chunk]');
  candidates.push(...descendants);

  for (const el of candidates) {
    const chunkAttr = el.getAttribute('data-chunk');
    if (!chunkAttr) continue;

    let elementMounts = _mounts.get(el);
    if (!elementMounts) {
      elementMounts = new Map();
      _mounts.set(el, elementMounts);
    }

    const names = chunkAttr.split(/\s+/).filter(Boolean);
    for (const name of names) {
      if (elementMounts.has(name)) continue;

      const factory = _behaviors.get(name);
      if (!factory) {
        console.warn(`[Chunklet] Comportamiento "${name}" no registrado`);
        continue;
      }

      const { ctx, destroy: destroyContext } = _createContext(el, () => {
        // Al destruir el contexto, eliminar del mapa
        elementMounts.delete(name);
        if (elementMounts.size === 0) {
          _mounts.delete(el);
        }
      });

      let result;
      try {
        result = factory(el, ctx);
      } catch (error) {
        console.error(`[Chunklet] Error en fábrica "${name}":`, error);
        destroyContext();
        continue;
      }

      let customDestroy = null;
      if (result && typeof result === 'object' && typeof result.destroy === 'function') {
        customDestroy = result.destroy;
      }

      elementMounts.set(name, {
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
}

export function unmount(element) {
  if (!element || element.nodeType !== 1) {
    throw new TypeError('[Chunklet] unmount: element debe ser un Element');
  }

  // Recolectar todos los elementos montados que están dentro del elemento raíz
  const elementsToUnmount = [];
  for (const [el, _] of _mounts) {
    if (element.contains(el) || el === element) {
      elementsToUnmount.push(el);
    }
  }

  // Ordenar por profundidad (hijos primero)
  elementsToUnmount.sort((a, b) => {
    const depthA = getDepth(a);
    const depthB = getDepth(b);
    return depthB - depthA;
  });

  // Desmontar cada elemento
  for (const el of elementsToUnmount) {
    const elementMounts = _mounts.get(el);
    if (!elementMounts) continue;

    // Obtener nombres en orden inverso al de montaje (el orden de inserción en el Map)
    const names = Array.from(elementMounts.keys()).reverse();
    for (const name of names) {
      const entry = elementMounts.get(name);
      if (entry && typeof entry.destroy === 'function') {
        entry.destroy(); // esto elimina la entrada del mapa via destroyContext
      }
    }
    // Después del bucle, el mapa debería estar vacío y _mounts.delete(el) ya se ejecutó
    // por cada destroyContext, pero por si acaso:
    if (_mounts.has(el) && _mounts.get(el).size === 0) {
      _mounts.delete(el);
    }
  }
}

function getDepth(element) {
  let depth = 0;
  let current = element;
  while (current.parentNode) {
    depth++;
    current = current.parentNode;
  }
  return depth;
}

export function observe(root) {
  if (!root || typeof root.nodeType !== 'number') {
    throw new TypeError('[Chunklet] observe: root debe ser un Node');
  }

  if (_observer) {
    _observer.disconnect();
    _observer = null;
  }

  _observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) {
          mount(node);
        }
      }
      // Nota: los nodos eliminados no se manejan automáticamente porque no podemos iterar WeakMap.
      // Pero como ahora usamos Map, podríamos hacer un barrido periódico, pero lo dejamos así.
      // Si el usuario quiere liberar recursos, debe llamar a unmount explícitamente.
    }
  });

  _observer.observe(root, {
    childList: true,
    subtree: true,
  });

  _observing = true;

  return () => {
    disconnect();
  };
}

export function disconnect() {
  if (_observer) {
    _observer.disconnect();
    _observer = null;
  }
  _observing = false;
}

export default { define, mount, unmount, observe, disconnect };