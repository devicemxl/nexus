/**
 * Control de calidad previo: ejecuta bajo Node las aserciones de la capa de
 * datos del harness, que no dependen del DOM.
 *
 * El harness canónico es `boot.test.html` y es el que hay que correr para el
 * registro — incluye además el montaje de Chunklet, que requiere DOM real.
 * Esto sólo evita entregar un harness cuyas aserciones estén mal escritas.
 */
globalThis.document = { getElementById: () => null, body: {} };
globalThis.window = {
  location: { href: 'http://local/', hash: '', pathname: '/', search: '' },
  addEventListener() {}, removeEventListener() {},
};

const { crearPrimitivas, arrancarDatos } = await import('../app/boot.js');
const { PREFIJO_CORRUPTO } = await import('../app/persistencia.js');

let pass = 0, fail = 0;
function eq(etiqueta, actual, esperado) {
  const a = JSON.stringify(actual), e = JSON.stringify(esperado);
  if (a === e) { pass++; console.log(`  verde  ${etiqueta}`); }
  else {
    fail++;
    console.log(`  ROJO   ${etiqueta}\n         esperado ${e}\n         obtenido ${a}`);
  }
}
function ok(etiqueta, cond, detalle = '') {
  if (cond) { pass++; console.log(`  verde  ${etiqueta}`); }
  else { fail++; console.log(`  ROJO   ${etiqueta}${detalle ? ' — ' + detalle : ''}`); }
}
function callado(fn) {
  const w = console.warn; console.warn = () => {};
  try { return fn(); } finally { console.warn = w; }
}

function storageMock() {
  const datos = new Map();
  const m = {
    getItem: (k) => (datos.has(k) ? datos.get(k) : null),
    setItem: (k, v) => { m.escrituras++; datos.set(k, String(v)); },
    removeItem: (k) => datos.delete(k),
    claves: () => [...datos.keys()],
    escrituras: 0,
  };
  return m;
}
function snapshotDe(n) {
  const entities = {};
  for (let i = 0; i < n; i++) {
    entities[`node:${i}`] = {
      properties: { title: `Nodo ${i}`, orden: i },
      links: i < n - 1 ? { next: [`node:${i + 1}`] } : {},
    };
  }
  return { entities };
}
function arrancarContando(opciones = {}) {
  const { graphlet, pulsar } = crearPrimitivas();
  let setStateN = 0;
  const original = pulsar.setState.bind(pulsar);
  pulsar.setState = (p) => { setStateN++; return original(p); };
  const t0 = performance.now();
  const datos = arrancarDatos({ graphlet, pulsar, ...opciones });
  return { graphlet, pulsar, datos, setStateN, ms: performance.now() - t0 };
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('\n  Orden de arranque');
{
  const tamanos = [0, 10, 50, 200];
  const conteos = [];
  for (const n of tamanos) {
    const storage = storageMock();
    if (n > 0) storage.setItem('t', JSON.stringify(snapshotDe(n)));
    const r = arrancarContando({ storage, clave: 't' });
    conteos.push(r.setStateN);
    r.datos.destruir({ guardarPendiente: false });
  }
  ok('el conteo de setState no depende del tamaño del snapshot',
    conteos.every((c) => c === conteos[0]), `conteos: ${conteos.join(', ')}`);
  eq('el Bridge proyecta en una sola pasada', conteos[0], 1);
  console.log(`         (conteos observados: ${conteos.join(', ')})`);
}

console.log('\n  Hidratación');
{
  const storage = storageMock();
  const r = arrancarContando({ storage, clave: 't' });
  eq('sin snapshot previo, el modelo arranca vacío', r.pulsar.getState().entities, {});
  eq('estado de hidratación vacio', r.datos.hidratacion.estado, 'vacio');
  r.datos.destruir({ guardarPendiente: false });
}
{
  const storage = storageMock();
  storage.setItem('t', JSON.stringify(snapshotDe(3)));
  const r = arrancarContando({ storage, clave: 't' });
  const e = r.pulsar.getState().entities;
  eq('entidades proyectadas', Object.keys(e).sort(), ['node:0', 'node:1', 'node:2']);
  eq('propiedades sobreviven', e['node:1'].properties.title, 'Nodo 1');
  eq('links sobreviven', e['node:0'].links.next, ['node:1']);
  r.datos.destruir({ guardarPendiente: false });
}

console.log('\n  Snapshot ilegible');
{
  const storage = storageMock();
  storage.setItem('t', '{esto no es json');
  const r = callado(() => arrancarContando({ storage, clave: 't' }));
  eq('JSON inválido arranca vacío', r.pulsar.getState().entities, {});
  eq('se reporta corrupto', r.datos.hidratacion.estado, 'corrupto');
  ok('el blob queda preservado',
    storage.claves().some((k) => k.startsWith(PREFIJO_CORRUPTO)),
    storage.claves().join(', '));
  r.datos.destruir({ guardarPendiente: false });
}
{
  const storage = storageMock();
  storage.setItem('t', JSON.stringify({ cosas: [1, 2, 3] }));
  const r = callado(() => arrancarContando({ storage, clave: 't' }));
  eq('forma inesperada arranca vacío', r.pulsar.getState().entities, {});
  eq('forma inesperada es corrupta', r.datos.hidratacion.estado, 'corrupto');
  r.datos.destruir({ guardarPendiente: false });
}
{
  const storage = storageMock();
  storage.setItem('t', JSON.stringify({
    entities: { 'a:1': { properties: {}, links: { rel: 'no soy array' } } },
  }));
  const r = callado(() => arrancarContando({ storage, clave: 't' }));
  eq('links malformados detectados antes del grafo real', r.datos.hidratacion.estado, 'corrupto');
  eq('el grafo real queda intacto', r.graphlet.allIds(), []);
  r.datos.destruir({ guardarPendiente: false });
}
{
  const storage = storageMock();
  storage.setItem('t', JSON.stringify({
    entities: { 'a:1': { properties: { n: 1 }, links: { rel: ['fantasma:9'] } } },
  }));
  const r = callado(() => arrancarContando({ storage, clave: 't' }));
  eq('link huérfano no invalida el snapshot', r.datos.hidratacion.estado, 'ok');
  eq('la entidad se hidrata igualmente', r.graphlet.allIds(), ['a:1']);
  r.datos.destruir({ guardarPendiente: false });
}

console.log('\n  Persistencia');
{
  const storage = storageMock();
  storage.setItem('t', JSON.stringify(snapshotDe(3)));
  storage.escrituras = 0;
  const r = arrancarContando({ storage, clave: 't', debounceMs: 30 });
  eq('arrancar no reescribe lo recién leído', storage.escrituras, 0);
  r.datos.destruir({ guardarPendiente: false });
}
{
  const storage = storageMock();
  const r = arrancarContando({ storage, clave: 't', debounceMs: 30 });
  storage.escrituras = 0;
  r.graphlet.put('msg:1', { texto: 'hola' });
  r.graphlet.put('msg:2', { texto: 'qué tal' });
  r.graphlet.put('msg:3', { texto: 'bien' });
  eq('las mutaciones no escriben de inmediato', storage.escrituras, 0);
  await esperar(80);
  eq('la ráfaga se agrupa en una escritura', storage.escrituras, 1);
  const g = JSON.parse(storage.getItem('t'));
  eq('lo guardado tiene las tres', Object.keys(g.entities).sort(), ['msg:1', 'msg:2', 'msg:3']);
  r.datos.destruir({ guardarPendiente: false });
}
{
  const storage = storageMock();
  const r = arrancarContando({ storage, clave: 't', debounceMs: 5000 });
  r.graphlet.put('msg:1', { texto: 'pendiente' });
  storage.escrituras = 0;
  r.datos.destruir({ guardarPendiente: true });
  eq('destruir con guardado materializa lo pendiente', storage.escrituras, 1);
}
{
  const storage = storageMock();
  const r = arrancarContando({ storage, clave: 't', debounceMs: 30 });
  r.datos.destruir({ guardarPendiente: false });
  storage.escrituras = 0;
  const antes = JSON.stringify(r.pulsar.getState().entities);
  r.graphlet.put('msg:9', { texto: 'después' });
  await esperar(80);
  eq('tras destruir no se proyecta', JSON.stringify(r.pulsar.getState().entities), antes);
  eq('tras destruir no se persiste', storage.escrituras, 0);
  eq('el grafo sigue funcionando', r.graphlet.get('msg:9').properties.texto, 'después');
}

console.log(`\n  === ${pass}/${pass + fail} verdes, ${fail} en rojo ===\n`);
process.exit(fail > 0 ? 1 : 0);
