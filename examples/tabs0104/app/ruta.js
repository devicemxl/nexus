/**
 * Política de rutas.
 *
 * Las pestañas válidas salen del modelo, así que las opciones de Voyajer no
 * se pueden escribir antes de que el modelo esté cargado. Eso es lo que
 * obliga a `configure()` en vez de pasarlas a `setup()`.
 */

const PREFIJO = '/tab/';

export function opcionesVoyajer(claves) {
  return {
    mode: 'hash',

    parse(url) {
      const ruta = url.pathname || '/';
      if (ruta.startsWith(PREFIJO)) {
        const clave = decodeURIComponent(ruta.slice(PREFIJO.length));
        if (claves.includes(clave)) return { view: 'tabs', tab: clave };
      }
      if (ruta === '/' || ruta === '/tab') return { view: 'tabs', tab: claves[0] };
      return null;
    },

    serialize(estado) {
      return estado && estado.view === 'tabs' && claves.includes(estado.tab)
        ? PREFIJO + encodeURIComponent(estado.tab)
        : null;
    },
  };
}
