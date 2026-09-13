/**
 * Nexus Adapter Chain
 * Versión: 0.1.0
 *
 * Gestiona la pila de wrappers que los adapters instalan sobre los
 * métodos de una primitiva (hoy, las mutaciones de nebula).
 *
 * PROBLEMA QUE RESUELVE
 *
 * Cada adapter capturaba el método vigente al construirse y lo restauraba
 * incondicionalmente al destruirse. Eso funciona sólo si los adapters se
 * destruyen en orden inverso al de montaje:
 *
 *     orig
 *     A envuelve → A_put  (delega en orig)
 *     B envuelve → B_put  (delega en A_put)
 *
 * Si A se destruye primero, `nebula.put = orig` y B queda FUERA de la
 * cadena sin que nadie lo sepa: su proyección o su persistencia dejan de
 * ocurrir en silencio. Cuando B se destruye después, reinstala A_put —
 * el wrapper de un adapter muerto — de forma permanente.
 *
 * El escape `if (_destroyed) return _originals.X(...)` que tenían los
 * wrappers evitaba que la llamada rompiera, no que el wrapper dejara de
 * ejecutarse.
 *
 * En la aplicación el orden LIFO se respetaba, así que el fallo no se
 * observaba. Pero era una invariante global no escrita: un test que
 * liberase en orden de creación, un hot-reload, o un consumidor que
 * destruyera "por comodidad" la rompía sin aviso.
 *
 * DISEÑO
 *
 * En vez de que cada adapter recuerde "qué había antes de mí", hay un
 * único dispatcher instalado por (target, método) que consulta la lista
 * de entradas vivas en cada invocación. Quitar una entrada es un empalme
 * en la lista, no una restauración. El orden de `unwrap` deja de
 * importar: es un detalle local en vez de una invariante distribuida.
 *
 * Orden de ejecución: la última entrada registrada corre primero (es la
 * más externa), igual que con el anidamiento manual que sustituye.
 *
 * CONTRATO DEL WRAPPER
 *
 *     chain.wrap(target, 'put', function (next, id, properties) {
 *       const result = next(id, properties);   // resto de la cadena
 *       hacerAlgo();
 *       return result;
 *     });
 *
 * `next` invoca el resto de la cadena y, al final, el método original.
 * Un wrapper que no llame a `next` corta la mutación — legítimo, pero
 * debe ser deliberado.
 */

// target -> Map<methodName, record>
// record = { original, dispatcher, entries: [{ id, fn }] }
const _chains = new WeakMap();

let _nextId = 1;

function _getRecord(target, method) {
  let byMethod = _chains.get(target);
  if (!byMethod) {
    byMethod = new Map();
    _chains.set(target, byMethod);
  }
  return byMethod.get(method) || null;
}

function _dispatch(record, target, skipId, args) {
  // La última entrada registrada es la más externa: se recorre al revés.
  const entries = [];
  for (let i = record.entries.length - 1; i >= 0; i--) {
    const entry = record.entries[i];
    if (entry.id !== skipId) entries.push(entry);
  }

  let index = 0;
  function next(...nextArgs) {
    if (index >= entries.length) {
      return record.original.apply(target, nextArgs);
    }
    const entry = entries[index++];
    return entry.fn.call(target, next, ...nextArgs);
  }

  return next(...args);
}

/**
 * Instala un wrapper sobre `target[method]`.
 *
 * @param {object} target - Instancia a envolver (p.ej. una nebula).
 * @param {string} method - Nombre del método.
 * @param {Function} fn - `(next, ...args) => any`.
 * @returns {{target: object, method: string, id: number}} handle para `unwrap`.
 */
export function wrap(target, method, fn) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('[AdapterChain] wrap: target debe ser un objeto');
  }
  if (typeof target[method] !== 'function') {
    throw new TypeError(`[AdapterChain] wrap: target.${method} no es una función`);
  }
  if (typeof fn !== 'function') {
    throw new TypeError('[AdapterChain] wrap: fn debe ser una función');
  }

  let byMethod = _chains.get(target);
  if (!byMethod) {
    byMethod = new Map();
    _chains.set(target, byMethod);
  }

  let record = byMethod.get(method);
  if (!record) {
    record = { original: target[method], dispatcher: null, entries: [] };
    record.dispatcher = function (...args) {
      return _dispatch(record, this === undefined ? target : this, null, args);
    };
    byMethod.set(method, record);
    target[method] = record.dispatcher;
  } else if (target[method] !== record.dispatcher) {
    // Alguien instaló un wrapper fuera de la cadena (monkey-patch manual).
    // Lo adoptamos como nuevo original para no perderlo, y avisamos:
    // mezclar los dos mecanismos hace que el orden vuelva a importar.
    console.warn(
      `[AdapterChain] target.${method} fue reemplazado fuera de la cadena. ` +
      'Se adopta como método base; mezcle wrappers manuales con la cadena bajo su responsabilidad.'
    );
    record.original = target[method];
    target[method] = record.dispatcher;
  }

  const id = _nextId++;
  record.entries.push({ id, fn });
  return { target, method, id };
}

/**
 * Retira un wrapper. Seguro en cualquier orden respecto a los demás.
 * Idempotente: retirar dos veces el mismo handle es no-op.
 */
export function unwrap(handle) {
  if (!handle || typeof handle !== 'object') return;
  const record = _getRecord(handle.target, handle.method);
  if (!record) return;

  const index = record.entries.findIndex(e => e.id === handle.id);
  if (index === -1) return;
  record.entries.splice(index, 1);

  if (record.entries.length === 0) {
    // Última entrada: devolvemos el método original, pero sólo si el
    // dispatcher sigue siendo el instalado. Si no, alguien escribió
    // encima y restaurar destruiría su trabajo.
    if (handle.target[handle.method] === record.dispatcher) {
      handle.target[handle.method] = record.original;
    } else {
      console.warn(
        `[AdapterChain] target.${handle.method} ya no es el dispatcher de la cadena; ` +
        'no se restaura el método original para no pisar a quien escribió encima.'
      );
    }
    _chains.get(handle.target).delete(handle.method);
  }
}

/**
 * Invoca la cadena completa SALTÁNDOSE la entrada de `handle`.
 *
 * Es lo que necesita un adapter que debe aplicar una mutación sin
 * re-observarla a sí mismo (el caso del External Event: aplicar una
 * mutación remota sin re-broadcastearla) pero que sí quiere que el
 * resto de adapters la vean.
 *
 * Sustituye al patrón anterior de guardar `_originals` y llamarlos
 * directamente, que sólo alcanzaba a los adapters montados ANTES del
 * llamador y por tanto hacía depender del orden de instanciación algo
 * que no debería depender de él.
 */
export function invokeSkipping(handle, args) {
  if (!handle || typeof handle !== 'object') {
    throw new TypeError('[AdapterChain] invokeSkipping: handle inválido');
  }
  const record = _getRecord(handle.target, handle.method);
  if (!record) {
    throw new Error(
      `[AdapterChain] invokeSkipping: no hay cadena instalada sobre ${handle.method}`
    );
  }
  return _dispatch(record, handle.target, handle.id, args);
}

/** Introspección para tests y diagnóstico. */
export function depth(target, method) {
  const record = _getRecord(target, method);
  return record ? record.entries.length : 0;
}
