/**
 * ChunkletJS - CP1: API básica
 * 
 * - define(name, factory)
 * - mount(element)
 * - unmount(element)
 * 
 * Sin gestión de recursos, sin integración con Pulsar.
 */

// Almacenamiento de fábricas y montajes
const _behaviors = new Map();          // nombre -> factory
const _mounts = new Map();             // elemento -> Map<nombre, { factory, result, ctx }>

// ============================================
// CONTEXTO MÍNIMO (vacío, solo para cumplir)
// ============================================

function _createMinimalContext(element) {
  // Por ahora, un objeto vacío. En CP2 añadiremos los métodos.
  return {};
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

    // Obtener o crear el mapa de montajes para este elemento
    let elementMounts = _mounts.get(el);
    if (!elementMounts) {
      elementMounts = new Map();
      _mounts.set(el, elementMounts);
    }

    // Procesar cada nombre (separado por espacios)
    const names = attr.split(/\s+/).filter(Boolean);
    for (const name of names) {
      // Si ya está montado, saltar
      if (elementMounts.has(name)) continue;

      const factory = _behaviors.get(name);
      if (!factory) {
        console.warn(`[Chunklet] Comportamiento "${name}" no registrado`);
        continue;
      }

      // Crear contexto mínimo
      const ctx = _createMinimalContext(el);

      // Ejecutar la fábrica
      let result;
      try {
        result = factory(el, ctx);
      } catch (error) {
        console.error(`[Chunklet] Error en fábrica "${name}":`, error);
        continue;
      }

      // Guardar el resultado (por si la fábrica devuelve un destroy)
      elementMounts.set(name, {
        factory,
        result,
        ctx,
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
      if (entry) {
        // Si la fábrica devolvió un objeto con destroy, llamarlo
        if (entry.result && typeof entry.result.destroy === 'function') {
          try {
            entry.result.destroy();
          } catch (error) {
            console.error(`[Chunklet] Error en destroy de "${name}":`, error);
          }
        }
        elementMounts.delete(name);
      }
    }
    // Si el mapa quedó vacío, eliminar la entrada
    if (elementMounts.size === 0) {
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