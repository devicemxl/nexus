/**
 * exo — capa de composición sobre Nexus.
 *
 * Versión 0.1.0. Contrato y versión propios: exo no es una versión de Nexus.
 *
 * ALCANCE DE ESTA VERSIÓN
 *
 * Una sola capacidad: cargar piezas. Una pieza es un directorio con el markup
 * y el código que lo opera, y este módulo los trae y registra sus behaviors.
 *
 * Nada más entra aquí hasta que exista un segundo caso que lo pida. En
 * particular NO hay: listas, reconciliación, plantillas, ni primitivas de
 * interfaz.
 *
 * CLÁUSULAS
 *
 *   1. exo no importa Nexus. Este archivo no conoce Chunklet, Pulsar, nebula
 *      ni Voyajer — por eso se puede probar sin montar un stack, y por eso
 *      montar sigue siendo trabajo de la aplicación.
 *   2. Devuelve lo real: el módulo importado, para que la aplicación pueda
 *      hacer cualquier cosa que exo no contemple.
 *   3. Falsable por borrado: quitar exo deja una aplicación reescribible a
 *      mano con `import()` y `fetch`.
 *
 * DISPOSICIÓN DE UNA PIEZA
 *
 *     piezas/<nombre>/<nombre>.html    markup y CSS
 *     piezas/<nombre>/<nombre>.js      export `definir()`, opcional
 *
 * El HTML de una pieza puede traer `<style>` y nunca `<script>`: `innerHTML`
 * aplica los primeros y jamás ejecuta los segundos. No es una convención de
 * exo, es la plataforma — y es la razón de que la conducta venga del `.js`.
 */

export const VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// Recursos
// ---------------------------------------------------------------------------

async function traer(url) {
  const respuesta = await fetch(url);
  if (!respuesta.ok) {
    throw new Error(`${url}: ${respuesta.status} ${respuesta.statusText}`);
  }
  return respuesta;
}

export async function traerTexto(url) {
  return (await traer(url)).text();
}

export async function traerJson(url) {
  return (await traer(url)).json();
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

/**
 * Carga la pieza declarada por un anclaje y la inserta dentro.
 *
 * @param {Element} anclaje - Elemento con `data-pieza="<nombre>"`.
 * @param {object} [opciones]
 * @param {string} [opciones.base='./piezas'] - Directorio de las piezas,
 *   relativo al documento.
 * @returns {Promise<Module>} el módulo de la pieza, ya registrado.
 */
export async function cargarPieza(anclaje, { base = './piezas' } = {}) {
  const nombre = anclaje.dataset.pieza;
  if (!nombre) throw new Error('[exo] anclaje sin data-pieza');

  // Un anclaje con contenido significa recarga, y reemplazarlo dejaría
  // huérfanos los chunklets que hubiera dentro: su cleanup no correría.
  // Desmontar es trabajo de quien conoce el stack, así que exo no lo hace
  // a medias — lo declara fuera de alcance.
  if (anclaje.firstElementChild) {
    throw new Error(
      `[exo] el anclaje de "${nombre}" no está vacío; exo 0.1 no recarga piezas`
    );
  }

  // Ambas URL se resuelven contra el DOCUMENTO, no contra este módulo.
  // `import()` dentro de un módulo resuelve por defecto contra la URL del
  // módulo, que aquí sería el directorio de exo. Fijarlo es la mitad del
  // trabajo de esta función.
  const js = new URL(`${base}/${nombre}/${nombre}.js`, document.baseURI).href;
  const html = new URL(`${base}/${nombre}/${nombre}.html`, document.baseURI).href;

  let modulo, markup;
  try {
    [modulo, markup] = await Promise.all([import(js), traerTexto(html)]);
  } catch (error) {
    throw new Error(`[exo] la pieza "${nombre}" no cargó: ${error.message}`, { cause: error });
  }

  // El registro va antes de insertar: si la aplicación tiene un observador
  // activo, el markup puede montarse en cuanto aterriza.
  //
  // `definir` es opcional: una pieza puede ser sólo markup y CSS.
  if (typeof modulo.definir === 'function') modulo.definir();

  anclaje.innerHTML = markup;
  return modulo;
}

/**
 * Carga todas las piezas declaradas bajo una raíz, en paralelo.
 *
 * No monta nada: `Chunklet.mount` lo llama la aplicación cuando el árbol está
 * completo, que es una decisión suya y no de exo.
 */
export async function cargarPiezas(raiz = document.body, opciones = {}) {
  const anclajes = [...raiz.querySelectorAll('[data-pieza]')];
  return Promise.all(anclajes.map((a) => cargarPieza(a, opciones)));
}
