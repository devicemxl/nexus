/**
 * Generación de identificadores de entidad.
 *
 * Escena 1.2 — Fase 1.
 *
 * Deliberadamente NO usa `crypto.randomUUID()`. Esa API exige un contexto
 * seguro, y los orígenes de los hosts objetivo no lo garantizan de forma
 * uniforme: en Wails sobre Windows el origen es `http://wails.localhost` y
 * localhost sí es confiable, pero `wails://wails` y `tauri://localhost` son
 * esquemas custom cuya condición de contexto seguro depende del motor. Un
 * arranque que falla al crear la primera conversación en una plataforma y no
 * en otra es el peor tipo de defecto: dependiente del entorno e invisible en
 * desarrollo.
 *
 * El formato tiene un prefijo temporal en base 36, de modo que los ids son
 * aproximadamente ordenables por antigüedad. Eso es una comodidad de
 * depuración, no una garantía: el orden de presentación se decide siempre
 * por propiedades explícitas, nunca por el id.
 */

/** Contador de desempate dentro del mismo milisegundo. */
let _secuencia = 0;

/**
 * @param {string} tipo - Prefijo semántico, p. ej. 'conversation' o 'message'.
 * @returns {string} identificador con forma `tipo:<marca><secuencia><azar>`
 */
export function generarId(tipo) {
  if (typeof tipo !== 'string' || tipo.trim() === '' || tipo.includes(':')) {
    throw new TypeError('[ids] tipo debe ser un string no vacío y sin ":"');
  }

  const marca = Date.now().toString(36);
  const orden = (_secuencia = (_secuencia + 1) % 1296).toString(36).padStart(2, '0');
  const azar = Math.floor(Math.random() * 1679616).toString(36).padStart(4, '0');

  return `${tipo}:${marca}${orden}${azar}`;
}

/**
 * Extrae el prefijo de tipo de un identificador.
 * @returns {string|null} el tipo, o null si el id no tiene la forma esperada.
 */
export function tipoDe(id) {
  if (typeof id !== 'string') return null;
  const corte = id.indexOf(':');
  return corte > 0 ? id.slice(0, corte) : null;
}

/** Predicado de conveniencia para filtrar por tipo. */
export function esDeTipo(id, tipo) {
  return tipoDe(id) === tipo;
}
