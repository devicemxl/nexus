/**
 * Medición limpia: warmup + mediana de repeticiones, para caracterizar
 * la curva de crecimiento de cada orden sin ruido de JIT.
 */
import { createNebula } from './nebula.js';
import { createStatePulsar } from './pulsar.js';
import { createHydrationAdapter } from './hydration-adapter.js';
import { createNebulaPulsarBridge } from './nebula-pulsar-bridge.js';
import { createPersistenceAdapter } from './persistence-adapter.js';

function construirSnapshot(n) {
  const entities = {};
  for (let i = 0; i < n; i++) {
    entities[`node:${i}`] = {
      properties: { title: `Nodo ${i}`, x: i * 12, y: i * 7, kind: i % 3 === 0 ? 'source' : 'transform' },
      links: i < n - 1 ? { next: [`node:${i + 1}`] } : {},
    };
  }
  return { entities };
}

function crearStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  };
}

function correr(orden, snapshot) {
  const nebula = createNebula();
  const pulsar = createStatePulsar({ ui: {}, entities: {} });
  const storage = crearStorage();
  let setStateN = 0;
  const original = pulsar.setState.bind(pulsar);
  pulsar.setState = (p) => { setStateN++; return original(p); };

  const t0 = performance.now();
  if (orden === 'A') {
    createHydrationAdapter({ nebula }, { snapshot });
    createNebulaPulsarBridge({ nebula, pulsar }, { path: 'entities' });
    createPersistenceAdapter({ nebula }, { key: 'b', storage, writeOnInit: false });
  } else {
    createNebulaPulsarBridge({ nebula, pulsar }, { path: 'entities' });
    createPersistenceAdapter({ nebula }, { key: 'b', storage, writeOnInit: false });
    createHydrationAdapter({ nebula }, { snapshot });
  }
  const ms = performance.now() - t0;
  return { ms, setStateN };
}

function mediana(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function medir(orden, n, reps) {
  const snapshot = construirSnapshot(n);
  for (let i = 0; i < 5; i++) correr(orden, snapshot);   // warmup
  const tiempos = [];
  let setStateN = 0;
  for (let i = 0; i < reps; i++) {
    const r = correr(orden, snapshot);
    tiempos.push(r.ms);
    setStateN = r.setStateN;
  }
  return { ms: mediana(tiempos), setStateN };
}

const tamanos = [25, 50, 100, 200, 400, 800];

console.log('\n  Hidratación completa — mediana de 15 corridas tras warmup\n');
console.log('        N   ' + 'A: setState'.padStart(12) + 'A: ms'.padStart(10) +
  '   |' + 'B: setState'.padStart(12) + 'B: ms'.padStart(10) + '     B/A tiempo');
console.log('  ' + '-'.repeat(74));

const curva = [];
for (const n of tamanos) {
  const a = medir('A', n, 15);
  const b = medir('B', n, 15);
  curva.push({ n, a: a.ms, b: b.ms });
  console.log(
    String(n).padStart(9) + '   ' +
    String(a.setStateN).padStart(12) +
    a.ms.toFixed(2).padStart(10) +
    '   |' +
    String(b.setStateN).padStart(12) +
    b.ms.toFixed(2).padStart(10) +
    ('×' + (b.ms / a.ms).toFixed(0)).padStart(16)
  );
}

// ---------- Caracterizar el exponente de crecimiento ----------
console.log('\n  Exponente de crecimiento observado (duplicando N):\n');
console.log('    paso'.padEnd(18) + 'orden A'.padStart(12) + 'orden B'.padStart(12));
console.log('  ' + '-'.repeat(42));
for (let i = 1; i < curva.length; i++) {
  const p = curva[i - 1], c = curva[i];
  const expA = Math.log2(c.a / p.a);
  const expB = Math.log2(c.b / p.b);
  console.log(
    `    ${p.n} -> ${c.n}`.padEnd(18) +
    expA.toFixed(2).padStart(12) +
    expB.toFixed(2).padStart(12)
  );
}
console.log('\n  Exponente 1.0 = lineal O(N). Exponente 2.0 = cuadrático O(N²).\n');
