/**
 * Medición: cuánto ruido reactivo absorbe la firma estable de la lista.
 *
 * BRIDGE-REACTIVE (PHASE_0_DEFERRED) dice que el Bridge re-proyecta el grafo
 * entero en cada mutación, de modo que todo suscriptor de `entities` recibe
 * una notificación por cada cambio de cualquier entidad. Escena 1.2 es el
 * primer sitio donde eso se puede medir sobre un widget real.
 *
 * Lo que se mide: con una lista de conversaciones estable, cuántas veces se
 * evalúa el selector frente a cuántas veces se repinta el DOM. La diferencia
 * es lo que la `equality` está evitando.
 *
 *   node medir-ruido.mjs
 */
import { parseHTML } from '/home/claude/node_modules/linkedom/esm/index.js';

const { window: w, document: d } = parseHTML('<!DOCTYPE html><html><body></body></html>');
globalThis.window = w; globalThis.document = d;
globalThis.Element = w.Element; globalThis.Node = w.Node;
globalThis.MutationObserver = w.MutationObserver || class { observe() {} disconnect() {} };
w.location = { href: 'http://local/', hash: '', pathname: '/', search: '', origin: 'http://local' };

const { crearPrimitivas, arrancarDatos } = await import('../app/boot.js');
const modelo = await import('../app/modelo.js');

function storageMock() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
}

/**
 * Monta un suscriptor equivalente al de `conversation-list` y cuenta
 * evaluaciones del selector frente a repintados efectivos.
 */
function escenario({ conversaciones, mutacionesAjenas, conEquality }) {
  const { nebula, pulsar } = crearPrimitivas();
  const datos = arrancarDatos({ nebula, pulsar, storage: storageMock(), clave: 't' });

  for (let i = 0; i < conversaciones; i++) {
    modelo.crearConversacion(nebula, { titulo: `Conversación ${i}` });
  }

  let evaluaciones = 0;
  let repintados = 0;

  pulsar.subscribeSelector(
    (estado) => { evaluaciones++; return modelo.listarConversaciones(estado.entities); },
    () => { repintados++; },
    conEquality
      ? { equality: modelo.mismasConversaciones, immediate: true }
      : { immediate: true }
  );

  const base = { evaluaciones, repintados };

  // Mutaciones sobre entidades que NO son conversaciones: mensajes, que es
  // exactamente lo que produce el streaming de la Escena 1.3.
  for (let i = 0; i < mutacionesAjenas; i++) {
    nebula.put(`message:${i}`, { texto: `token ${i}` });
  }

  datos.destruir({ guardarPendiente: false });

  return {
    evaluaciones: evaluaciones - base.evaluaciones,
    repintados: repintados - base.repintados,
  };
}

console.log('\n  Ruido reactivo absorbido por la firma estable');
console.log('  La lista de conversaciones no cambia; sólo se mutan mensajes.\n');
console.log('  conversaciones  mutaciones   evaluaciones   repintados   repintados');
console.log('   en la lista      ajenas     del selector    sin equality  con equality');
console.log('  ' + '-'.repeat(70));

for (const [conv, mut] of [[5, 20], [10, 50], [10, 200], [50, 200]]) {
  const sin = escenario({ conversaciones: conv, mutacionesAjenas: mut, conEquality: false });
  const con = escenario({ conversaciones: conv, mutacionesAjenas: mut, conEquality: true });
  console.log(
    String(conv).padStart(12) +
    String(mut).padStart(13) +
    String(con.evaluaciones).padStart(15) +
    String(sin.repintados).padStart(15) +
    String(con.repintados).padStart(14)
  );
}

console.log('\n  Lectura: el selector se evalúa una vez por mutación en ambos casos —');
console.log('  eso es BRIDGE-REACTIVE y la equality no lo evita. Lo que evita es el');
console.log('  repintado del DOM, que es la parte cara. La columna final es lo que');
console.log('  la Escena 1.3 heredará sobre la lista de conversaciones.\n');
