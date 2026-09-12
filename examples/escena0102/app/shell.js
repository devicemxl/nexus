/**
 * Behavior `app-shell` — Escena 1.2.
 *
 * En 1.1 este behavior existía para probar el cableado. Aquí conserva ese
 * papel pero además refleja la conversación activa en el área principal, que
 * es el hueco que Escena 1.3 llenará con el widget de mensajes.
 *
 * No renderiza la lista: eso es `conversation-list`. Sólo lee `ui` y el
 * modelo proyectado para mostrar qué está seleccionado.
 */

export function appShell(elemento, ctx) {
  // Se exige sólo lo que este behavior usa. Voyajer es opcional por contrato
  // (Chunklet §10, "Voyajer opt-in") y este shell no navega: reclamarlo
  // rompería una configuración que el stack admite legítimamente. Escena 1.4
  // introduce la navegación y será ella quien lo requiera.
  const faltantes = [];
  if (!ctx.pulsar) faltantes.push('pulsar');
  if (!ctx.nebula) faltantes.push('nebula');

  if (faltantes.length > 0) {
    throw new Error(
      `[app-shell] el stack llegó incompleto, falta: ${faltantes.join(', ')}`
    );
  }

  const zonaTitulo = elemento.querySelector('[data-zona="titulo-activo"]');
  const zonaHueco = elemento.querySelector('[data-zona="hueco-mensajes"]');

  ctx.setState({
    ui: { ...ctx.getState().ui, shellMontado: true },
  });

  // Se suscribe al id activo y no al objeto de la conversación: el id es un
  // string, así que la igualdad por referencia de `Object.is` basta y no hace
  // falta `equality` propia. Leer el título desde `state` dentro del listener
  // evita que un cambio de título de OTRA conversación dispare este listener.
  ctx.subscribeSelector(
    (estado) => estado.ui?.activeConversation || null,
    (id, _previo, estado) => {
      if (!id) {
        if (zonaTitulo) zonaTitulo.textContent = 'Ninguna conversación seleccionada';
        if (zonaHueco) zonaHueco.hidden = true;
        return;
      }
      const entidad = estado.entities?.[id];
      if (zonaTitulo) {
        zonaTitulo.textContent = entidad?.properties?.titulo || '(sin título)';
      }
      if (zonaHueco) zonaHueco.hidden = false;
    },
    { immediate: true }
  );

  ctx.cleanup(() => {
    ctx.setState({ ui: { ...ctx.getState().ui, shellMontado: false } });
  });
}

export default appShell;
