/**
 * Control de calidad previo de la Escena 1.2.
 *
 * Ejercita el modelo y los dos widgets sobre un DOM real proporcionado por
 * linkedom. El harness canónico sigue siendo `conversaciones.test.html` en
 * navegador; esto sólo evita entregar código cuyas aserciones estén mal
 * escritas o cuyos widgets no monten.
 *
 *   node validar-modelo.mjs
 */
import { parseHTML } from '/home/claude/node_modules/linkedom/esm/index.js';

// ------------------------------------------------------------------
// DOM global antes de importar nada que lo toque
// ------------------------------------------------------------------
const { window: w, document: d } = parseHTML('<!DOCTYPE html><html><body></body></html>');
globalThis.window = w;
globalThis.document = d;
globalThis.Element = w.Element;
globalThis.Node = w.Node;
globalThis.MutationObserver = w.MutationObserver || class {
  observe() {} disconnect() {} takeRecords() { return []; }
};
w.location = { href: 'http://local/', hash: '', pathname: '/', search: '', origin: 'http://local' };
if (!w.addEventListener) w.addEventListener = () => {};
if (!w.removeEventListener) w.removeEventListener = () => {};

const { generarId, tipoDe, esDeTipo } = await import('../app/ids.js');
const modelo = await import('../app/modelo.js');
const { crearPrimitivas, arrancarDatos, montarInterfaz } = await import('../app/boot.js');
const Chunklet = (await import('../../../src/chunklet.js')).default;

// ------------------------------------------------------------------
let pass = 0, fail = 0;
function eq(etiqueta, actual, esperado) {
  const a = JSON.stringify(actual), e = JSON.stringify(esperado);
  if (a === e) { pass++; console.log(`  verde  ${etiqueta}`); }
  else { fail++; console.log(`  ROJO   ${etiqueta}\n         esperado ${e}\n         obtenido ${a}`); }
}
function ok(etiqueta, cond, detalle = '') {
  if (cond) { pass++; console.log(`  verde  ${etiqueta}`); }
  else { fail++; console.log(`  ROJO   ${etiqueta}${detalle ? ' — ' + detalle : ''}`); }
}
function lanza(etiqueta, fn) {
  try { fn(); fail++; console.log(`  ROJO   ${etiqueta} — no lanzó`); }
  catch { pass++; console.log(`  verde  ${etiqueta}`); }
}
function storageMock() {
  const datos = new Map();
  const m = {
    getItem: (k) => (datos.has(k) ? datos.get(k) : null),
    setItem: (k, v) => { m.escrituras++; datos.set(k, String(v)); },
    removeItem: (k) => datos.delete(k),
    escrituras: 0,
  };
  return m;
}

// ==================================================================
console.log('\n  Identificadores');
{
  const a = generarId('conversation');
  const b = generarId('conversation');
  ok('tienen el prefijo de tipo', a.startsWith('conversation:'), a);
  ok('dos llamadas seguidas no colisionan', a !== b, `${a} / ${b}`);
  eq('tipoDe recupera el prefijo', tipoDe(a), 'conversation');
  eq('esDeTipo discrimina', [esDeTipo(a, 'conversation'), esDeTipo(a, 'message')], [true, false]);
  lanza('un tipo con ":" es rechazado', () => generarId('a:b'));
  lanza('un tipo vacío es rechazado', () => generarId(''));

  const muchos = new Set();
  for (let i = 0; i < 5000; i++) muchos.add(generarId('x'));
  eq('5000 ids consecutivos son únicos', muchos.size, 5000);
}

console.log('\n  Modelo — escritura');
{
  const { nebula } = crearPrimitivas();
  const id = modelo.crearConversacion(nebula, { titulo: 'Primera' });
  const e = nebula.get(id);
  eq('la conversación existe tras crearla', e !== null, true);
  eq('conserva el título dado', e.properties.titulo, 'Primera');
  ok('registra creadaEn y actualizadaEn',
    typeof e.properties.creadaEn === 'number' && typeof e.properties.actualizadaEn === 'number');

  const sinTitulo = modelo.crearConversacion(nebula);
  ok('genera un título por defecto',
    nebula.get(sinTitulo).properties.titulo.startsWith('Conversación'),
    nebula.get(sinTitulo).properties.titulo);
}
{
  const { nebula } = crearPrimitivas();
  const id = modelo.crearConversacion(nebula, { titulo: 'Antes' });
  const creadaEn = nebula.get(id).properties.creadaEn;

  modelo.renombrarConversacion(nebula, id, 'Después');
  const e = nebula.get(id);
  eq('renombrar cambia el título', e.properties.titulo, 'Después');
  eq('renombrar NO borra creadaEn', e.properties.creadaEn, creadaEn);

  lanza('renombrar algo inexistente lanza',
    () => modelo.renombrarConversacion(nebula, 'conversation:fantasma', 'x'));
}
{
  const { nebula } = crearPrimitivas();
  const id = modelo.crearConversacion(nebula);
  modelo.eliminarConversacion(nebula, id);
  eq('eliminar quita la entidad', nebula.get(id), null);
  modelo.eliminarConversacion(nebula, id);
  eq('eliminar dos veces no lanza', nebula.allIds(), []);
}

console.log('\n  Modelo — derivación de la lista');
{
  const entities = {
    'conversation:a': { properties: { titulo: 'A', creadaEn: 1, actualizadaEn: 300 }, links: {} },
    'conversation:b': { properties: { titulo: 'B', creadaEn: 2, actualizadaEn: 100 }, links: {} },
    'conversation:c': { properties: { titulo: 'C', creadaEn: 3, actualizadaEn: 200 }, links: {} },
    'message:z':      { properties: { texto: 'no soy conversación' }, links: {} },
  };
  const lista = modelo.listarConversaciones(entities);
  eq('sólo incluye entidades de tipo conversation', lista.length, 3);
  eq('ordena por actualizadaEn descendente', lista.map((c) => c.id),
    ['conversation:a', 'conversation:c', 'conversation:b']);

  const empate = {
    'conversation:z': { properties: { titulo: 'Z', actualizadaEn: 5 }, links: {} },
    'conversation:a': { properties: { titulo: 'A', actualizadaEn: 5 }, links: {} },
  };
  eq('el empate se desempata por id, de forma estable',
    modelo.listarConversaciones(empate).map((c) => c.id),
    ['conversation:a', 'conversation:z']);

  eq('sin entities devuelve lista vacía', modelo.listarConversaciones(undefined), []);
  eq('una conversación sin título no rompe',
    modelo.listarConversaciones({ 'conversation:x': { properties: {}, links: {} } })[0].titulo,
    '(sin título)');
}

console.log('\n  Firma estable de la lista');
{
  const base = [{ id: 'c:1', titulo: 'A', creadaEn: 1, actualizadaEn: 9 }];
  ok('una lista es igual a sí misma', modelo.mismasConversaciones(base, base));
  ok('dos listas con mismos campos son iguales',
    modelo.mismasConversaciones(base, [{ id: 'c:1', titulo: 'A', creadaEn: 1, actualizadaEn: 9 }]));
  ok('un título distinto rompe la igualdad',
    !modelo.mismasConversaciones(base, [{ id: 'c:1', titulo: 'B', creadaEn: 1, actualizadaEn: 9 }]));
  ok('un id distinto rompe la igualdad',
    !modelo.mismasConversaciones(base, [{ id: 'c:2', titulo: 'A', creadaEn: 1, actualizadaEn: 9 }]));
  ok('distinta longitud rompe la igualdad', !modelo.mismasConversaciones(base, []));
  ok('creadaEn NO participa de la igualdad (no se pinta)',
    modelo.mismasConversaciones(base, [{ id: 'c:1', titulo: 'A', creadaEn: 999, actualizadaEn: 9 }]));
}

// ==================================================================
console.log('\n  Widgets sobre DOM');

const HTML = `
<div id="raiz" data-chunk="app-shell">
  <aside data-chunk="conversation-list">
    <button data-accion="nueva-conversacion">Nueva</button>
    <p data-zona="vacio">vacío</p>
    <ul data-zona="lista"></ul>
    <template data-plantilla="conversation-item">
      <li class="fila" data-chunk="conversation-item" aria-selected="false">
        <span data-zona="titulo"></span>
      </li>
    </template>
  </aside>
  <main>
    <h1 data-zona="titulo-activo">nada</h1>
    <div data-zona="hueco-mensajes" hidden></div>
  </main>
</div>`;

{
  document.body.innerHTML = HTML;
  const raiz = document.getElementById('raiz');

  const { nebula, pulsar } = crearPrimitivas();
  const storage = storageMock();
  const datos = arrancarDatos({ nebula, pulsar, storage, clave: 'nexus.test' });

  // Se usa la ruta real de arranque en vez de armar el stack a mano: así la
  // prueba ejercita lo mismo que index.html, incluido Voyajer.
  montarInterfaz({ nebula, pulsar, raiz, modoRuta: 'hash' });

  const lista = raiz.querySelector('[data-zona="lista"]');
  const vacio = raiz.querySelector('[data-zona="vacio"]');
  const boton = raiz.querySelector('[data-accion="nueva-conversacion"]');
  const tituloActivo = raiz.querySelector('[data-zona="titulo-activo"]');

  eq('arranca sin filas', lista.children.length, 0);
  eq('el aviso de lista vacía está visible', vacio.hidden, false);

  // --- crear por mutación directa del modelo ---
  const id1 = modelo.crearConversacion(nebula, { titulo: 'Uno' });
  eq('una conversación nueva pinta una fila', lista.children.length, 1);
  eq('la fila lleva el id del modelo', lista.children[0].dataset.entity, id1);
  eq('la fila muestra el título',
    lista.children[0].querySelector('[data-zona="titulo"]').textContent, 'Uno');
  eq('el aviso de vacío se oculta', vacio.hidden, true);

  const id2 = modelo.crearConversacion(nebula, { titulo: 'Dos' });
  eq('dos conversaciones pintan dos filas', lista.children.length, 2);
  eq('la más reciente va primero', lista.children[0].dataset.entity, id2);

  // --- selección ---
  lista.children[1].dispatchEvent(new w.Event('click', { bubbles: true }));
  eq('el click selecciona la conversación', pulsar.getState().ui.activeConversation, id1);
  eq('la fila seleccionada marca aria-selected',
    lista.children[1].getAttribute('aria-selected'), 'true');
  eq('la otra fila no queda seleccionada',
    lista.children[0].getAttribute('aria-selected'), 'false');
  eq('el área principal refleja la selección', tituloActivo.textContent, 'Uno');

  // --- el botón crea y selecciona ---
  boton.dispatchEvent(new w.Event('click', { bubbles: true }));
  eq('el botón añade una fila', lista.children.length, 3);
  const idNuevo = pulsar.getState().ui.activeConversation;
  ok('el botón selecciona la recién creada', idNuevo !== id1 && idNuevo !== id2, idNuevo);
  eq('la recién creada encabeza la lista', lista.children[0].dataset.entity, idNuevo);

  // --- renombrar repinta ---
  modelo.renombrarConversacion(nebula, id1, 'Uno renombrado');
  const fila1 = [...lista.children].find((f) => f.dataset.entity === id1);
  eq('renombrar repinta el título de la fila',
    fila1.querySelector('[data-zona="titulo"]').textContent, 'Uno renombrado');

  // La selección está en idNuevo desde que el botón la creó. Lo que se
  // comprueba es que un repintado total NO la pierde: la fila se destruye y
  // se recrea, y la nueva instancia recupera su estado de `ui` al montarse.
  // Esa es la razón por la que la selección no vive en el DOM.
  const filaActiva = [...lista.children].find((f) => f.dataset.entity === idNuevo);
  eq('la selección sobrevive a un repintado total',
    filaActiva.getAttribute('aria-selected'), 'true');
  eq('las filas no seleccionadas siguen sin marcar',
    fila1.getAttribute('aria-selected'), 'false');

  // --- eliminar ---
  modelo.eliminarConversacion(nebula, id2);
  eq('eliminar quita la fila', lista.children.length, 2);
  ok('la fila eliminada ya no está',
    ![...lista.children].some((f) => f.dataset.entity === id2));

  // --- la firma estable evita repintados ajenos ---
  let repintados = 0;
  const observador = new w.MutationObserver(() => { repintados++; });
  if (observador.observe) observador.observe(lista, { childList: true });

  nebula.put('message:1', { texto: 'un mensaje, no una conversación' });
  nebula.put('message:2', { texto: 'otro' });
  nebula.update('message:1', { texto: 'editado' });

  eq('mutar entidades ajenas no altera la lista', lista.children.length, 2);
  eq('las conversaciones siguen siendo las mismas',
    [...lista.children].map((f) => f.dataset.entity).sort(),
    [id1, idNuevo].sort());

  // --- teardown ---
  Chunklet.unmount(raiz);
  eq('desmontar vacía la lista', lista.children.length, 0);

  const antes = pulsar.getState().ui.activeConversation;
  modelo.crearConversacion(nebula, { titulo: 'Tras desmontar' });
  eq('tras desmontar, el DOM ya no reacciona', lista.children.length, 0);
  eq('tras desmontar, la selección no cambia sola',
    pulsar.getState().ui.activeConversation, antes);

  datos.destruir({ guardarPendiente: false });
}

console.log(`\n  === ${pass}/${pass + fail} verdes, ${fail} en rojo ===\n`);
process.exit(fail > 0 ? 1 : 0);
