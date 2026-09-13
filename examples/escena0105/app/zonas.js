/**
 * Ayudas menores compartidas por los widgets — Escena 1.5.
 *
 * Son dos, y son pequeñas a propósito. El inventario de la escena mostró que
 * lo único que los cinco widgets comparten es esto: localizar zonas del DOM y
 * escribir en `ui.*`. Todo lo demás que se repetía era estructura de lista, y
 * eso vive en `lista-de-entidades.js`.
 *
 * Extraer más sería inventar vocabulario sin casos que lo pidan.
 */

/**
 * Localiza las zonas declaradas dentro de un elemento.
 *
 * Antes, cada widget repetía el `querySelector` y cada uno decidía por su
 * cuenta si ante una zona ausente avisaba, lanzaba o seguía. Aquí la decisión
 * es explícita y uniforme: lo obligatorio lanza con un mensaje que nombra al
 * widget y la zona; lo opcional queda en `null`.
 *
 * @param {Element} elemento
 * @param {object} declaracion - `{ nombreZona: true|false }`, donde `true`
 *   significa obligatoria.
 * @param {string} quien - Nombre del widget, sólo para el mensaje de error.
 * @returns {object} un objeto con las zonas encontradas, por nombre.
 *
 * @example
 *   const z = zonas(elemento, { mensajes: true, vacio: false }, 'mi-widget');
 *   z.mensajes.textContent = '';
 */
export function zonas(elemento, declaracion, quien = 'widget') {
  const encontradas = {};
  const faltan = [];

  for (const [nombre, obligatoria] of Object.entries(declaracion)) {
    const nodo = elemento.querySelector(`[data-zona="${nombre}"]`);
    encontradas[nombre] = nodo || null;
    if (!nodo && obligatoria) faltan.push(nombre);
  }

  if (faltan.length > 0) {
    throw new Error(
      `[${quien}] faltan zonas obligatorias: ${faltan.map((z) => `[data-zona="${z}"]`).join(', ')}`
    );
  }

  return encontradas;
}

/**
 * Localiza una plantilla declarada dentro de un elemento.
 *
 * Misma razón que `zonas`: la comprobación se repetía y la forma del error no.
 */
export function plantilla(elemento, nombre, quien = 'widget') {
  const nodo = elemento.querySelector(`template[data-plantilla="${nombre}"]`);
  if (!nodo) {
    throw new Error(`[${quien}] falta template[data-plantilla="${nombre}"]`);
  }
  return nodo;
}

/**
 * Escribe en el espacio `ui` conservando lo que ya había.
 *
 * El `spread` manual es correcto pero se escribía siete veces, y olvidarlo
 * borra el resto del espacio de nombres en silencio — el tipo de error que no
 * falla donde se comete.
 *
 * @param {object} ctx - Contexto de Chunklet, o cualquier objeto con
 *   `getState` y `setState`.
 * @param {object} parcial - Claves a fijar dentro de `ui`.
 */
export function fijarUi(ctx, parcial) {
  ctx.setState({ ui: { ...ctx.getState().ui, ...parcial } });
}
