/**
 * Hydration Adapter (initial implementation)
 *
 * Contrato: adapters/hydration-adapter.spec.md v0.1.0
 * Implementation version: 0.1.0
 *
 * Popula un Graphlet a partir de un snapshot, en el arranque de la
 * aplicación, para que el primer ciclo de mount de Chunklet vea
 * estado ya cargado.
 *
 * One-shot: se ejecuta en el constructor, escribe, y sale. No observa
 * mutaciones, no hace fetch, no sincroniza in-flight.
 *
 * Uso:
 *   import { createHydrationAdapter } from './adapters/hydration-adapter.js';
 *   const adapter = createHydrationAdapter(
 *     { graphlet },
 *     { snapshot, mode: 'merge', onMissingTarget: 'throw' }
 *   );
 *   // El graphlet ya está poblado. `adapter.destroy()` es opcional
 *   // (no hay recursos vivos) pero se expone por contrato genérico.
 */

// ============================================
// UTILIDADES PRIVADAS
// ============================================

function _isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function _isGraphletInstance(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.put === 'function' &&
    typeof value.upsert === 'function' &&
    typeof value.link === 'function'
  );
}

// ============================================
// FACTORY
// ============================================

/**
 * Crea un Hydration Adapter y ejecuta la hidratación síncronamente.
 *
 * @param {Object} context
 * @param {GraphletInstance} context.graphlet - Graphlet a poblar.
 * @param {Object} options
 * @param {*} options.snapshot - Datos a hidratar. En forma canónica
 *   (ver §3.1 de la mini-spec) o cualquier forma que `parse`
 *   transforme a canónica.
 * @param {Function} [options.parse] - Transformador opcional
 *   `(input) => canonicalSnapshot`. Por defecto: identidad.
 * @param {'merge'|'replace'} [options.mode='merge'] - Cómo tratar
 *   entidades preexistentes: 'merge' usa upsert, 'replace' usa put.
 * @param {'throw'|'skip'} [options.onMissingTarget='throw'] - Qué
 *   hacer si un link referencia un target ausente.
 * @returns {{destroy: () => void}}
 */
export function createHydrationAdapter(context, options = {}) {
  // ---------- Validación del context ----------
  if (!context || typeof context !== 'object') {
    throw new TypeError('[HydrationAdapter] context debe ser un objeto');
  }
  if (!_isGraphletInstance(context.graphlet)) {
    throw new TypeError(
      '[HydrationAdapter] context.graphlet debe ser una instancia de Graphlet'
    );
  }

  // ---------- Validación de opciones ----------
  if (!('snapshot' in options)) {
    throw new TypeError('[HydrationAdapter] options.snapshot es requerido');
  }

  const parse = options.parse !== undefined ? options.parse : (input) => input;
  if (typeof parse !== 'function') {
    throw new TypeError('[HydrationAdapter] options.parse debe ser una función');
  }

  const mode = options.mode !== undefined ? options.mode : 'merge';
  if (mode !== 'merge' && mode !== 'replace') {
    throw new TypeError(
      `[HydrationAdapter] options.mode debe ser 'merge' o 'replace', recibido: '${mode}'`
    );
  }

  const onMissingTarget = options.onMissingTarget !== undefined
    ? options.onMissingTarget
    : 'throw';
  if (onMissingTarget !== 'throw' && onMissingTarget !== 'skip') {
    throw new TypeError(
      `[HydrationAdapter] options.onMissingTarget debe ser 'throw' o 'skip', recibido: '${onMissingTarget}'`
    );
  }

  const { graphlet } = context;
  const writeMethod = mode === 'replace' ? 'put' : 'upsert';

  // ============================================
  // EJECUCIÓN SÍNCRONA DE LA HIDRATACIÓN
  // ============================================

  // ---------- Paso 1: parse ----------
  // Si parse lanza, el error propaga al llamador (mini-spec §3.2 paso 1).
  const parsed = parse(options.snapshot);

  // ---------- Paso 2: validar forma canónica ----------
  if (!_isPlainObject(parsed)) {
    throw new TypeError(
      '[HydrationAdapter] snapshot parseado debe ser un objeto plano'
    );
  }
  if (!_isPlainObject(parsed.entities)) {
    throw new TypeError(
      "[HydrationAdapter] snapshot.entities debe ser un objeto plano (contener las entidades por id)"
    );
  }

  const entries = Object.entries(parsed.entities);

  // ---------- Paso 3, pasada 1: crear entidades ----------
  //
  // Se crean todas las entidades ANTES de crear cualquier link, para
  // garantizar que ambos endpoints de cada link existan cuando se
  // llame a graphlet.link (mini-spec §3.3).
  for (const [id, entry] of entries) {
    if (!_isPlainObject(entry)) {
      throw new TypeError(
        `[HydrationAdapter] snapshot.entities["${id}"] debe ser un objeto plano`
      );
    }
    const props = entry.properties !== undefined ? entry.properties : {};
    // La validación de que `props` sea objeto plano se delega a Graphlet,
    // que lanza TypeError con mensaje consistente si no lo es.
    graphlet[writeMethod](id, props);
  }

  // ---------- Paso 3, pasada 2: crear links ----------
  //
  // Se aplica dedup defensiva por relación antes de llamar a link,
  // para protegerse de snapshots serializados por sistemas que no
  // respetaron set semantics (Graphlet v0.3.0 §2.3 / G-0).
  for (const [sourceId, entry] of entries) {
    if (entry.links === undefined) continue;

    if (!_isPlainObject(entry.links)) {
      throw new TypeError(
        `[HydrationAdapter] snapshot.entities["${sourceId}"].links debe ser un objeto plano si está presente`
      );
    }

    for (const [relation, targets] of Object.entries(entry.links)) {
      if (!Array.isArray(targets)) {
        throw new TypeError(
          `[HydrationAdapter] snapshot.entities["${sourceId}"].links["${relation}"] debe ser un array de IDs`
        );
      }

      // Dedup defensiva usando Set (preserva orden de primera aparición).
      const uniqueTargets = [...new Set(targets)];

      for (const target of uniqueTargets) {
        try {
          graphlet.link(sourceId, relation, target);
        } catch (error) {
          if (onMissingTarget === 'skip') {
            console.warn(
              `[HydrationAdapter] link omitido: (${sourceId}) --${relation}--> (${target}): ${error.message}`
            );
            continue;
          }
          // Por defecto, propagar. Graphlet queda en estado parcial.
          throw error;
        }
      }
    }
  }

  // ============================================
  // API PÚBLICA
  // ============================================

  let _destroyed = false;

  function destroy() {
    // Idempotente. No hay recursos vivos que liberar; el flag existe
    // para cumplir el contrato genérico (Nexus Adapter §3.3).
    if (_destroyed) return;
    _destroyed = true;
  }

  return {
    destroy,
  };
}

export default createHydrationAdapter;
