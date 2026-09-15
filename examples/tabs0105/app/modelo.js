/**
 * Modelo de la aplicación.
 *
 * Todo lo que se deriva de nebula vive aquí, y ninguna región lo repite.
 * Es el mismo reparto que en el chat: escritura contra nebula, lectura
 * derivada, y los widgets sin mezclar los dos lados.
 */

/**
 * Las pestañas, en orden.
 *
 * El orden sale de la propiedad `orden`, nunca del orden de claves del JSON
 * ni del identificador: ambos son comodidades del formato, no garantías.
 */
export function listarPestanas(nebula) {
  return nebula.allIds()
    .filter((id) => id.startsWith('tab:'))
    .map((id) => nebula.get(id).properties)
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
    .map((props) => props.tab);
}

/**
 * Etiqueta visible de una pestaña.
 *
 * Deriva de la clave mientras no haya nada mejor. Si el texto tiene que
 * diferir del identificador, se añade `etiqueta` al JSON y esta función la
 * prefiere — el cambio queda en un sitio.
 */
export function etiquetaDe(nebula, clave) {
  const props = nebula.get(`tab:${clave}`)?.properties || {};
  return props.etiqueta || clave[0].toUpperCase() + clave.slice(1);
}

/**
 * Estado de carga de un fragmento, en `net.*`.
 *
 * El Nexus Contract §5.1 reserva ese espacio para estados de petición. El
 * `spread` manual es correcto pero olvidarlo borra el resto del espacio en
 * silencio, así que se escribe en un solo sitio.
 */
export function marcarFragmento(ctx, clave, estado) {
  const net = ctx.getState().net;
  ctx.setState({
    net: { ...net, fragmentos: { ...net.fragmentos, [clave]: estado } },
  });
}

/** Predicado: ¿resolvieron todos los fragmentos, bien o mal? */
export function fragmentosResueltos(estado, claves) {
  const net = estado.net.fragmentos || {};
  return claves.every((c) => net[c] === 'listo' || net[c] === 'error');
}
