/**
 * GraphletJS - Modelo semántico (Contrato v0.2.0, código v0.2.1)
 * Implementación pura, sin reactividad, sin dependencias.
 *
 * Cambios respecto a v0.2.0:
 * - Fix en `query`: los arrays dentro de `links` ahora se clonan antes de
 *   pasarse al predicate, alineando el comportamiento con `get()` y
 *   evitando que un predicate mal escrito pueda corromper el estado interno.
 *
 * Estructura interna:
 *   Map<string, { properties: object, links: Record<string, string[]> }>
 */

// ============================================
// FACTORY FUNCTION
// ============================================

export function createGraphlet() {
  const _entities = new Map();

  // ============================================
  // UTILIDADES PRIVADAS
  // ============================================

  function _isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

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

  function _validatePlainObject(value, paramName = 'properties') {
    if (!_isPlainObject(value)) {
      throw new TypeError(`[Graphlet] ${paramName} debe ser un objeto plano`);
    }
  }

  /**
   * Clona el mapa de links de un record produciendo un nuevo objeto y
   * nuevos arrays para cada relación. Uso interno compartido entre
   * `get` y `query` para garantizar la misma inmutabilidad defensiva.
   */
  function _cloneLinks(links) {
    const out = {};
    for (const [rel, targets] of Object.entries(links)) {
      out[rel] = [...targets];
    }
    return out;
  }

  // ============================================
  // API PÚBLICA
  // ============================================

  // ---------- Lectura (CP1) ----------
  function get(id) {
    const record = _entities.get(id);
    if (!record) return null;

    return {
      id: id,
      properties: { ...record.properties },
      links: _cloneLinks(record.links),
    };
  }

  function allIds() {
    return Array.from(_entities.keys());
  }

  // ---------- Escritura Base (CP2) ----------
  function put(id, properties = {}) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error('[Graphlet] put: El ID debe ser un string no vacío');
    }
    _validatePlainObject(properties, 'properties');

    const record = _entities.get(id);
    if (record) {
      record.properties = { ...properties };
    } else {
      _entities.set(id, {
        properties: { ...properties },
        links: {},
      });
    }
  }

  function upsert(id, properties = {}) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error('[Graphlet] upsert: El ID debe ser un string no vacío');
    }
    _validatePlainObject(properties, 'properties');

    const record = _entities.get(id);
    if (record) {
      record.properties = { ...record.properties, ...properties };
    } else {
      _entities.set(id, {
        properties: { ...properties },
        links: {},
      });
    }
  }

  // ---------- Escritura Estricta / Eliminación (CP3) ----------
  function update(id, patch) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error('[Graphlet] update: El ID debe ser un string no vacío');
    }
    _validatePlainObject(patch, 'patch');

    const record = _getRecord(id);
    record.properties = { ...record.properties, ...patch };
  }

  function deleteEntity(id) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error('[Graphlet] delete: El ID debe ser un string no vacío');
    }

    const record = _getRecord(id);

    // Eliminar referencias entrantes
    for (const [otherId, otherRecord] of _entities) {
      if (otherId === id) continue;
      for (const [relation, targets] of Object.entries(otherRecord.links)) {
        const filtered = targets.filter(t => t !== id);
        if (filtered.length !== targets.length) {
          otherRecord.links[relation] = filtered;
          if (filtered.length === 0) {
            delete otherRecord.links[relation];
          }
        }
      }
    }

    _entities.delete(id);
  }

  // ---------- Relaciones (CP4) ----------
  function link(sourceId, relation, targetId) {
    if (typeof sourceId !== 'string' || sourceId.trim() === '') {
      throw new Error('[Graphlet] link: sourceId debe ser un string no vacío');
    }
    if (typeof relation !== 'string' || relation.trim() === '') {
      throw new Error('[Graphlet] link: relation debe ser un string no vacío');
    }
    if (typeof targetId !== 'string' || targetId.trim() === '') {
      throw new Error('[Graphlet] link: targetId debe ser un string no vacío');
    }

    const sourceRecord = _getRecord(sourceId);
    const targetRecord = _getRecord(targetId); // verificamos que existe

    if (!sourceRecord.links[relation]) {
      sourceRecord.links[relation] = [];
    }
    sourceRecord.links[relation].push(targetId);
  }

  function unlink(sourceId, relation, targetId) {
    if (typeof sourceId !== 'string' || sourceId.trim() === '') {
      throw new Error('[Graphlet] unlink: sourceId debe ser un string no vacío');
    }
    if (typeof relation !== 'string' || relation.trim() === '') {
      throw new Error('[Graphlet] unlink: relation debe ser un string no vacío');
    }
    if (typeof targetId !== 'string' || targetId.trim() === '') {
      throw new Error('[Graphlet] unlink: targetId debe ser un string no vacío');
    }

    const record = _entities.get(sourceId);
    if (!record) return;

    const targets = record.links[relation];
    if (!targets || targets.length === 0) return;

    const index = targets.indexOf(targetId);
    if (index !== -1) {
      targets.splice(index, 1);
      if (targets.length === 0) {
        delete record.links[relation];
      }
    }
  }

  function unlinkAll(sourceId, relation) {
    if (typeof sourceId !== 'string' || sourceId.trim() === '') {
      throw new Error('[Graphlet] unlinkAll: sourceId debe ser un string no vacío');
    }
    if (typeof relation !== 'string' || relation.trim() === '') {
      throw new Error('[Graphlet] unlinkAll: relation debe ser un string no vacío');
    }

    const record = _entities.get(sourceId);
    if (!record) return;

    if (record.links[relation]) {
      delete record.links[relation];
    }
  }

  // ---------- Consultas (CP5) ----------
  function query(predicate) {
    if (typeof predicate !== 'function') {
      throw new TypeError('[Graphlet] query: predicate debe ser una función');
    }

    const results = [];
    for (const [id, record] of _entities) {
      // Construimos el objeto que se pasa al predicado: (id, properties, links)
      // Se clonan tanto las propiedades como los arrays de cada relación,
      // igual que hace get(), para que un predicate mal escrito no pueda
      // mutar el estado interno.
      const props = { ...record.properties };
      const links = _cloneLinks(record.links);
      if (predicate(id, props, links)) {
        results.push(id);
      }
    }
    return results;
  }

  // ============================================
  // EXPORTACIÓN DE LA API
  // ============================================

  return {
    get,
    allIds,
    put,
    upsert,
    update,
    delete: deleteEntity,
    link,
    unlink,
    unlinkAll,
    query,
  };
}

// ============================================
// EXPORTACIÓN POR DEFECTO (Opcional)
// ============================================

export default createGraphlet;