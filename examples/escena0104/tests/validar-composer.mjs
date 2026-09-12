/**
 * Control de calidad previo de la Escena 1.4.
 *
 * La aserción central: navegar por URL y seleccionar en la interfaz convergen
 * sin bucle y sin entradas de historial redundantes. Dependemos para ello de
 * la idempotencia de `push`, que el contrato de Voyajer declara como garantía;
 * una garantía de la que se depende se afirma, no se supone.
 *
 *   node validar-composer.mjs
 */
import { parseHTML } from '/home/claude/node_modules/linkedom/esm/index.js';

const { document: d } = parseHTML('<!DOCTYPE html><html><body></body></html>');
globalThis.document = d;
globalThis.Element = d.defaultView.Element;
globalThis.Node = d.defaultView.Node;
globalThis.Event = d.defaultView.Event;
globalThis.MutationObserver = d.defaultView.MutationObserver || class { observe() {} disconnect() {} };

/**
 * Ventana propia. linkedom no expone history ni permite sustituir sus
 * manejadores de eventos, y Voyajer necesita ambos. Se construye una mínima
 * con la superficie que el contrato de Voyajer declara usar: `window.location`,
 * `window.history` y los eventos `popstate` y `hashchange`.
 */
const historia = { entradas: ['/'], indice: 0, empujes: 0, reemplazos: 0 };
const oyentes = { hashchange: [], popstate: [] };

let _hash = '';

const w = {
  location: {
    origin: 'http://local', protocol: 'http:', host: 'local',
    href: 'http://local/', pathname: '/', search: '',

    // En modo hash, Voyajer navega asignando `location.hash`, no llamando a
    // pushState (Voyajer Contract §6). El navegador convierte esa asignación
    // en una entrada de historial, así que es aquí donde hay que contarla.
    //
    // El evento `hashchange` no se emite desde aquí: en el navegador llega
    // después, y para entonces Voyajer ya escribió el estado de forma síncrona
    // dentro de `push`. Emitirlo produciría la doble escritura que el contrato
    // describe como redundante pero inofensiva, y enturbiaría el conteo.
    get hash() { return _hash; },
    set hash(v) {
      const h = String(v).startsWith('#') ? String(v) : '#' + String(v);
      if (h === _hash) return;
      historia.empujes++;
      historia.entradas.push(h);
      historia.indice++;
      _hash = h;
      w.location.href = 'http://local/' + h;
    },

    replace(u) {
      historia.reemplazos++;
      fijarHash(String(u).slice(String(u).indexOf('#')));
    },
  },
  history: {
    pushState(_s, _t, u) { historia.empujes++; historia.entradas.push(u); historia.indice++; },
    replaceState(_s, _t, u) { historia.reemplazos++; historia.entradas[historia.indice] = u; },
    back() { if (historia.indice > 0) { historia.indice--; irA(historia.entradas[historia.indice]); } },
    forward() { if (historia.indice < historia.entradas.length - 1) { historia.indice++; irA(historia.entradas[historia.indice]); } },
  },
  addEventListener(tipo, fn) { if (oyentes[tipo]) oyentes[tipo].push(fn); },
  removeEventListener(tipo, fn) {
    if (!oyentes[tipo]) return;
    const i = oyentes[tipo].indexOf(fn); if (i >= 0) oyentes[tipo].splice(i, 1);
  },
  Event: globalThis.Event,
};
globalThis.window = w;

/** Fija el hash SIN contarlo como navegación: simula el estado de partida. */
function fijarHash(h) {
  _hash = h ? (String(h).startsWith('#') ? String(h) : '#' + String(h)) : '';
  w.location.href = 'http://local/' + _hash;
}

/** Simula que el usuario cambia la URL: fija el hash y emite el evento. */
function irA(url) {
  const h = String(url).startsWith('#') ? String(url) : '#' + String(url);
  fijarHash(h);
  for (const fn of [...oyentes.hashchange]) fn({ type: 'hashchange' });
}

const modelo = await import('../app/modelo.js');
const ruta = await import('../app/ruta-adapter.js');
const { crearPrimitivas, arrancarDatos, montarInterfaz } = await import('../app/boot.js');
const { crearMockProvider } = await import('../app/mock-provider.js');
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
function callado(fn) { const v = console.warn; console.warn = () => {}; try { return fn(); } finally { console.warn = v; } }
const stg = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
function planificador() {
  const cola = []; let seq = 0;
  return {
    programar: (fn) => { const h = ++seq; cola.push({ h, fn }); return h; },
    cancelar: (h) => { const i = cola.findIndex((x) => x.h === h); if (i >= 0) cola.splice(i, 1); },
    pendientes: () => cola.length,
    avanzar(n = 1) { for (let i = 0; i < n && cola.length; i++) cola.shift().fn(); },
    agotar(max = 9999) { let v = 0; while (cola.length && v < max) { cola.shift().fn(); v++; } return v; },
  };
}

// ==================================================================
console.log('\n  Formato de URL');
{
  eq('una ruta de conversación se reconoce',
    ruta.parse({ pathname: '/c/abc' }), { vista: 'conversacion', conversacionId: 'conversation:abc' });
  eq('la raíz es la vista de inicio', ruta.parse({ pathname: '/' }), { vista: 'inicio' });
  eq('una ruta desconocida cae a inicio', ruta.parse({ pathname: '/otra/cosa' }), { vista: 'inicio' });
  eq('un slug vacío cae a inicio', ruta.parse({ pathname: '/c/' }), { vista: 'inicio' });

  eq('serializar retira el prefijo de tipo',
    ruta.serialize({ vista: 'conversacion', conversacionId: 'conversation:abc' }), '/c/abc');
  eq('inicio serializa a la raíz', ruta.serialize({ vista: 'inicio' }), '/');
  eq('un estado sin id serializa a la raíz',
    ruta.serialize({ vista: 'conversacion' }), '/');

  eq('ida y vuelta conserva la ruta',
    ruta.serialize(ruta.parse({ pathname: '/c/mt1a2b3c' })), '/c/mt1a2b3c');
  const id = 'conversation:mt1a2b3c';
  eq('ida y vuelta conserva el identificador',
    ruta.parse({ pathname: ruta.serialize({ vista: 'conversacion', conversacionId: id }) }).conversacionId, id);
}

console.log('\n  Puente entre ruta e interfaz');
{
  const { nebula, pulsar } = crearPrimitivas();
  const datos = arrancarDatos({ nebula, pulsar, storage: stg(), clave: 't' });
  const conv = modelo.crearConversacion(nebula, { titulo: 'Una' });

  historia.empujes = 0;
  pulsar.setState({ ui: { ...pulsar.getState().ui, activeConversation: conv } });
  eq('seleccionar empuja una entrada de historial', historia.empujes, 1);
  ok('la URL refleja la conversación',
    w.location.hash.includes(conv.split(':')[1]), w.location.hash);

  // --- idempotencia: reseleccionar lo mismo no navega ---
  const antes = historia.empujes;
  pulsar.setState({ ui: { ...pulsar.getState().ui, activeConversation: conv } });
  eq('reseleccionar lo mismo no empuja historial', historia.empujes - antes, 0);

  datos.destruir({ guardarPendiente: false });
}
{
  // --- URL -> interfaz ---
  const { nebula, pulsar } = crearPrimitivas();
  const conv = modelo.crearConversacion(nebula, { titulo: 'Destino' });
  const slug = conv.split(':')[1];
  fijarHash('#/c/' + slug);

  const datos = arrancarDatos({ nebula, pulsar, storage: stg(), clave: 't' });
  eq('arrancar con una URL de conversación la selecciona',
    pulsar.getState().ui.activeConversation, conv);
  datos.destruir({ guardarPendiente: false });
}
{
  // --- deep link a algo inexistente ---
  const { nebula, pulsar } = crearPrimitivas();
  fijarHash('#/c/noexiste');
  const datos = callado(() => arrancarDatos({ nebula, pulsar, storage: stg(), clave: 't' }));
  eq('una URL a una conversación inexistente no selecciona nada',
    pulsar.getState().ui.activeConversation || null, null);
  eq('y no la crea', nebula.allIds(), []);
  datos.destruir({ guardarPendiente: false });
  fijarHash('');
}
{
  // --- LA ASERCIÓN CENTRAL: convergencia sin bucle ---
  const { nebula, pulsar } = crearPrimitivas();
  const datos = arrancarDatos({ nebula, pulsar, storage: stg(), clave: 't' });
  const a = modelo.crearConversacion(nebula, { titulo: 'A' });
  const b = modelo.crearConversacion(nebula, { titulo: 'B' });

  let notificaciones = 0;
  pulsar.subscribe(() => { notificaciones++; });

  historia.empujes = 0;
  notificaciones = 0;
  irA('#/c/' + a.split(':')[1]);

  eq('navegar por URL selecciona la conversación', pulsar.getState().ui.activeConversation, a);
  eq('navegar por URL no genera entradas de historial adicionales', historia.empujes, 0);
  ok('el circuito converge en pocas notificaciones',
    notificaciones <= 3, `notificaciones: ${notificaciones}`);

  historia.empujes = 0;
  let setStates = 0;
  const origSetState = pulsar.setState.bind(pulsar);
  pulsar.setState = (parcial) => { setStates++; return origSetState(parcial); };

  setStates = 0;
  pulsar.setState({ ui: { ...pulsar.getState().ui, activeConversation: b } });
  eq('seleccionar en la interfaz sí empuja historial', historia.empujes, 1);

  // Fija la economía de la guarda del adapter: sin ella serían 3. No es lo que
  // corta el bucle —eso lo hacen la idempotencia de push y la equality del
  // selector— pero ahorra un setState redundante por selección, y una línea
  // cuyo efecto no se mide es una línea que alguien borrará.
  eq('una selección cuesta dos setState, no tres', setStates, 2);

  setStates = 0;
  irA('#/c/' + a.split(':')[1]);
  eq('una navegación por URL cuesta dos setState', setStates, 2);
  pulsar.setState = origSetState;

  eq('alternar por URL vuelve a converger', pulsar.getState().ui.activeConversation, a);

  datos.destruir({ guardarPendiente: false });
  fijarHash('');
}

// ==================================================================
console.log('\n  Composer');
{
  document.body.innerHTML = `
  <div id="raiz" data-chunk="app-shell">
    <aside data-chunk="conversation-list">
      <button data-accion="nueva-conversacion"></button>
      <p data-zona="vacio"></p><ul data-zona="lista"></ul>
      <template data-plantilla="conversation-item">
        <li data-chunk="conversation-item" aria-selected="false"><span data-zona="titulo"></span></li>
      </template>
    </aside>
    <main data-chunk="conversation-messages">
      <h1 data-zona="titulo-activo"></h1>
      <div data-zona="mensajes-scroll"><p data-zona="sin-mensajes"></p><div data-zona="mensajes"></div></div>
      <template data-plantilla="message-item">
        <article data-mensaje><div data-zona="quien"></div><div data-zona="texto"></div></article>
      </template>
      <form data-chunk="composer">
        <textarea data-zona="entrada"></textarea>
        <button type="button" data-accion="enviar">Enviar</button>
      </form>
    </main>
  </div>`;

  const raiz = document.getElementById('raiz');
  const { nebula, pulsar } = crearPrimitivas();
  const datos = arrancarDatos({ nebula, pulsar, storage: stg(), clave: 'nexus.test' });
  const p = planificador();
  const provider = crearMockProvider({ nebula }, {
    programar: p.programar, cancelar: p.cancelar, respuestas: ['uno dos tres cuatro cinco'],
  });

  montarInterfaz({ nebula, pulsar, voyajer: datos.voyajer, provider, raiz });

  const entrada = raiz.querySelector('[data-zona="entrada"]');
  const boton = raiz.querySelector('[data-accion="enviar"]');
  const mensajes = raiz.querySelector('[data-zona="mensajes"]');

  eq('el botón arranca en modo enviar', boton.dataset.modo, 'enviar');

  // --- enviar sin conversación crea una ---
  entrada.value = 'Hola, esto es una prueba';
  boton.dispatchEvent(new w.Event('click', { bubbles: true }));

  const conv = pulsar.getState().ui.activeConversation;
  ok('enviar sin conversación activa crea una', !!conv, String(conv));
  eq('el título sale del primer mensaje',
    nebula.get(conv).properties.titulo, 'Hola, esto es una prueba');
  eq('se pintan el mensaje del usuario y el del asistente', mensajes.children.length, 2);
  eq('el primero es del usuario', mensajes.children[0].dataset.rol, 'user');
  eq('el campo se vacía tras enviar', entrada.value, '');
  eq('durante el streaming el botón detiene', boton.dataset.modo, 'detener');
  eq('y la entrada queda deshabilitada', entrada.disabled, true);

  p.agotar();
  eq('al terminar el botón vuelve a enviar', boton.dataset.modo, 'enviar');
  eq('y la entrada se rehabilita', entrada.disabled, false);
  eq('el texto llegó completo',
    mensajes.children[1].querySelector('[data-zona="texto"]').textContent, 'uno dos tres cuatro cinco');

  // --- enviar vacío no hace nada ---
  const antesVacio = mensajes.children.length;
  entrada.value = '   ';
  boton.dispatchEvent(new w.Event('click', { bubbles: true }));
  eq('enviar en blanco no crea mensajes', mensajes.children.length, antesVacio);

  // --- Enter envía, Shift+Enter no ---
  entrada.value = 'Con Enter';
  entrada.dispatchEvent(Object.assign(new w.Event('keydown', { bubbles: true }),
    { key: 'Enter', shiftKey: false, preventDefault() {} }));
  eq('Enter envía', mensajes.children.length, antesVacio + 2);
  p.agotar();

  const antesShift = mensajes.children.length;
  entrada.value = 'Con Shift';
  entrada.dispatchEvent(Object.assign(new w.Event('keydown', { bubbles: true }),
    { key: 'Enter', shiftKey: true, preventDefault() {} }));
  eq('Shift+Enter no envía', mensajes.children.length, antesShift);
  entrada.value = '';

  // --- detener a media respuesta ---
  entrada.value = 'Voy a interrumpir esto';
  boton.dispatchEvent(new w.Event('click', { bubbles: true }));
  p.avanzar(2);
  eq('el botón está en modo detener', boton.dataset.modo, 'detener');
  boton.dispatchEvent(new w.Event('click', { bubbles: true }));
  eq('detener deja el mensaje interrumpido',
    mensajes.lastElementChild.dataset.estado, modelo.ESTADO_INTERRUMPIDO);
  eq('detener libera los temporizadores', p.pendientes(), 0);
  eq('el botón vuelve a enviar', boton.dataset.modo, 'enviar');

  // --- cambiar de conversación con un stream vivo ---
  const otra = modelo.crearConversacion(nebula, { titulo: 'Otra' });
  pulsar.setState({ ui: { ...pulsar.getState().ui, activeConversation: conv } });
  entrada.value = 'Empiezo aquí y me voy';
  boton.dispatchEvent(new w.Event('click', { bubbles: true }));
  p.avanzar(2);
  ok('hay un stream vivo', p.pendientes() > 0);

  pulsar.setState({ ui: { ...pulsar.getState().ui, activeConversation: otra } });
  eq('cambiar de conversación detiene el stream', p.pendientes(), 0);

  pulsar.setState({ ui: { ...pulsar.getState().ui, activeConversation: conv } });
  const interrumpidos = modelo.listarMensajes(pulsar.getState().entities, conv)
    .filter((m) => m.estado === modelo.ESTADO_INTERRUMPIDO);
  ok('el mensaje queda marcado como interrumpido', interrumpidos.length >= 1);

  // --- teardown con stream vivo ---
  const form = raiz.querySelector('[data-chunk="composer"]');
  entrada.value = 'Uno más antes de desmontar';
  boton.dispatchEvent(new w.Event('click', { bubbles: true }));
  p.avanzar(1);
  ok('hay un stream vivo antes de desmontar', p.pendientes() > 0);
  Chunklet.unmount(form);
  eq('desmontar el composer detiene el stream', p.pendientes(), 0);

  datos.destruir({ guardarPendiente: false });
}

console.log('\n  Retirada del andamio');
{
  const fs = await import('fs');
  const boot = fs.readFileSync(new URL('../app/boot.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  // Se comprueba el artefacto, no la palabra: una nota que diga "sustituye al
  // andamio de 1.3" es historia legítima y no debe hacer fallar la aserción.
  ok('boot.js no conserva el disparador del andamio',
    !/crearAndamio|andamio-disparador/.test(boot));
  ok('index.html no conserva el bloque del andamio',
    !/data-chunk="andamio/.test(html));
  ok('index.html declara el composer', /data-chunk="composer"/.test(html));
}

console.log(`\n  === ${pass}/${pass + fail} verdes, ${fail} en rojo ===\n`);
process.exit(fail > 0 ? 1 : 0);
