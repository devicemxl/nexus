/**
 * GraphletJS - Modelo semántico (Contrato v0.2.0)
 * Implementación pura, sin reactividad, sin dependencias.
 * 
 * Estructura interna:
 *   Map<string, { properties: object, links: Record<string, string[]> }>
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
  // API PÚBLICA (Checkpoint 1: Solo Lectura)
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
      links: { ...record.links } // Record<string, string[]> -> copiamos el objeto, pero los arrays internos se copian bajo demanda.
      // Nota: Para links, como es un objeto de arrays, la copia superficial es suficiente
      // porque los métodos de mutación (link/unlink) siempre reemplazan el array completo
      // en el registro interno en lugar de mutarlo directamente.
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
  // STUBS para Checkpoint 2, 3, 4 (Evitan errores de importación)
  // ============================================

  function put(id, properties = {}) {
    throw new Error('[Graphlet] put: Pendiente de implementación (CP2)');
  }

  function upsert(id, properties = {}) {
    throw new Error('[Graphlet] upsert: Pendiente de implementación (CP2)');
  }

  function update(id, patch) {
    throw new Error('[Graphlet] update: Pendiente de implementación (CP3)');
  }

  function deleteEntity(id) {
    throw new Error('[Graphlet] delete: Pendiente de implementación (CP3)');
  }

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

    // Escritura (CP2)
    put,
    upsert,

    // Mutación estricta / Eliminación (CP3)
    update,
    delete: deleteEntity,

    // Relaciones (CP4)
    link,
    unlink,
    unlinkAll,

    // Consultas (CP5)
    query,
  };
}

// ============================================
// EXPORTACIÓN POR DEFECTO (Opcional)
// ============================================

export default createGraphlet;