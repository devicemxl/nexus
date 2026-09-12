/**
 * Control de calidad previo de la Escena 1.3.
 *
 * La aserción central: el streaming NO reconstruye la lista de mensajes. El
 * DOM resultante es idéntico se haya llegado a él reconstruyendo o escribiendo
 * un nodo, así que ninguna aserción sobre la salida lo detecta. Hay que contar
 * reconstrucciones — disciplina D-7.
 *
 *   node validar-mensajes.mjs
 */
import { parseHTML } from '/home/claude/node_modules/linkedom/esm/index.js';

const { window: w, document: d } = parseHTML('<!DOCTYPE html><html><body></body></html>');
globalThis.window = w; globalThis.document = d;
globalThis.Element = w.Element; globalThis.Node = w.Node;
globalThis.MutationObserver = w.MutationObserver || class { observe() {} disconnect() {} };
w.location = { href: 'http://local/', hash: '', pathname: '/', search: '', origin: 'http://local' };

const modelo = await import('../app/modelo.js');
const { crearPrimitivas, arrancarDatos, montarInterfaz } = await import('../app/boot.js');
const { crearMockProvider } = await import('../app/mock-provider.js');
const { conversationMessages } = await import('../app/conversation-messages.js');
const Chunklet = (await import('../../../src/chunklet.js')).default;

let pass = 0, fail = 0;
function eq(e, actual, esperado) {
  const a = JSON.stringify(actual), x = JSON.stringify(esperado);
  if (a === x) { pass++; console.log(`  verde  ${e}`); }
  else { fail++; console.log(`  ROJO   ${e}\n         esperado ${x}\n         obtenido ${a}`); }
}
function ok(e, cond, detalle = '') {
  if (cond) { pass++; console.log(`  verde  ${e}`); }
  else { fail++; console.log(`  ROJO   ${e}${detalle ? ' — ' + detalle : ''}`); }
}
function lanza(e, fn) {
  try { fn(); fail++; console.log(`  ROJO   ${e} — no lanzó`); }
  catch { pass++; console.log(`  verde  ${e}`); }
}
const stg = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

/** Planificador manual: permite avanzar el stream paso a paso. */
function planificador() {
  const cola = [];
  let seq = 0;
  return {
    programar: (fn) => { const h = ++seq; cola.push({ h, fn }); return h; },
    cancelar: (h) => { const i = cola.findIndex((x) => x.h === h); if (i >= 0) cola.splice(i, 1); },
    pendientes: () => cola.length,
    avanzar(n = 1) {
      for (let i = 0; i < n && cola.length; i++) cola.shift().fn();
    },
    agotar(max = 10000) {
      let v = 0;
      while (cola.length && v < max) { cola.shift().fn(); v++; }
      return v;
    },
  };
}

// ==================================================================
console.log('\n  Modelo — mensajes');
{
  const { nebula } = crearPrimitivas();
  const conv = modelo.crearConversacion(nebula, { titulo: 'C' });
  const m1 = modelo.agregarMensaje(nebula, conv, { rol: 'user', texto: 'hola' });

  ok('el mensaje existe', nebula.get(m1) !== null);
  eq('conserva rol y texto',
    [nebula.get(m1).properties.rol, nebula.get(m1).properties.texto], ['user', 'hola']);
  eq('nace completo por defecto', nebula.get(m1).properties.estado, modelo.ESTADO_COMPLETO);
  eq('queda enlazado desde la conversación',
    nebula.get(conv).links[modelo.RELACION_CONTIENE], [m1]);

  lanza('agregar a una conversación inexistente lanza',
    () => modelo.agregarMensaje(nebula, 'conversation:fantasma', { rol: 'user' }));
  lanza('un rol inválido lanza',
    () => modelo.agregarMensaje(nebula, conv, { rol: 'sistema' }));
}
{
  const { nebula } = crearPrimitivas();
  const conv = modelo.crearConversacion(nebula, { titulo: 'C' });
  const antes = nebula.get(conv).properties.actualizadaEn;
  const m = modelo.agregarMensaje(nebula, conv, { rol: 'user', texto: 'x' });
  ok('agregar un mensaje sube la conversación en la lista',
    nebula.get(conv).properties.actualizadaEn > antes);

  const trasCrear = nebula.get(conv).properties.actualizadaEn;
  modelo.anexarTexto(nebula, m, ' más');
  eq('anexar texto NO vuelve a tocar la conversación',
    nebula.get(conv).properties.actualizadaEn, trasCrear);
  eq('anexar concatena', nebula.get(m).properties.texto, 'x más');
}
{
  const { nebula } = crearPrimitivas();
  const conv = modelo.crearConversacion(nebula);
  const ids = [];
  for (let i = 0; i < 5; i++) {
    ids.push(modelo.agregarMensaje(nebula, conv, { rol: i % 2 ? 'assistant' : 'user', texto: `m${i}` }));
  }
  const entities = {};
  for (const id of nebula.allIds()) entities[id] = nebula.get(id);

  eq('los mensajes se listan del más antiguo al más reciente',
    modelo.listarMensajes(entities, conv).map((m) => m.id), ids);
  eq('sin conversación devuelve lista vacía', modelo.listarMensajes(entities, null), []);
  eq('una conversación inexistente devuelve lista vacía',
    modelo.listarMensajes(entities, 'conversation:fantasma'), []);

  // Un link huérfano no debe romper el render.
  const conEntidadFaltante = { ...entities };
  delete conEntidadFaltante[ids[2]];
  eq('un link huérfano se omite sin romper',
    modelo.listarMensajes(conEntidadFaltante, conv).length, 4);
}

console.log('\n  Firma estructural');
{
  const base = [
    { id: 'm:1', rol: 'user', texto: 'a', creadoEn: 1, estado: 'completo' },
    { id: 'm:2', rol: 'assistant', texto: 'b', creadoEn: 2, estado: 'en-vuelo' },
  ];
  const soloTextoDistinto = [
    { id: 'm:1', rol: 'user', texto: 'AAAA', creadoEn: 1, estado: 'completo' },
    { id: 'm:2', rol: 'assistant', texto: 'BBBB', creadoEn: 2, estado: 'en-vuelo' },
  ];
  ok('el texto NO participa de la firma: es lo que hace posible el streaming',
    modelo.mismaEstructuraDeMensajes(base, soloTextoDistinto));

  const estadoDistinto = base.map((m, i) => i === 1 ? { ...m, estado: 'completo' } : m);
  ok('el estado SÍ participa: cerrar el mensaje debe repintarlo',
    !modelo.mismaEstructuraDeMensajes(base, estadoDistinto));
  ok('añadir un mensaje rompe la firma',
    !modelo.mismaEstructuraDeMensajes(base, [...base, { id: 'm:3', rol: 'user', texto: '', creadoEn: 3, estado: 'completo' }]));
  ok('cambiar el rol rompe la firma',
    !modelo.mismaEstructuraDeMensajes(base, base.map((m, i) => i === 0 ? { ...m, rol: 'assistant' } : m)));

  eq('el mensaje en vuelo se identifica', modelo.mensajeEnVuelo(base).id, 'm:2');
  eq('sin mensajes en vuelo devuelve null',
    modelo.mensajeEnVuelo(base.map((m) => ({ ...m, estado: 'completo' }))), null);
}

console.log('\n  Mock provider');
{
  const { nebula } = crearPrimitivas();
  const conv = modelo.crearConversacion(nebula);
  const p = planificador();
  const provider = crearMockProvider({ nebula }, { programar: p.programar, cancelar: p.cancelar, respuestas: ['uno dos tres'] });

  const asa = provider.responder(conv);
  eq('nace en vuelo y vacío',
    [nebula.get(asa.mensajeId).properties.estado, nebula.get(asa.mensajeId).properties.texto],
    [modelo.ESTADO_EN_VUELO, '']);
  ok('el asa reporta actividad', asa.activo);

  p.avanzar(1);
  eq('el primer token llega', nebula.get(asa.mensajeId).properties.texto, 'uno');
  p.agotar();
  eq('al agotarse queda el texto completo',
    nebula.get(asa.mensajeId).properties.texto, 'uno dos tres');
  eq('y el estado pasa a completo',
    nebula.get(asa.mensajeId).properties.estado, modelo.ESTADO_COMPLETO);
  ok('el asa deja de reportar actividad', !asa.activo);
  eq('no quedan temporizadores pendientes', p.pendientes(), 0);
}
{
  const { nebula } = crearPrimitivas();
  const conv = modelo.crearConversacion(nebula);
  const p = planificador();
  const provider = crearMockProvider({ nebula }, { programar: p.programar, cancelar: p.cancelar, respuestas: ['uno dos tres cuatro cinco'] });

  const asa = provider.responder(conv);
  p.avanzar(3);
  const parcial = nebula.get(asa.mensajeId).properties.texto;
  asa.detener();

  eq('detener deja el mensaje interrumpido',
    nebula.get(asa.mensajeId).properties.estado, modelo.ESTADO_INTERRUMPIDO);
  eq('detener conserva lo ya recibido', nebula.get(asa.mensajeId).properties.texto, parcial);
  eq('detener libera el temporizador', p.pendientes(), 0);
  ok('el asa queda inactiva', !asa.activo);

  asa.detener();
  eq('detener dos veces no altera el estado',
    nebula.get(asa.mensajeId).properties.estado, modelo.ESTADO_INTERRUMPIDO);
}

// ==================================================================
console.log('\n  Widget sobre DOM');
{
  document.body.innerHTML = `
  <div id="raiz" data-chunk="app-shell">
    <aside data-chunk="conversation-list">
      <button data-accion="nueva-conversacion">Nueva</button>
      <p data-zona="vacio"></p>
      <ul data-zona="lista"></ul>
      <template data-plantilla="conversation-item">
        <li data-chunk="conversation-item" aria-selected="false"><span data-zona="titulo"></span></li>
      </template>
    </aside>
    <main data-chunk="conversation-messages">
      <h1 data-zona="titulo-activo"></h1>
      <p data-zona="sin-mensajes"></p>
      <div data-zona="mensajes"></div>
      <template data-plantilla="message-item">
        <article data-mensaje><div data-zona="texto"></div></article>
      </template>
    </main>
  </div>`;

  const raiz = document.getElementById('raiz');
  const { nebula, pulsar } = crearPrimitivas();
  const datos = arrancarDatos({ nebula, pulsar, storage: stg(), clave: 'nexus.test' });

  // Envoltura de factory (Chunklet Contract §8) para capturar el asa del
  // widget sin que el código de producción tenga que exponerla.
  let asaWidget = null;
  const original = conversationMessages;
  Chunklet.define; // no-op: el registro ocurre dentro de montarInterfaz

  montarInterfaz({ nebula, pulsar, raiz, modoRuta: 'hash' });
  // Re-registro envuelto y remontaje sólo del main, para capturar el asa.
  const main = raiz.querySelector('[data-chunk="conversation-messages"]');
  Chunklet.unmount(main);
  Chunklet.define('conversation-messages', (el, ctx) => {
    asaWidget = original(el, ctx);
    return asaWidget;
  });
  Chunklet.mount(main);

  const zona = raiz.querySelector('[data-zona="mensajes"]');
  const sinMensajes = raiz.querySelector('[data-zona="sin-mensajes"]');

  eq('sin conversación activa no hay mensajes', zona.children.length, 0);
  eq('el aviso de vacío está visible', sinMensajes.hidden, false);

  const conv = modelo.crearConversacion(nebula, { titulo: 'C' });
  pulsar.setState({ ui: { ...pulsar.getState().ui, activeConversation: conv } });
  eq('seleccionar una conversación vacía no pinta mensajes', zona.children.length, 0);

  const m1 = modelo.agregarMensaje(nebula, conv, { rol: 'user', texto: 'Hola' });
  eq('un mensaje se pinta', zona.children.length, 1);
  eq('el nodo lleva el id del modelo', zona.children[0].dataset.entity, m1);
  eq('el nodo lleva el rol', zona.children[0].dataset.rol, 'user');
  eq('el nodo muestra el texto',
    zona.children[0].querySelector('[data-zona="texto"]').textContent, 'Hola');
  eq('el aviso de vacío se oculta', sinMensajes.hidden, true);

  // --- LA ASERCIÓN CENTRAL DE LA ESCENA ---
  const p = planificador();
  const provider = crearMockProvider({ nebula }, {
    programar: p.programar, cancelar: p.cancelar,
    respuestas: ['uno dos tres cuatro cinco seis siete ocho nueve diez'],
  });

  const antesDeStream = asaWidget.reconstrucciones;
  const asa = provider.responder(conv);
  const trasAbrir = asaWidget.reconstrucciones;
  eq('abrir el mensaje reconstruye una vez', trasAbrir - antesDeStream, 1);

  const tokens = p.agotar() - 1;          // la última pasada cierra, no emite
  const trasStream = asaWidget.reconstrucciones;

  ok('el streaming emitió varios tokens', tokens >= 10, `tokens: ${tokens}`);
  eq('cerrar el mensaje reconstruye una sola vez más', trasStream - trasAbrir, 1);
  eq('hay dos mensajes: el del usuario y el del asistente', zona.children.length, 2);
  eq('el texto final está completo',
    zona.lastElementChild.querySelector('[data-zona="texto"]').textContent,
    'uno dos tres cuatro cinco seis siete ocho nueve diez');
  eq('el nodo refleja el estado final', zona.lastElementChild.dataset.estado, modelo.ESTADO_COMPLETO);

  // --- interrupción ---
  const antesInt = asaWidget.reconstrucciones;
  const asa2 = provider.responder(conv, { texto: 'a b c d e f g h' });
  p.avanzar(3);
  const parcial = zona.lastElementChild.querySelector('[data-zona="texto"]').textContent;
  asa2.detener();
  eq('interrumpir deja el texto parcial en pantalla',
    zona.lastElementChild.querySelector('[data-zona="texto"]').textContent, parcial);
  eq('el nodo refleja el estado interrumpido',
    zona.lastElementChild.dataset.estado, modelo.ESTADO_INTERRUMPIDO);
  eq('abrir y cerrar suman dos reconstrucciones',
    asaWidget.reconstrucciones - antesInt, 2);
  eq('interrumpir no deja temporizadores', p.pendientes(), 0);

  // --- cambio de conversación ---
  const conv2 = modelo.crearConversacion(nebula, { titulo: 'Otra' });
  pulsar.setState({ ui: { ...pulsar.getState().ui, activeConversation: conv2 } });
  eq('cambiar de conversación vacía la vista', zona.children.length, 0);
  pulsar.setState({ ui: { ...pulsar.getState().ui, activeConversation: conv } });
  ok('volver restaura los mensajes', zona.children.length > 0);

  // --- teardown ---
  Chunklet.unmount(main);
  eq('desmontar vacía la zona', zona.children.length, 0);
  const antesHuerfano = zona.children.length;
  modelo.agregarMensaje(nebula, conv, { rol: 'user', texto: 'tras desmontar' });
  eq('tras desmontar el DOM ya no reacciona', zona.children.length, antesHuerfano);

  datos.destruir({ guardarPendiente: false });
}

console.log(`\n  === ${pass}/${pass + fail} verdes, ${fail} en rojo ===\n`);
process.exit(fail > 0 ? 1 : 0);
