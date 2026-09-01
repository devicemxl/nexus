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

  // ============================================
  // API PÚBLICA
  // ============================================

  // ---------- Lectura (CP1) ----------
  function get(id) {
    const record = _entities.get(id);
    if (!record) return null;

    // Clonamos los links: cada array es clonado para evitar mutación externa.
    const linksClone = {};
    for (const [rel, targets] of Object.entries(record.links)) {
      linksClone[rel] = [...targets]; // copia del array
    }

    return {
      id: id,
      properties: { ...record.properties },
      links: linksClone,
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
      // Reemplazar propiedades (mantener links existentes)
      record.properties = { ...properties };
    } else {
      // Crear nueva entidad con links vacíos
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
      // Shallow merge
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

    const record = _getRecord(id); // lanza si no existe
    record.properties = { ...record.properties, ...patch };
  }

  function deleteEntity(id) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error('[Graphlet] delete: El ID debe ser un string no vacío');
    }

    // Verificar existencia (fail-fast)
    const record = _getRecord(id);

    // 1. Eliminar referencias entrantes a 'id' desde otras entidades
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

    // 2. Eliminar la entidad (sus links salientes desaparecen con ella)
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

    // Verificar que ambos nodos existen (fail-fast)
    const sourceRecord = _getRecord(sourceId);
    const targetRecord = _getRecord(targetId);

    // Agregar la relación (se permiten duplicados)
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
    if (!record) return; // Si no existe, no-op (según contrato)

    const targets = record.links[relation];
    if (!targets || targets.length === 0) return;

    // Buscar y eliminar la primera ocurrencia de targetId
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
    if (!record) return; // Si no existe, no-op

    if (record.links[relation]) {
      delete record.links[relation];
    }
  }

  // ---------- Consultas (CP5 - pendiente) ----------
  function query(predicate) {
    throw new Error('[Graphlet] query: Pendiente de implementación (CP5)');
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