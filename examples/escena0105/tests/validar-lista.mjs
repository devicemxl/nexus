/**
 * Control de calidad previo de la Escena 1.5.
 *
 * La aserción central: la reconciliación hace el mínimo de operaciones de DOM.
 * El DOM resultante es idéntico se haya llegado a él recreando todo o moviendo
 * un nodo, así que hay que contar creaciones, destrucciones y movimientos —
 * disciplina D-7.
 *
 * Y la que de verdad cierra la deuda: el estado de DOM que no vive en el
 * modelo —el foco— sobrevive a cambios en otras entidades. Ésa era la
 * condición que convertía `RECONCILIACION-CON-CLAVE` de coste en defecto.
 *
 *   node validar-lista.mjs
 */
import { parseHTML } from '/home/claude/node_modules/linkedom/esm/index.js';

const { document: d } = parseHTML('<!DOCTYPE html><html><body></body></html>');
globalThis.document = d;
globalThis.Element = d.defaultView.Element;
globalThis.Node = d.defaultView.Node;
globalThis.Event = d.defaultView.Event;
globalThis.MutationObserver = d.defaultView.MutationObserver || class { observe() {} disconnect() {} };
globalThis.window = {
  location: { origin: 'http://local', href: 'http://local/', pathname: '/', search: '', hash: '' },
  history: { pushState() {}, replaceState() {}, back() {}, forward() {} },
  addEventListener() {}, removeEventListener() {},
};

const { createStatePulsar } = await import('../../../src/pulsar.js');
const { crearListaDeEntidades } = await import('../app/lista-de-entidades.js');
const { zonas, plantilla, fijarUi } = await import('../app/zonas.js');
const Chunklet = (await import('../../../src/chunklet.js')).default;

let pass = 0, fail = 0;
function eq(e, a, x) {
  const A = JSON.stringify(a), X = JSON.stringify(x);
  if (A === X) { pass++; console.log(`  verde  ${e}`); }
  else { fail++; console.log(`  ROJO   ${e}\n         esperado ${X}\n         obtenido ${A}`); }
}
function ok(e, c, det = '') {
  if (c) { pass++; console.log(`  verde  ${e}`); }
  else { fail++; console.log(`  ROJO   ${e}${det ? ' — ' + det : ''}`); }
}
function lanza(e, fn) {
  try { fn(); fail++; console.log(`  ROJO   ${e} — no lanzó`); }
  catch { pass++; console.log(`  verde  ${e}`); }
}

/** Contexto mínimo con la superficie que la factory usa. */
function contextoDe(pulsar) {
  const liberadores = [];
  return {
    ctx: {
      pulsar,
      getState: () => pulsar.getState(),
      setState: (p) => pulsar.setState(p),
      subscribeSelector: (sel, fn, o) => { liberadores.push(pulsar.subscribeSelector(sel, fn, o)); },
      listen: () => {},
      cleanup: (fn) => liberadores.push(fn),
    },
    liberar: () => { for (const f of liberadores.reverse()) f(); },
  };
}

const HTML = `
  <div id="w">
    <p data-zona="vacio">vacío</p>
    <ul data-zona="items"></ul>
    <template data-plantilla="fila">
      <li data-fila><span data-zona="titulo"></span><input data-zona="campo"></span></li>
    </template>
  </div>`;

function montar(entidadesIniciales = [], extra = {}) {
  document.body.innerHTML = HTML;
  const elemento = document.getElementById('w');
  const pulsar = createStatePulsar({ ui: {}, lista: entidadesIniciales });
  const { ctx, liberar } = contextoDe(pulsar);
  const lista = crearListaDeEntidades(elemento, ctx, {
    nombre: 'prueba',
    contenedor: 'items',
    plantilla: 'fila',
    vacio: 'vacio',
    raizDelClon: '[data-fila]',
    selector: (estado) => estado.lista || [],
    equality: (a, b) => a === b,
    atributos: (e) => ({ marca: e.marca }),
    zonas: { titulo: (e) => e.titulo },
    ...extra,
  });
  const contenedor = elemento.querySelector('[data-zona="items"]');
  const fijar = (arr) => pulsar.setState({ lista: arr });
  return { elemento, pulsar, lista, contenedor, fijar, liberar };
}
const ids = (c) => [...c.children].map((n) => n.dataset.entity);

// ==================================================================
console.log('\n  Ayudas menores');
{
  document.body.innerHTML = HTML;
  const el = document.getElementById('w');
  const z = zonas(el, { items: true, vacio: false, inexistente: false }, 'prueba');
  ok('localiza las zonas presentes', z.items !== null && z.vacio !== null);
  eq('una zona opcional ausente queda en null', z.inexistente, null);
  lanza('una zona obligatoria ausente lanza',
    () => zonas(el, { noEstoy: true }, 'prueba'));
  ok('el mensaje nombra al widget y la zona', (() => {
    try { zonas(el, { noEstoy: true }, 'mi-widget'); return false; }
    catch (e) { return e.message.includes('mi-widget') && e.message.includes('noEstoy'); }
  })());
  ok('localiza la plantilla', plantilla(el, 'fila', 'prueba') !== null);
  lanza('una plantilla ausente lanza', () => plantilla(el, 'noEstoy', 'prueba'));
}
{
  const pulsar = createStatePulsar({ ui: { a: 1, b: 2 }, otra: {} });
  const ctx = { getState: () => pulsar.getState(), setState: (p) => pulsar.setState(p) };
  fijarUi(ctx, { b: 3 });
  eq('fijarUi conserva lo que ya había en ui', pulsar.getState().ui, { a: 1, b: 3 });
  eq('y no toca otros espacios de nombres', pulsar.getState().otra, {});
}

console.log('\n  Pintado inicial');
{
  const { lista, contenedor, liberar } = montar([
    { id: 'a', titulo: 'Alfa' }, { id: 'b', titulo: 'Beta' },
  ]);
  eq('pinta un nodo por entidad', contenedor.children.length, 2);
  eq('en el orden de la lista', ids(contenedor), ['a', 'b']);
  eq('cada nodo lleva su identificador', contenedor.children[0].dataset.entity, 'a');
  eq('las zonas se rellenan',
    contenedor.children[1].querySelector('[data-zona="titulo"]').textContent, 'Beta');
  eq('el pintado inicial crea dos nodos', lista.cuenta.creados, 2);
  eq('y no destruye ninguno', lista.cuenta.destruidos, 0);
  liberar();
}
{
  const { contenedor, elemento, fijar, liberar } = montar([]);
  const vacio = elemento.querySelector('[data-zona="vacio"]');
  eq('con lista vacía no hay nodos', contenedor.children.length, 0);
  eq('el aviso de vacío está visible', vacio.hidden, false);
  fijar([{ id: 'a', titulo: 'A' }]);
  eq('al llegar una entidad el aviso se oculta', vacio.hidden, true);
  fijar([]);
  eq('al vaciarse vuelve a aparecer', vacio.hidden, false);
  liberar();
}

console.log('\n  Reconciliación — el mínimo de operaciones');
{
  const { lista, contenedor, fijar, liberar } = montar([
    { id: 'a', titulo: 'A' }, { id: 'b', titulo: 'B' }, { id: 'c', titulo: 'C' },
  ]);

  lista.reiniciarCuenta();
  fijar([{ id: 'a', titulo: 'A' }, { id: 'b', titulo: 'B' }, { id: 'c', titulo: 'C' },
         { id: 'd', titulo: 'D' }]);
  eq('añadir al final crea un nodo y no toca los demás',
    [lista.cuenta.creados, lista.cuenta.destruidos, lista.cuenta.movidos], [1, 0, 0]);
  eq('el nodo nuevo queda al final', ids(contenedor), ['a', 'b', 'c', 'd']);

  lista.reiniciarCuenta();
  fijar([{ id: 'z', titulo: 'Z' }, { id: 'a', titulo: 'A' }, { id: 'b', titulo: 'B' },
         { id: 'c', titulo: 'C' }, { id: 'd', titulo: 'D' }]);
  eq('insertar al principio crea uno y no mueve los existentes',
    [lista.cuenta.creados, lista.cuenta.destruidos, lista.cuenta.movidos], [1, 0, 0]);
  eq('queda en su posición', ids(contenedor), ['z', 'a', 'b', 'c', 'd']);

  lista.reiniciarCuenta();
  fijar([{ id: 'z', titulo: 'Z' }, { id: 'b', titulo: 'B' }, { id: 'd', titulo: 'D' }]);
  eq('eliminar destruye sólo los ausentes',
    [lista.cuenta.creados, lista.cuenta.destruidos], [0, 2]);
  eq('los supervivientes conservan su orden', ids(contenedor), ['z', 'b', 'd']);

  lista.reiniciarCuenta();
  fijar([{ id: 'd', titulo: 'D' }, { id: 'z', titulo: 'Z' }, { id: 'b', titulo: 'B' }]);
  eq('reordenar mueve sin crear ni destruir',
    [lista.cuenta.creados, lista.cuenta.destruidos], [0, 0]);
  ok('se mueve algún nodo', lista.cuenta.movidos > 0, `movidos: ${lista.cuenta.movidos}`);
  eq('el orden nuevo es el pedido', ids(contenedor), ['d', 'z', 'b']);

  lista.reiniciarCuenta();
  fijar([{ id: 'd', titulo: 'D renombrada' }, { id: 'z', titulo: 'Z' }, { id: 'b', titulo: 'B' }]);
  eq('cambiar una propiedad no crea, destruye ni mueve',
    [lista.cuenta.creados, lista.cuenta.destruidos, lista.cuenta.movidos], [0, 0, 0]);
  eq('la zona se actualiza',
    contenedor.children[0].querySelector('[data-zona="titulo"]').textContent, 'D renombrada');

  lista.reiniciarCuenta();
  fijar([{ id: 'd', titulo: 'D renombrada', marca: 'x' }, { id: 'z', titulo: 'Z' },
         { id: 'b', titulo: 'B' }]);
  eq('un atributo derivado se escribe', contenedor.children[0].dataset.marca, 'x');
  eq('sin recrear el nodo', lista.cuenta.creados, 0);

  liberar();
}

console.log('\n  Identidad de nodo — lo que cierra la deuda');
{
  const { lista, contenedor, fijar, liberar } = montar([
    { id: 'a', titulo: 'A' }, { id: 'b', titulo: 'B' },
  ]);

  const nodoA = lista.nodoDe('a');
  fijar([{ id: 'a', titulo: 'A' }, { id: 'b', titulo: 'B cambiada' }]);
  ok('el nodo de una entidad intacta es el MISMO objeto', lista.nodoDe('a') === nodoA);

  // El estado que vive en el DOM y no en el modelo: aquí, lo escrito en un
  // campo de texto. Si el nodo se recreara, se perdería. Ésa era la condición
  // de escalada anotada en la deuda.
  const campo = nodoA.querySelector('[data-zona="campo"]');
  campo.value = 'escrito por el usuario';

  fijar([{ id: 'a', titulo: 'A' }, { id: 'b', titulo: 'B otra vez' },
         { id: 'c', titulo: 'C nueva' }]);
  eq('el estado de DOM sobrevive a cambios en otras entidades',
    nodoA.querySelector('[data-zona="campo"]').value, 'escrito por el usuario');

  fijar([{ id: 'c', titulo: 'C nueva' }, { id: 'a', titulo: 'A' }]);
  eq('y sobrevive incluso a un reordenamiento',
    lista.nodoDe('a').querySelector('[data-zona="campo"]').value, 'escrito por el usuario');
  ok('porque sigue siendo el mismo nodo', lista.nodoDe('a') === nodoA);

  liberar();
}

console.log('\n  Chunklets anidados');
{
  document.body.innerHTML = `
    <div id="w">
      <ul data-zona="items"></ul>
      <template data-plantilla="fila">
        <li data-chunk="hijo"><span data-zona="titulo"></span></li>
      </template>
    </div>`;
  const elemento = document.getElementById('w');
  const pulsar = createStatePulsar({ ui: {}, lista: [] });
  const { ctx, liberar } = contextoDe(pulsar);

  let montados = 0, desmontados = 0;
  Chunklet.setup({ pulsar });
  Chunklet.define('hijo', (el, c) => {
    montados++;
    c.cleanup(() => { desmontados++; });
  });

  const lista = crearListaDeEntidades(elemento, ctx, {
    nombre: 'anidada',
    contenedor: 'items',
    plantilla: 'fila',
    raizDelClon: '[data-chunk]',
    selector: (estado) => estado.lista || [],
    equality: (a, b) => a === b,
    zonas: { titulo: (e) => e.titulo },
    montarAnidados: true,
  });
  const contenedor = elemento.querySelector('[data-zona="items"]');
  const fijar = (arr) => pulsar.setState({ lista: arr });

  fijar([{ id: 'a', titulo: 'A' }, { id: 'b', titulo: 'B' }]);
  eq('se monta un Chunklet por nodo creado', montados, 2);
  eq('y no se desmonta ninguno todavía', desmontados, 0);

  fijar([{ id: 'a', titulo: 'A cambiada' }, { id: 'b', titulo: 'B' }]);
  eq('actualizar no remonta los Chunklets', montados, 2);
  eq('ni los desmonta', desmontados, 0);

  fijar([{ id: 'b', titulo: 'B' }, { id: 'a', titulo: 'A cambiada' }]);
  eq('reordenar tampoco remonta', montados, 2);
  eq('ni desmonta', desmontados, 0);

  fijar([{ id: 'b', titulo: 'B' }]);
  eq('retirar una entidad desmonta exactamente su Chunklet', desmontados, 1);
  eq('y no monta ninguno nuevo', montados, 2);

  liberar();
  eq('liberar el widget desmonta lo que quedaba', desmontados, 2);
  eq('y vacía el contenedor', contenedor.children.length, 0);
}

console.log('\n  Ganchos');
{
  const orden = [];
  const { fijar, liberar } = montar([{ id: 'a', titulo: 'A' }], {
    antesDePintar: () => { orden.push('antes'); return 'testigo'; },
    despuesDePintar: (previo, lista) => { orden.push(`despues:${previo}:${lista.length}`); },
  });
  eq('los ganchos corren en orden y el previo se propaga',
    orden, ['antes', 'despues:testigo:1']);
  orden.length = 0;
  fijar([{ id: 'a', titulo: 'A' }, { id: 'b', titulo: 'B' }]);
  eq('y vuelven a correr en cada reconciliación',
    orden, ['antes', 'despues:testigo:2']);
  liberar();
}

console.log(`\n  === ${pass}/${pass + fail} verdes, ${fail} en rojo ===\n`);
process.exit(fail > 0 ? 1 : 0);
