/**
 * Coste de un turno de conversación: antes y después de la reconciliación.
 *
 * Un turno produce tres cambios estructurales — añadir el mensaje del usuario,
 * abrir el del asistente, cerrarlo. Antes cada uno reconstruía la lista
 * entera. Se cuentan las operaciones de DOM, que es la métrica que sirve para
 * los dos diseños.
 */
import { parseHTML } from '/home/claude/node_modules/linkedom/esm/index.js';
const { document: d } = parseHTML('<!DOCTYPE html><html><body></body></html>');
globalThis.document = d; globalThis.Element = d.defaultView.Element;
globalThis.MutationObserver = class { observe(){} disconnect(){} };
globalThis.window = { location:{origin:'http://l',href:'http://l/',pathname:'/',search:'',hash:''},
  history:{pushState(){},replaceState(){},back(){},forward(){}},
  addEventListener(){}, removeEventListener(){} };

const modelo = await import('../app/modelo.js');
const { crearPrimitivas, arrancarDatos, montarInterfaz } = await import('../app/boot.js');
const { crearMockProvider } = await import('../app/mock-provider.js');
const Chunklet = (await import('../../../src/chunklet.js')).default;
const { conversationMessages } = await import('../app/conversation-messages.js');

const stg=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
function planificador(){const c=[];let s=0;return{
  programar:f=>{const h=++s;c.push({h,fn:f});return h},
  cancelar:h=>{const i=c.findIndex(x=>x.h===h);if(i>=0)c.splice(i,1)},
  agotar(){let v=0;while(c.length&&v<9999){c.shift().fn();v++}return v}};}

document.body.innerHTML = `
<main id="raiz" data-chunk="conversation-messages">
  <div data-zona="mensajes-scroll"><p data-zona="sin-mensajes"></p><div data-zona="mensajes"></div></div>
  <template data-plantilla="message-item">
    <article data-mensaje><div data-zona="quien"></div><div data-zona="texto"></div></article>
  </template>
</main>`;
const raiz = document.getElementById('raiz');
const { graphlet, pulsar } = crearPrimitivas();
const datos = arrancarDatos({ graphlet, pulsar, storage: stg(), clave:'t', debounceMs: 1e6 });

let asa = null;
montarInterfaz({ graphlet, pulsar, voyajer: datos.voyajer,
  provider: crearMockProvider({ graphlet }, {}), raiz: document.createElement('div') });
Chunklet.define('conversation-messages', (el, c) => (asa = conversationMessages(el, c)));
Chunklet.mount(raiz);

console.log('\n  Operaciones de DOM por turno de conversación\n');
console.log('   mensajes previos   creados   destruidos   movidos   total');
console.log('  ' + '-'.repeat(60));

for (const M of [10, 50, 200, 500]) {
  const conv = modelo.crearConversacion(graphlet, { titulo: 'C' });
  pulsar.setState({ ui: { activeConversation: conv } });
  for (let i = 0; i < M; i++) modelo.agregarMensaje(graphlet, conv, { rol:'user', texto:`previo ${i}` });

  const p = planificador();
  const prov = crearMockProvider({ graphlet }, { programar:p.programar, cancelar:p.cancelar,
    respuestas:['uno dos tres cuatro cinco seis siete ocho'] });

  asa.reiniciarCuenta();
  modelo.agregarMensaje(graphlet, conv, { rol:'user', texto:'mi pregunta' });
  prov.responder(conv);
  p.agotar();
  const c = asa.cuenta;
  const total = c.creados + c.destruidos + c.movidos;
  console.log(
    String(M).padStart(12) + String(c.creados).padStart(11) +
    String(c.destruidos).padStart(13) + String(c.movidos).padStart(10) +
    String(total).padStart(8));
}

console.log('\n  Antes de la reconciliación, un turno costaba 3 reconstrucciones');
console.log('  completas: 3(M+2) nodos creados y 3(M+1) destruidos. A 500');
console.log('  mensajes, más de 3000 operaciones y 31 ms medidos en navegador.\n');
datos.destruir({ guardarPendiente:false });
