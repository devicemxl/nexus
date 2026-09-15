/**
 * Región `panel-container`.
 *
 * Simétrica a `tabs-nav`: genera sus paneles del modelo, los monta y los
 * desmonta. La diferencia está en el panel, que carga su propio fragmento de
 * contenido — por eso añadir una pestaña es una entrada en el JSON y un
 * archivo, sin tocar nada de esto.
 */

import * as Chunklet from '../../../../src/chunklet.js';
import { listarPestanas, marcarFragmento } from '../../app/modelo.js';
import { traerTexto } from '../../../../exo/exo.js';

// Resuelto contra este MÓDULO, no contra el documento: el contenido
// pertenece a la pieza y viaja con ella. Es la línea que elimina la clase de
// fallo "funciona hasta que alguien mueve el archivo".
const CONTENIDO = new URL('./contenido/', import.meta.url);

function panelContainer(contenedor, ctx) {
  const claves = listarPestanas(ctx.nebula);

  contenedor.innerHTML = claves.map((clave) => `
    <section class="tab-panel" data-tab-panel="${clave}"
             data-entity="tab:${clave}" data-chunk="tab-panel">
      <div data-zona="contenido"></div>
    </section>`).join('');

  // Los hijos, no el contenedor: ver la nota en `tabs-nav.js`.
  for (const panel of [...contenedor.children]) Chunklet.mount(panel);

  ctx.cleanup(() => {
    for (const panel of [...contenedor.children]) Chunklet.unmount(panel);
    contenedor.textContent = '';
  });
}

function tabPanel(panel, ctx) {
  const clave = panel.dataset.tabPanel;
  const ranura = panel.querySelector('[data-zona="contenido"]');

  // El fetch puede resolver después de que el panel se desmonte: escribir
  // entonces sería tocar un elemento ya retirado. Para hacerlo perezoso
  // —cargar en la primera activación— este bloque se mueve dentro del
  // listener de visibilidad, con una guarda de "ya cargado".
  let vivo = true;
  ctx.cleanup(() => { vivo = false; });

  marcarFragmento(ctx, clave, 'cargando');

  traerTexto(new URL(`tab_${clave}.html`, CONTENIDO))
    .then((html) => {
      if (!vivo) return;
      ranura.innerHTML = html;          // el fragmento no trae chunklets vivos
      marcarFragmento(ctx, clave, 'listo');
    })
    .catch((error) => {
      if (!vivo) return;
      ranura.innerHTML = `<span class="fallo">✗ ${error.message}</span>`;
      marcarFragmento(ctx, clave, 'error');
    });

  ctx.subscribeSelector(
    (estado) => estado.route.tab,
    (activa) => panel.classList.toggle('is-active', activa === clave),
    { immediate: true }
  );
}

export function definir() {
  Chunklet.define('panel-container', panelContainer);
  Chunklet.define('tab-panel', tabPanel);
}
