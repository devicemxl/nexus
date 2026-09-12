/**
 * Modelo de entidades del chat.
 *
 * Escena 1.2 — Fase 1.
 *
 * Este módulo concentra dos cosas que conviene no dispersar por los widgets:
 * las operaciones de dominio sobre nebula, y la derivación de la lista que
 * la interfaz consume desde la proyección de Pulsar.
 *
 * La separación importa porque son lados opuestos del Bridge:
 *
 *   escritura  ->  nebula  ->  [Bridge]  ->  Pulsar  ->  lectura
 *
 * Las funciones de escritura reciben `nebula` y mutan el modelo.
 * Las de lectura reciben el `entities` proyectado y no tocan nebula.
 * Ningún widget debería mezclar ambos lados.
 */

import { generarId, esDeTipo } from './ids.js';

/**
 * Reloj lógico monótono.
 *
 * `Date.now()` tiene resolución de milisegundo, y los motores de navegador la
 * engrosan todavía más como mitigación de Spectre. Dos conversaciones creadas
 * en la misma ráfaga reciben la misma marca, y entonces el orden de la lista
 * queda decidido por el desempate en vez de por la intención.
 *
 * Esto garantiza que cada llamada devuelve un valor estrictamente mayor que
 * el anterior dentro del proceso. Cuando el reloj real avanza, se le sigue;
 * cuando no, se adelanta un milisegundo. La deriva respecto al tiempo real
 * está acotada por el número de operaciones en un mismo milisegundo y nunca
 * es visible: el valor se usa para ordenar, y el título que se muestra al
 * usuario se formatea a minutos.
 */
let _ultimaMarca = 0;

export function ahora() {
  const real = Date.now();
  _ultimaMarca = real > _ultimaMarca ? real : _ultimaMarca + 1;
  return _ultimaMarca;
}

export const TIPO_CONVERSACION = 'conversation';

// ==================================================================
// Escritura — operaciones de dominio sobre nebula
// ==================================================================

/**
 * Crea una conversación nueva.
 *
 * Usa `put` y no `upsert` porque el id acaba de generarse: no puede existir,
 * y si existiera sería un defecto del generador que preferimos que se note
 * como sobreescritura visible antes que como fusión silenciosa.
 *
 * @returns {string} el id de la conversación creada.
 */
export function crearConversacion(nebula, { titulo } = {}) {
  const id = generarId(TIPO_CONVERSACION);
  const marca = ahora();

  nebula.put(id, {
    titulo: titulo || tituloPorDefecto(marca),
    creadaEn: marca,
    actualizadaEn: marca,
  });

  return id;
}

/**
 * Renombra una conversación existente.
 *
 * Usa `update` y no `put`: `put` reemplazaría las propiedades enteras y
 * borraría `creadaEn`. Y usa `update` y no `upsert` porque renombrar algo
 * que no existe es un error de la aplicación, no un caso a tolerar — que
 * lance es la conducta correcta (nebula Contract §4.1).
 */
export function renombrarConversacion(nebula, id, titulo) {
  nebula.update(id, { titulo, actualizadaEn: ahora() });
}

/**
 * Marca una conversación como tocada, para que suba en el orden.
 * Escena 1.3 la llamará al añadir mensajes.
 */
export function tocarConversacion(nebula, id) {
  nebula.update(id, { actualizadaEn: ahora() });
}

/**
 * Elimina una conversación.
 *
 * Guarda contra ausencia porque `delete` lanza si el id no existe, y borrar
 * algo ya borrado es idempotente desde el punto de vista de la interfaz.
 */
export function eliminarConversacion(nebula, id) {
  if (nebula.get(id)) nebula.delete(id);
}

function tituloPorDefecto(marca) {
  const f = new Date(marca);
  const dd = String(f.getDate()).padStart(2, '0');
  const mm = String(f.getMonth() + 1).padStart(2, '0');
  const hh = String(f.getHours()).padStart(2, '0');
  const mi = String(f.getMinutes()).padStart(2, '0');
  return `Conversación ${dd}/${mm} ${hh}:${mi}`;
}

// ==================================================================
// Lectura — derivación desde la proyección de Pulsar
// ==================================================================

/**
 * Deriva la lista de conversaciones desde el `entities` proyectado.
 *
 * Ordena por `actualizadaEn` descendente, con el id como desempate para que
 * el orden sea total y estable: dos conversaciones creadas en el mismo
 * milisegundo no deben intercambiar posiciones entre repintados.
 *
 * @param {object} entities - `pulsar.getState().entities`
 * @returns {Array<{id, titulo, creadaEn, actualizadaEn}>}
 */
export function listarConversaciones(entities) {
  if (!entities) return [];

  const lista = [];
  for (const id of Object.keys(entities)) {
    if (!esDeTipo(id, TIPO_CONVERSACION)) continue;
    const props = entities[id].properties || {};
    lista.push({
      id,
      titulo: props.titulo || '(sin título)',
      creadaEn: props.creadaEn || 0,
      actualizadaEn: props.actualizadaEn || 0,
    });
  }

  // El desempate va en la MISMA dirección que el criterio principal. Ordenar
  // por tiempo descendente y desempatar por id ascendente invertiría la lista
  // en cada empate, poniendo la más antigua primero — que es justo lo
  // contrario de lo que la lista promete.
  //
  // El id sirve aquí sólo como último recurso para que el orden sea total y
  // estable, no como criterio de presentación. Su prefijo temporal en base 36
  // hace que el descendente coincida con "la más reciente primero", y su
  // comparación es lexicográfica porque todas las marcas tienen la misma
  // longitud en base 36 hasta bien entrado el siglo.
  //
  // Con el reloj monótono de arriba los empates sólo aparecen en datos
  // hidratados desde almacenamiento; en ejecución normal no ocurren.
  lista.sort((a, b) => {
    if (b.actualizadaEn !== a.actualizadaEn) return b.actualizadaEn - a.actualizadaEn;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });

  return lista;
}

/**
 * Compara dos listas derivadas por los campos que la interfaz realmente
 * pinta. Es la `equality` del selector de `conversation-list`.
 *
 * Sin esto, el Bridge re-proyecta el grafo entero en cada mutación
 * (BRIDGE-REACTIVE, documentado en PHASE_0_DEFERRED) y la lista se
 * repintaría cada vez que cambia cualquier entidad — incluido cada token de
 * un mensaje en streaming, que es lo que llega en Escena 1.3.
 *
 * La comparación no evita recorrer las entidades: el selector ya lo hizo.
 * Evita el repintado del DOM, que es la parte cara. Esa distinción es la
 * medida honesta de lo que este mecanismo compra.
 */
export function mismasConversaciones(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
    if (a[i].titulo !== b[i].titulo) return false;
    if (a[i].actualizadaEn !== b[i].actualizadaEn) return false;
  }
  return true;
}