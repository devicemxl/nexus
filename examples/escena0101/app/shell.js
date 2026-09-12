/**
 * Behavior `app-shell` — Escena 1.1.
 *
 * El roadmap pide "sin behaviors aún", entendido como "sin behaviors de
 * chat". `app-shell` existe para probar que el cableado funciona, no para
 * simular funcionalidad. Su trabajo es tocar las tres patas del stack, dejar
 * evidencia observable de que llegaron, y demostrar que los recursos que
 * adquiere se liberan al destruirse.
 *
 * Nada de estructura de conversación, mensajes ni modelo de entidades. Eso
 * es Escena 1.2 en adelante.
 */

/**
 * @param {Element} elemento
 * @param {object} ctx - Contexto de Chunklet.
 */
export function appShell(elemento, ctx) {
  // ----------------------------------------------------------------
  // 1. Verificar que el stack llegó completo.
  //
  //    Un behavior normal no haría esto: daría por hecho que ctx trae lo
  //    que promete. Aquí es el propósito de la escena, así que el fallo
  //    tiene que ser ruidoso en vez de manifestarse como una pantalla en
  //    blanco sin explicación.
  // ----------------------------------------------------------------
  const faltantes = [];
  if (!ctx.pulsar) faltantes.push('pulsar');
  if (!ctx.graphlet) faltantes.push('graphlet');
  if (!ctx.voyajer) faltantes.push('voyajer');

  if (faltantes.length > 0) {
    throw new Error(
      `[app-shell] el stack llegó incompleto, falta: ${faltantes.join(', ')}`
    );
  }

  const zonaEstado = elemento.querySelector('[data-zona="estado"]');
  const zonaRuta = elemento.querySelector('[data-zona="ruta"]');
  const zonaEntidades = elemento.querySelector('[data-zona="entidades"]');

  // ----------------------------------------------------------------
  // 2. Escribir una marca en `ui.*`.
  //
  //    El namespace `ui` pertenece a la aplicación por el Nexus Contract
  //    §5.1. Es el único lugar donde este behavior puede escribir sin
  //    invadir territorio de otro productor: `entities` es del Bridge y
  //    `route` es de Voyajer.
  // ----------------------------------------------------------------
  ctx.setState({
    ui: { ...ctx.getState().ui, shellMontado: true, montadoEn: Date.now() },
  });

  // ----------------------------------------------------------------
  // 3. Suscripciones selectivas. Registradas vía ctx para que mueran con
  //    el elemento sin que este factory tenga que acordarse de nada.
  // ----------------------------------------------------------------
  ctx.subscribeSelector(
    'route.path',
    (ruta) => {
      if (zonaRuta) zonaRuta.textContent = ruta || '/';
    },
    { immediate: true }
  );

  ctx.subscribeSelector(
    (estado) => Object.keys(estado.entities || {}).length,
    (cuantas) => {
      if (zonaEntidades) {
        zonaEntidades.textContent = cuantas === 1
          ? '1 entidad hidratada'
          : `${cuantas} entidades hidratadas`;
      }
    },
    { immediate: true }
  );

  if (zonaEstado) {
    zonaEstado.textContent = 'stack montado';
    zonaEstado.dataset.listo = 'true';
  }

  // ----------------------------------------------------------------
  // 4. Cleanup explícito.
  //
  //    Las suscripciones de arriba ya se liberan solas — ese es el contrato
  //    de ctx. Éste existe para dejar rastro observable de que el teardown
  //    corrió, que es lo que verifica el harness.
  // ----------------------------------------------------------------
  ctx.cleanup(() => {
    if (zonaEstado) {
      zonaEstado.textContent = 'stack desmontado';
      delete zonaEstado.dataset.listo;
    }
    ctx.setState({
      ui: { ...ctx.getState().ui, shellMontado: false },
    });
  });
}

export default appShell;
