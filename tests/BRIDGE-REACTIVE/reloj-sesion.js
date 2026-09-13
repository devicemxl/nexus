/**
 * Reloj de sesión — TESTIGO, no funcionalidad
 *
 * Fase 0 del plan de cierre de BRIDGE-REACTIVE.
 *
 * ANDAMIO TEMPORAL. Se retira de una pieza al cerrar la Fase 4, cuando la
 * propiedad viva en `nebula-pulsar-bridge.test.html`. No estilizar, no
 * ampliar, no heredar desde otro widget.
 *
 * Qué declara: el Bridge snapshot llama a `nebula.get` para las N entidades
 * en cada mutación, de modo que todas cambian de referencia aunque su
 * contenido no cambie. Un consumidor suscrito a `entities[X]` despierta ante
 * cualquier mutación del grafo.
 *
 * El widget está escrito DE LA FORMA OBVIA a propósito: suscrito a la
 * referencia de la entidad, no a una firma derivada de ella. El widget de
 * mensajes de la Escena 1.3 demuestra que la forma disciplinada funciona;
 * éste demuestra que la obvia no, y tras el arreglo demostrará que sí.
 *
 * DESVIACIÓN respecto al plan (§3.1): el plan tenía una segunda suscripción
 * a `ui.tick`. Aquí el avance del reloj usa `ctx.interval` y no pasa por
 * Pulsar. Un tick en el estado global es un `setState` por segundo que
 * despierta a todos los suscriptores globales — el testigo estaría
 * contaminando justamente lo que mide. Con `ctx.interval` el instrumento es
 * inerte respecto a Pulsar, y el modo medición se reduce a no arrancar el
 * intervalo.
 */

export const NOMBRE = 'reloj-sesion';

// ---------------------------------------------------------------------------
// Acoplamientos con la aplicación. Son los tres puntos a confirmar contra el
// modelo real antes de montar; si alguno no coincide, se cambia aquí y en
// ningún otro sitio.
// ---------------------------------------------------------------------------
export const RUTA_ACTIVA = 'ui.activeConversation';  // dónde vive el id activo
export const RUTA_ENTIDADES = 'entities';            // `path` del Bridge
export const PROP_INICIO = 'creadaEn';               // marca de creación

function _leerRuta(objeto, ruta) {
  let valor = objeto;
  for (const seg of ruta.split('.')) {
    if (valor === null || valor === undefined || typeof valor !== 'object') return undefined;
    valor = valor[seg];
  }
  return valor;
}

export function relojSesionFactory(element, ctx) {
  const salida = element.querySelector('[data-reloj]') || element;
  const enMedicion = element.dataset.modo === 'medicion';

  let inicio = null;

  const instrumento = {
    invocaciones: 0,   // veces que despertó la suscripción a la entidad
    repintados: 0,     // veces que el texto visible cambió de verdad
    modo: enMedicion ? 'medicion' : 'normal',
    reiniciar() { instrumento.invocaciones = 0; instrumento.repintados = 0; },
  };
  element.__instrumento = instrumento;
  ctx.cleanup(() => { delete element.__instrumento; });

  function pintar() {
    const segundos = inicio ? Math.floor((Date.now() - inicio) / 1000) : 0;
    const texto = String(segundos);
    if (salida.textContent !== texto) {
      salida.textContent = texto;
      instrumento.repintados++;
    }
  }

  // La suscripción que importa. Devuelve LA ENTIDAD, no un valor derivado:
  // un selector que devolviera los segundos no distinguiría a los dos
  // Bridges, porque Object.is(3, 3) es true y el listener no dispararía
  // nunca. Lo único que los separa es la referencia del objeto entidad.
  ctx.subscribeSelector(
    (estado) => {
      const activa = _leerRuta(estado, RUTA_ACTIVA);
      if (!activa) return null;
      const entidades = _leerRuta(estado, RUTA_ENTIDADES);
      return (entidades && entidades[activa]) || null;
    },
    (entidad) => {
      instrumento.invocaciones++;
      inicio = entidad?.properties?.[PROP_INICIO] ?? null;
      pintar();
    },
    { equality: Object.is, immediate: true }
  );

  // El reloj avanza por su cuenta. En modo medición no arranca, para no
  // ensuciar la ventana del test con repintados propios.
  if (!enMedicion) {
    ctx.interval(pintar, 1000);
  }

  return {
    destroy() {
      // Los recursos los libera el ctx. Aquí sólo queda dejar la salida
      // como estaba, para que un remontaje no herede el último valor.
      salida.textContent = '';
    },
  };
}

export default relojSesionFactory;
