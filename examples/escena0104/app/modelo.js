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
export const TIPO_MENSAJE = 'message';

/**
 * Relación de pertenencia: `conversation --contiene--> message`.
 *
 * Esta dirección y no la inversa porque nebula no mantiene índice inverso
 * (nebula Contract §2.3): renderizar la conversación activa se resuelve
 * leyendo los links de UNA entidad, mientras que `message --perteneceA-->
 * conversation` obligaría a recorrer el grafo entero en cada repintado —
 * durante el streaming, una vez por token.
 */
export const RELACION_CONTIENE = 'contiene';

/** Estados posibles de un mensaje. */
export const ESTADO_COMPLETO = 'completo';
export const ESTADO_EN_VUELO = 'en-vuelo';
export const ESTADO_INTERRUMPIDO = 'interrumpido';

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

// ==================================================================
// Mensajes — escritura
// ==================================================================

/**
 * Añade un mensaje a una conversación y lo enlaza.
 *
 * El enlace establece la pertenencia; el orden lo decide `creadoEn`. El array
 * de links preserva el orden de inserción, pero eso es una consecuencia de la
 * implementación y no una garantía de la tabla de conductas del contrato:
 * apoyar la presentación en ello sería la misma clase de error que ordenar por
 * identificador.
 *
 * @returns {string} el id del mensaje creado.
 */
export function agregarMensaje(nebula, conversacionId, { rol, texto = '', estado } = {}) {
  if (!nebula.get(conversacionId)) {
    throw new Error(`[modelo] no existe la conversación ${conversacionId}`);
  }
  if (rol !== 'user' && rol !== 'assistant') {
    throw new TypeError(`[modelo] rol inválido: ${rol}`);
  }

  const id = generarId(TIPO_MENSAJE);
  const marca = ahora();

  nebula.put(id, {
    rol,
    texto,
    creadoEn: marca,
    estado: estado || ESTADO_COMPLETO,
  });
  nebula.link(conversacionId, RELACION_CONTIENE, id);

  // La conversación sube en la lista lateral. Es una escritura aparte y por
  // eso el widget de conversaciones se entera: su firma incluye
  // `actualizadaEn`.
  nebula.update(conversacionId, { actualizadaEn: marca });

  return id;
}

/**
 * Anexa un fragmento al texto de un mensaje en vuelo.
 *
 * Es la operación del streaming y la que más veces se ejecuta por segundo.
 * Toca una sola propiedad de una sola entidad a propósito: cualquier trabajo
 * adicional aquí se multiplica por el número de tokens.
 *
 * En particular NO actualiza `actualizadaEn` de la conversación. Hacerlo
 * cambiaría la firma de la lista lateral en cada token y la reconstruiría
 * entera — justo lo que la Escena 1.2 se ocupó de evitar. La conversación ya
 * subió al crearse el mensaje.
 */
export function anexarTexto(nebula, mensajeId, fragmento) {
  const actual = nebula.get(mensajeId);
  if (!actual) throw new Error(`[modelo] no existe el mensaje ${mensajeId}`);
  nebula.update(mensajeId, { texto: (actual.properties.texto || '') + fragmento });
}

/** Cierra un mensaje en vuelo, con el estado final que corresponda. */
export function finalizarMensaje(nebula, mensajeId, estado = ESTADO_COMPLETO) {
  nebula.update(mensajeId, { estado });
}

// ==================================================================
// Mensajes — lectura
// ==================================================================

/**
 * Deriva los mensajes de una conversación, en orden.
 *
 * Los links dan la pertenencia; `creadoEn` da el orden. El reloj monótono
 * garantiza que no haya empates dentro del proceso, y el desempate por id va
 * en la misma dirección que el criterio principal — aquí ascendente, porque
 * los mensajes se leen del más antiguo al más reciente.
 */
export function listarMensajes(entities, conversacionId) {
  if (!entities || !conversacionId) return [];
  const conversacion = entities[conversacionId];
  if (!conversacion) return [];

  const ids = (conversacion.links && conversacion.links[RELACION_CONTIENE]) || [];
  const lista = [];

  for (const id of ids) {
    const entrada = entities[id];
    if (!entrada) continue;               // link huérfano: se omite
    const props = entrada.properties || {};
    lista.push({
      id,
      rol: props.rol || 'assistant',
      texto: props.texto || '',
      creadoEn: props.creadoEn || 0,
      estado: props.estado || ESTADO_COMPLETO,
    });
  }

  lista.sort((a, b) => {
    if (a.creadoEn !== b.creadoEn) return a.creadoEn - b.creadoEn;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return lista;
}

/** El mensaje en vuelo de una lista ya derivada, si lo hay. */
export function mensajeEnVuelo(mensajes) {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    if (mensajes[i].estado === ESTADO_EN_VUELO) return mensajes[i];
  }
  return null;
}

/**
 * Firma ESTRUCTURAL de una lista de mensajes: qué mensajes hay, en qué orden,
 * de quién, y en qué estado.
 *
 * Deliberadamente **excluye `texto`**. Ésa es la decisión que hace posible el
 * streaming: si el texto participara, cada token cambiaría la firma y
 * reconstruiría la lista entera. El contenido del mensaje en vuelo lo atiende
 * una suscripción aparte que toca un solo nodo.
 *
 * `estado` sí participa, de modo que la transición en-vuelo → completo
 * dispara una reconstrucción y el mensaje queda pintado con su texto final.
 */
export function mismaEstructuraDeMensajes(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
    if (a[i].rol !== b[i].rol) return false;
    if (a[i].estado !== b[i].estado) return false;
    if (a[i].creadoEn !== b[i].creadoEn) return false;
  }
  return true;
}
