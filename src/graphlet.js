/**
 * GraphletJS - Modelo semántico (Contrato v0.2.0)
 * Implementación pura, sin reactividad, sin dependencias.
 * 
 * Estructura interna:
 *   Map<string, { properties: object, links: Record<string, string[]> }>
 * 
 * Checkpoints alcanzados:
 *   CP1: get, allIds
 *   CP2: put, upsert
 *   CP3: update, delete
 *   (CP4: link, unlink, unlinkAll - stubs)
 *   (CP5: query - stub)
 */

// ============================================
// FACTORY FUNCTION
// ============================================

export function createGraphlet() {
  // Almacenamiento interno: ID -> { properties, links }
  const _entities = new Map();

  // ============================================
  // UTILIDADES PRIVADAS
  // ============================================

  /**
   * Verifica si un valor es un objeto plano.
   */
  function _isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  /**
   * Obtiene el registro interno. Lanza error si no existe (fail-fast).
   * @throws {Error} Si la entidad no existe.
   */
  function _getRecord(id) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error('[Graphlet] El ID debe ser un string no vacío');
    }
    const record = _entities.get(id);
    if (!record) {
      throw new Error(`[Graphlet] La entidad "${id}" no existe`);
    }
    return record;
  }

  /**
   * Valida que el parámetro sea un objeto plano.
   * @throws {TypeError} Si no es objeto plano.
   */
  function _validatePlainObject(value, paramName = 'properties') {
    if (!_isPlainObject(value)) {
      throw new TypeError(`[Graphlet] ${paramName} debe ser un objeto plano`);
    }
  }

  // ============================================
  // API PÚBLICA (Lectura - CP1)
  // ============================================

  /**
   * Obtiene una entidad por su ID.
   * @param {string} id - Identificador único.
   * @returns {object|null} { id, properties, links } o null si no existe.
   */
  function get(id) {
    const record = _entities.get(id);
    if (!record) return null;

    // Retornamos copias superficiales (shallow copies) para evitar mutación externa.
    return {
      id: id,
      properties: { ...record.properties },
      links: { ...record.links } // Record<string, string[]> -> copiamos el objeto
    };
  }

  /**
   * Retorna todos los IDs de las entidades existentes.
   * @returns {string[]} Array de IDs.
   */
  function allIds() {
    return Array.from(_entities.keys());
  }

  // ============================================
  // API PÚBLICA (Escritura Base - CP2)
  // ============================================

  /**
   * Crea una entidad o reemplaza totalmente sus propiedades.
   * @param {string} id - Identificador único.
   * @param {object} [properties={}] - Propiedades a asignar.
   * @throws {TypeError} Si properties no es objeto plano.
   */
  function put(id, properties = {}) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error('[Graphlet] put: El ID debe ser un string no vacío');
    }
    _validatePlainObject(properties, 'properties');

    // Reemplazo total de properties (o creación)
    _entities.set(id, {
      properties: { ...properties }, // Copia para evitar mutación externa
      links: {} // Siempre se inicia con links vacío
    });
  }

  /**
   * Crea una entidad o fusiona (shallow merge) propiedades en una existente.
   * @param {string} id - Identificador único.
   * @param {object} [properties={}] - Propiedades a fusionar.
   * @throws {TypeError} Si properties no es objeto plano.
   */
  function upsert(id, properties = {}) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error('[Graphlet] upsert: El ID debe ser un string no vacío');
    }
    _validatePlainObject(properties, 'properties');

    const existing = _entities.get(id);
    if (existing) {
      // Shallow merge
      existing.properties = { ...existing.properties, ...properties };
    } else {
      // Crear nueva entidad
      _entities.set(id, {
        properties: { ...properties },
        links: {}
      });
    }
  }

  // ============================================
  // API PÚBLICA (Mutación Estricta / Eliminación - CP3)
  // ============================================

  /**
   * Actualiza una entidad existente mediante shallow merge.
   * @param {string} id - Identificador único.
   * @param {object} patch - Objeto con las propiedades a fusionar.
   * @throws {Error} Si la entidad no existe.
   * @throws {TypeError} Si patch no es objeto plano.
   */
  function update(id, patch) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error('[Graphlet] update: El ID debe ser un string no vacío');
    }
    _validatePlainObject(patch, 'patch');

    // Obtiene el registro; lanza error si no existe (fail-fast)
    const record = _getRecord(id);
    // Shallow merge
    record.properties = { ...record.properties, ...patch };
  }

  /**
   * Elimina una entidad y todas las relaciones incidentes (entrantes y salientes).
   * @param {string} id - Identificador único.
   * @throws {Error} Si la entidad no existe.
   */
  function deleteEntity(id) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error('[Graphlet] delete: El ID debe ser un string no vacío');
    }

    // Verificar que existe (fail-fast)
    const record = _getRecord(id); // Lanza error si no existe

    // 1. Eliminar relaciones entrantes: barrer todas las entidades y borrar 'id' de sus links
    for (const [otherId, otherRecord] of _entities) {
      if (otherId === id) continue; // Saltamos la propia entidad (la eliminaremos después)
      // Iteramos sobre las relaciones de otherRecord
      for (const [relation, targets] of Object.entries(otherRecord.links)) {
        // Filtramos los targets que no sean 'id'
        const filtered = targets.filter(t => t !== id);
        if (filtered.length !== targets.length) {
          // Si hubo cambios, actualizamos el array
          otherRecord.links[relation] = filtered;
          // Si el array queda vacío, eliminamos la clave para mantener limpio
          if (filtered.length === 0) {
            delete otherRecord.links[relation];
          }
        }
      }
    }

    // 2. Eliminar la entidad misma (junto con sus links salientes)
    _entities.delete(id);
  }

  // ============================================
  // STUBS para CP4 y CP5 (se implementarán en siguientes fases)
  // ============================================

  function link(sourceId, relation, targetId) {
    throw new Error('[Graphlet] link: Pendiente de implementación (CP4)');
  }

  function unlink(sourceId, relation, targetId) {
    throw new Error('[Graphlet] unlink: Pendiente de implementación (CP4)');
  }

  function unlinkAll(sourceId, relation) {
    throw new Error('[Graphlet] unlinkAll: Pendiente de implementación (CP4)');
  }

  function query(predicate) {
    throw new Error('[Graphlet] query: Pendiente de implementación (CP5)');
  }

  // ============================================
  // EXPORTACIÓN DE LA API
  // ============================================

  return {
    // Lectura (CP1)
    get,
    allIds,

    // Escritura Base (CP2)
    put,
    upsert,

    // Mutación estricta / Eliminación (CP3)
    update,
    delete: deleteEntity,

    // Relaciones (CP4 - stubs)
    link,
    unlink,
    unlinkAll,

    // Consultas (CP5 - stub)
    query,
  };
}

// ============================================
// EXPORTACIÓN POR DEFECTO (Opcional)
// ============================================

export default createGraphlet;