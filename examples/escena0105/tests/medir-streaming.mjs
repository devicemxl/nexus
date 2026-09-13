import { parseHTML } from '/home/claude/node_modules/linkedom/esm/index.js';
const { window:w, document:d } = parseHTML('<!DOCTYPE html><html><body></body></html>');
globalThis.window=w; globalThis.document=d; globalThis.Element=w.Element; globalThis.Node=w.Node;
globalThis.MutationObserver = w.MutationObserver || class{observe(){}disconnect(){}};
w.location={href:'http://l/',hash:'',pathname:'/',search:'',origin:'http://l'};

const base='../app/';
const { crearPrimitivas, arrancarDatos } = await import(base+'boot.js');
const modelo = await import(base+'modelo.js');
const stg=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};

// Simula streaming: T mutaciones sobre UNA entidad, con N entidades en el grafo.
function medir(N, T) {
  const { nebula, pulsar } = crearPrimitivas();
  const datos = arrancarDatos({ nebula, pulsar, storage: stg(), clave:'t', debounceMs: 100000 });

  const conv = modelo.crearConversacion(nebula, { titulo:'C' });
  for (let i = 0; i < N - 1; i++) nebula.put(`message:previo${i}`, { texto:'x'.repeat(40), rol:'user' });

  const idStream = 'message:enVuelo';
  nebula.put(idStream, { texto:'', rol:'assistant' });

  let notificaciones = 0;
  pulsar.subscribe(() => { notificaciones++; });

  let texto = '';
  const t0 = performance.now();
  for (let i = 0; i < T; i++) {
    texto += 'token ';
    nebula.update(idStream, { texto });
  }
  const ms = performance.now() - t0;
  datos.destruir({ guardarPendiente:false });
  return { ms, notificaciones, porToken: ms / T };
}

console.log('\n  Costo del streaming: T tokens sobre UNA entidad, con N entidades en el grafo\n');
console.log('      N      T     total      por token    notificaciones');
console.log('  ' + '-'.repeat(58));
for (const [N,T] of [[10,200],[50,200],[200,200],[500,200],[500,600],[1000,600]]) {
  const r = medir(N,T);
  console.log(
    String(N).padStart(7) + String(T).padStart(7) +
    (r.ms.toFixed(1)+' ms').padStart(11) +
    (r.porToken.toFixed(3)+' ms').padStart(13) +
    String(r.notificaciones).padStart(16));
}
console.log('\n  Referencia: a 30 tokens/s el presupuesto por token es 33 ms;');
console.log('  para no perder un frame de 60 Hz, 16 ms.\n');
