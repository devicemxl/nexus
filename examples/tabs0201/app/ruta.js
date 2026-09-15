/**
 * Política de rutas.
 *
 * Consulta el modelo por su cuenta. La alternativa —recibir las claves ya
 * derivadas— obligaba a `index.html` a conocer el modelo de pestañas sólo
 * para pasárselas, que es acoplamiento sin nada a cambio: este módulo ya es
 * el dueño del formato de URL, así que también lo es del conjunto de rutas
 * válidas.
 *
 * Las claves se derivan UNA vez, al construir las opciones. Vale mientras el
 * modelo no cambie después de hidratar, que es el caso hoy. Si algún día las
 * pestañas se añaden en caliente, `parse` y `serialize` tendrán que derivar
 * en cada llamada — es barato, pero hoy sería código sin caso.
 */

import { listarPestanas } from './modelo.js';

const PREFIJO = '/tab/';

export function opcionesVoyajer(nebula) {
  const claves = listarPestanas(nebula);

  // Sin pestañas no hay rutas que registrar. Lanzar aquí es más útil que
  // producir un router que nunca reconoce nada.
  if (claves.length === 0) {
    throw new Error('[ruta] el modelo no trae ninguna entidad "tab:*"');
  }

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
