/**
 * Región `tabs-nav`.
 *
 * Registra dos behaviors: el suyo y el de las filas que crea. Son un par
 * indivisible —el botón sólo existe dentro de esta nav— así que viajan en el
 * mismo módulo. `index.html` no conoce ninguno de los dos nombres.
 *
 * La nav es dueña del DOM que crea: lo genera, lo monta y lo desmonta. Es la
 * misma disciplina que `lista-de-entidades.js` en el chat, sin la
 * reconciliación: aquí la lista de pestañas no cambia en vida de la página.
 * El día que cambie, esto es lo que hay que sustituir.
 */

import * as Chunklet from '../../../../src/chunklet.js';
import { listarPestanas, etiquetaDe } from '../modelo.js';

function tabsNav(nav, ctx) {
  const claves = listarPestanas(ctx.nebula);

  nav.innerHTML = claves.map((clave) => `
    <button class="tab-button" data-tab-key="${clave}"
            data-entity="tab:${clave}" data-chunk="tab-button"></button>`).join('');

  // Montaje síncrono y explícito, en vez de dejarlo al observador. La nav
  // sabe exactamente cuándo aparece cada botón; un MutationObserver lo
  // averiguaría una microtarea más tarde y sin poder ordenarlo.
  //
  // Se montan los hijos, no `nav`: `mount(nav)` incluiría a la propia nav en
  // el barrido, y esta función todavía no ha retornado. Montar hacia abajo
  // evita depender de cuándo Chunklet anota el montaje en curso.
  for (const boton of [...nav.children]) Chunklet.mount(boton);

  // Los botones son chunklets que esta región montó a mano, así que esta
  // región los desmonta a mano.
  ctx.cleanup(() => {
    for (const boton of [...nav.children]) Chunklet.unmount(boton);
    nav.textContent = '';
  });
}

function tabButton(boton, ctx) {
  const clave = boton.dataset.tabKey;
  boton.textContent = etiquetaDe(ctx.nebula, clave);

  ctx.subscribeSelector(
    (estado) => estado.route.tab,
    (activa) => boton.classList.toggle('is-active', activa === clave),
    { immediate: true }
  );

  ctx.listen(boton, 'click', () => ctx.navigate({ view: 'tabs', tab: clave }));
}

/** Registro. Se llama después de `Chunklet.setup`, que `define` exige. */
export function definir() {
  Chunklet.define('tabs-nav', tabsNav);
  Chunklet.define('tab-button', tabButton);
}
