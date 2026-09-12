/**
 * Política de almacenamiento de la aplicación.
 *
 * Separado de `boot.js` a propósito: aquí es donde va a crecer la migración
 * de esquema en cuanto el modelo de entidades cambie, y esa lógica no debe
 * mezclarse con la secuencia de arranque.
 *
 * Escena 1.1 — Fase 1.
 */

import { createNebula } from '../../../src/nebula.js';
import { createHydrationAdapter } from '../../../src/adapters/hydration-adapter.js';

/**
 * Clave de storage con versión de esquema en el nombre.
 *
 * El segmento `v1` cuesta cero hoy y evita el día en que el modelo de
 * entidades cambie y haya snapshots viejos en circulación sin forma de
 * distinguirlos. Una migración futura lee `v1`, transforma, escribe `v2`.
 */
export const CLAVE_SNAPSHOT = 'nexus.chat.v1';

/** Prefijo bajo el que se preservan los snapshots que no se pudieron leer. */
export const PREFIJO_CORRUPTO = `${CLAVE_SNAPSHOT}.corrupto.`;

/**
 * Valida que un snapshot parseado tenga la forma canónica que Hydration
 * consume, sin depender de que Hydration lance a mitad de camino.
 *
 * @returns {string|null} descripción del problema, o null si la forma es válida.
 */
function _problemaDeForma(datos) {
  if (datos === null || typeof datos !== 'object' || Array.isArray(datos)) {
    return 'el snapshot no es un objeto';
  }
  if (datos.entities === null || typeof datos.entities !== 'object' || Array.isArray(datos.entities)) {
    return 'falta la clave `entities` o no es un objeto';
  }
  for (const [id, entrada] of Object.entries(datos.entities)) {
    if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) {
      return `la entrada "${id}" no es un objeto`;
    }
    if (entrada.links !== undefined) {
      if (entrada.links === null || typeof entrada.links !== 'object' || Array.isArray(entrada.links)) {
        return `los links de "${id}" no son un objeto`;
      }
      for (const [relacion, destinos] of Object.entries(entrada.links)) {
        if (!Array.isArray(destinos)) {
          return `los links de "${id}" bajo "${relacion}" no son un array`;
        }
      }
    }
  }
  return null;
}

/**
 * Ensaya la hidratación sobre un grafo desechable.
 *
 * La validación de forma cubre la mayoría de los casos, pero Hydration puede
 * lanzar por razones que sólo aparecen al aplicar. Si lanzara sobre el grafo
 * real, éste quedaría a medio poblar — un estado peor que no haber cargado
 * nada, porque la aplicación no tiene forma de saber que le faltan datos.
 *
 * El ensayo cuesta una pasada O(N) adicional. Comparado con el O(N²) que la
 * secuencia de arranque existe para evitar, es ruido.
 *
 * @returns {string|null} mensaje de error, o null si la hidratación es segura.
 */
function _ensayarHidratacion(snapshot) {
  try {
    createHydrationAdapter(
      { nebula: createNebula() },
      { snapshot, onMissingTarget: 'skip' }
    );
    return null;
  } catch (error) {
    return error.message;
  }
}

/**
 * Aparta un blob ilegible bajo una clave con marca de tiempo.
 *
 * Nunca se destruye en silencio lo que el usuario guardó, aunque parezca
 * basura: puede ser el único ejemplar de una conversación y puede haber sido
 * escrito por una versión que sabemos leer mañana. Si apartarlo falla
 * (cuota llena, por ejemplo), se reporta pero no se interrumpe el arranque.
 */
function _apartarCorrupto(storage, crudo, motivo) {
  const claveDestino = PREFIJO_CORRUPTO + new Date().toISOString().replace(/[:.]/g, '-');
  try {
    storage.setItem(claveDestino, crudo);
    console.warn(
      `[persistencia] snapshot ilegible (${motivo}). ` +
      `Preservado en "${claveDestino}". Se arranca con estado vacío.`
    );
    return claveDestino;
  } catch (error) {
    console.warn(
      `[persistencia] snapshot ilegible (${motivo}) y no se pudo preservar:`,
      error
    );
    return null;
  }
}

/**
 * Lee el snapshot guardado y decide si es utilizable.
 *
 * Nunca lanza. Un arranque no debe caerse porque el estado previo esté roto;
 * la aplicación tiene que poder abrir siempre, aunque sea vacía.
 *
 * @param {Storage} storage - Objeto con la Web Storage API.
 * @param {string} clave
 * @returns {{snapshot: object|null, estado: 'ok'|'vacio'|'corrupto',
 *            motivo?: string, preservadoEn?: string|null}}
 */
export function leerSnapshot(storage, clave = CLAVE_SNAPSHOT) {
  let crudo;
  try {
    crudo = storage.getItem(clave);
  } catch (error) {
    // Safari en modo privado puede lanzar al tocar localStorage.
    console.warn('[persistencia] storage inaccesible al leer:', error);
    return { snapshot: null, estado: 'vacio' };
  }

  if (crudo === null || crudo === undefined || crudo === '') {
    return { snapshot: null, estado: 'vacio' };
  }

  let datos;
  try {
    datos = JSON.parse(crudo);
  } catch (error) {
    return {
      snapshot: null,
      estado: 'corrupto',
      motivo: 'JSON inválido',
      preservadoEn: _apartarCorrupto(storage, crudo, 'JSON inválido'),
    };
  }

  const problema = _problemaDeForma(datos);
  if (problema !== null) {
    return {
      snapshot: null,
      estado: 'corrupto',
      motivo: problema,
      preservadoEn: _apartarCorrupto(storage, crudo, problema),
    };
  }

  const falloDeEnsayo = _ensayarHidratacion(datos);
  if (falloDeEnsayo !== null) {
    return {
      snapshot: null,
      estado: 'corrupto',
      motivo: falloDeEnsayo,
      preservadoEn: _apartarCorrupto(storage, crudo, falloDeEnsayo),
    };
  }

  return { snapshot: datos, estado: 'ok' };
}

/**
 * Resuelve el storage a usar. Permite inyectar uno en tests sin que el
 * módulo tenga una rama especial para ellos.
 */
export function resolverStorage(inyectado) {
  if (inyectado !== undefined) return inyectado;
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  throw new Error('[persistencia] no hay localStorage disponible y no se inyectó storage');
}
