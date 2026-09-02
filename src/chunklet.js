/**
 * ChunkletJS - CP1+CP2: API básica y contexto con gestión de recursos
 * 
 * - define(name, factory)
 * - mount(element)
 * - unmount(element)
 * - Contexto (ctx) con:
 *   - listen, subscribe, subscribeSelector, observe, timeout, interval, cleanup
 */

// Almacenamiento de fábricas y montajes
const _behaviors = new Map();          // nombre -> factory
const _mounts = new Map();             // elemento -> Map<nombre, { ctx, destroy, resources? }>

// ============================================
// CONTEXTO CON GESTIÓN DE RECURSOS
// ============================================

function _createContext(element, onDestroy) {
  // Array de funciones de limpieza (recursos)
  const resources = [];

  /**
   * Añade un recurso al contexto.
   * @param {Function} cleanupFn - Función que libera el recurso.
   */
  function addResource(cleanupFn) {
    if (typeof cleanupFn === 'function') {
      resources.push(cleanupFn);
    }
  }

  /**
   * Destruye el contexto: libera todos los recursos en orden LIFO.
   */
  function destroy() {
    // Invertir el orden (LIFO)
    for (let i = resources.length - 1; i >= 0; i--) {
      try {
        resources[i]();
      } catch (error) {
        console.error('[Chunklet] Error en cleanup de recurso:', error);
      }
    }
    resources.length = 0;
    if (typeof onDestroy === 'function') onDestroy();
  }

  // Objeto ctx que se pasa a la fábrica
  const ctx = {
    // ----------------------------------------
    // DOM Event Listeners
    // ----------------------------------------
    listen(target, event, handler, options = {}) {
      if (!target || typeof target.addEventListener !== 'function') {
        throw new TypeError('[Chunklet] ctx.listen: target debe ser un EventTarget');
      }
      target.addEventListener(event, handler, options);
      addResource(() => target.removeEventListener(event, handler, options));
    },

    // ----------------------------------------
    // Suscripciones a stores (Pulsar)
    // ----------------------------------------
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

    // ----------------------------------------
    // MutationObserver
    // ----------------------------------------
    observe(target, callback, options = { childList: true, subtree: true }) {
      if (!target || typeof target.nodeType !== 'number') {
        throw new TypeError('[Chunklet] ctx.observe: target debe ser un Node');
      }
      const observer = new MutationObserver(callback);
      observer.observe(target, options);
      addResource(() => observer.disconnect());
    },

    // ----------------------------------------
    // Temporizadores
    // ----------------------------------------
    timeout(handler, delay, ...args) {
      const id = setTimeout(handler, delay, ...args);
      addResource(() => clearTimeout(id));
    },

    interval(handler, interval, ...args) {
      const id = setInterval(handler, interval, ...args);
      addResource(() => clearInterval(id));
    },

    // ----------------------------------------
    // Cleanup personalizado
    // ----------------------------------------
    cleanup(fn) {
      if (typeof fn !== 'function') {
        throw new TypeError('[Chunklet] ctx.cleanup: fn debe ser una función');
      }
      addResource(fn);
    },
  };

  // Retornamos el contexto y la función de destrucción
  return { ctx, destroy };
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

export function mount(element) {
  if (!element || element.nodeType !== 1) {
    throw new TypeError('[Chunklet] mount: element debe ser un Element');
  }

  // Obtener todos los elementos con data-chunk (incluyendo el propio)
  const candidates = element.matches('[data-chunk]') ? [element] : [];
  candidates.push(...element.querySelectorAll('[data-chunk]'));

  for (const el of candidates) {
    const attr = el.getAttribute('data-chunk');
    if (!attr) continue;

    let elementMounts = _mounts.get(el);
    if (!elementMounts) {
      elementMounts = new Map();
      _mounts.set(el, elementMounts);
    }

    const names = attr.split(/\s+/).filter(Boolean);
    for (const name of names) {
      if (elementMounts.has(name)) continue;

      const factory = _behaviors.get(name);
      if (!factory) {
        console.warn(`[Chunklet] Comportamiento "${name}" no registrado`);
        continue;
      }

      // Crear contexto y función de destrucción
      let customDestroy = null;
      let destroyContext = null;

      const { ctx, destroy } = _createContext(el, () => {
        // Al destruir el contexto, eliminar la entrada del mapa
        elementMounts.delete(name);
        if (elementMounts.size === 0) {
          _mounts.delete(el);
        }
      });
      destroyContext = destroy;

      // Ejecutar la fábrica con el contexto
      let result;
      try {
        result = factory(el, ctx);
      } catch (error) {
        console.error(`[Chunklet] Error en fábrica "${name}":`, error);
        destroyContext(); // Liberar recursos
        continue;
      }

      // Si la fábrica devuelve un objeto con destroy, guardarlo
      if (result && typeof result === 'object' && typeof result.destroy === 'function') {
        customDestroy = result.destroy;
      }

      // Guardar la información del montaje
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
          destroyContext(); // Esto libera todos los recursos registrados en el contexto
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
        entry.destroy(); // Esto ejecuta customDestroy + destroyContext
      }
      // Nota: destroyContext elimina la entrada del mapa automáticamente
    }
    // Si el mapa quedó vacío, eliminar la entrada (por si acaso)
    if (_mounts.has(el) && _mounts.get(el).size === 0) {
      _mounts.delete(el);
    }
  }
}

// Función auxiliar para calcular la profundidad en el DOM
function getDepth(element) {
  let depth = 0;
  let current = element;
  while (current.parentNode) {
    depth++;
    current = current.parentNode;
  }
  return depth;
}

// ============================================
// EXPORTACIÓN POR DEFECTO (opcional)
// ============================================

export default { define, mount, unmount };