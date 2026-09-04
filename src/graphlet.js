/**
 * GraphletJS - Modelo semántico (Contrato v0.3.0, código v0.3.0)
 * Implementación pura, sin reactividad, sin dependencias.
 *
 * Cambios respecto a v0.2.1 (breaking):
 * - G-0: `link` tiene ahora semántica de set idempotente. Llamar
 *   `link(source, relation, target)` con un triple que ya existe
 *   es un no-op, no se agrega duplicado. Consecuentemente, `unlink`
 *   deja de tener ambigüedad de "primera ocurrencia" — al no haber
 *   duplicados posibles, la operación es inequívoca.
 * - Se documenta explícitamente la política de errores en `query`:
 *   los errores lanzados por el predicate se propagan al llamador;
 *   Graphlet no los captura.
 *
 * Cambios respecto a v0.2.0:
 * - Fix en `query`: los arrays dentro de `links` se clonan antes de
 *   pasarse al predicate, alineando el comportamiento con `get()` y
 *   evitando que un predicate mal escrito pueda corromper el estado
 *   interno.
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

  // ---------- Lectura ----------
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

  // ---------- Escritura Base ----------
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

  // ---------- Escritura Estricta / Eliminación ----------
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

  // ---------- Relaciones ----------
  /**
   * Agrega una relación dirigida entre dos entidades, con semántica
   * de set (G-0, v0.3.0):
   *   - Si el triple (sourceId, relation, targetId) NO existe: se agrega.
   *   - Si el triple YA existe: no-op silencioso, el array permanece
   *     idéntico. Set idempotente.
   *
   * Para modelar múltiples relaciones distintas entre los mismos dos
   * nodos, represente cada relación como una entidad propia con su
   * identificador; no duplique llamadas a link.
   */
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
    _getRecord(targetId); // verificamos que target existe (lanza si no)

    if (!sourceRecord.links[relation]) {
      sourceRecord.links[relation] = [];
    }

    // G-0: semántica de set — si el target ya está, no-op
    if (sourceRecord.links[relation].includes(targetId)) {
      return;
    }

    sourceRecord.links[relation].push(targetId);
  }

  /**
   * Elimina una relación dirigida. Al no haber duplicados posibles
   * (G-0), la operación es inequívoca: quita el (único) target si
   * está, o no-op si no está.
   */
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

  // ---------- Consultas ----------
  /**
   * Itera sobre todas las entidades y retorna los IDs para los que el
   * predicate retorna true.
   *
   * Política de errores (documentada en el Contract v0.3.0 §4):
   *   Si el predicate lanza, el error se propaga al llamador.
   *   Graphlet no captura, no loguea, no continúa con las entidades
   *   restantes. La iteración se detiene en el punto del throw.
   *
   * Las propiedades y los arrays de links se clonan antes de pasarse
   * al predicate, de modo que un predicate mal escrito no puede
   * corromper el estado interno del grafo.
   */
  function query(predicate) {
    if (typeof predicate !== 'function') {
      throw new TypeError('[Graphlet] query: predicate debe ser una función');
    }

    const results = [];
    for (const [id, record] of _entities) {
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