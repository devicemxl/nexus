/**
 * PulsarJS - Estado reactivo para el navegador
 * Versión: 0.2.3 (Implementación del contrato v0.2.0)
 *
 * Cambios respecto a v0.2.2 (refactor interno; UN cambio de conducta
 * observable, descrito abajo):
 * - El registro de selector listeners pasa de Map<selectorFn, Map<id,
 *   entry>> a un Map<id, entry> plano. El agrupamiento por selector ya
 *   no compraba nada después del fix R-1(b), que obliga a evaluar el
 *   selector por listener. Ver el comentario del constructor.
 * - Consecuencia para autores de plug-ins: `_selectorListeners` cambia
 *   de forma. Es estructura interna expuesta al contrato de plug-ins
 *   (§9 del contrato), así que cuenta como breaking para ellos aunque
 *   no lo sea para consumidores de la API pública.
 * - CAMBIO DE CONDUCTA. Si un selector listener desuscribe a OTRO
 *   selector listener durante la misma pasada de `_notify`, el
 *   desuscrito ahora SÍ se invoca en esa pasada; antes no.
 *
 *   No es una regresión: la garantía de reentrancy safety del contrato
 *   (§6) dice que la iteración usa un snapshot del registro, y el propio
 *   comentario de R-1(a) declaraba que un listener presente al inicio de
 *   la pasada se invoca. La estructura agrupada cumplía eso DENTRO de un
 *   grupo (snapshot del Map interno) pero no ENTRE grupos: borrar un
 *   grupo mientras se iteraba el Map externo lo saltaba. O sea, la
 *   garantía valía o no según si los dos listeners compartían la misma
 *   referencia de función selector, cosa que el consumidor no controla
 *   ni puede observar. El registro plano la hace uniforme.
 *
 * Cambios respecto a v0.2.1 (fix R-1, sin cambio de API):
 * - `_notify` ya no corrompe el `previousValue` de un selector listener
 *   cuando el listener dispara un `setState` reentrante. Tres síntomas
 *   observables quedaban de la misma causa raíz — valores capturados
 *   antes de invocar y escritos de vuelta después:
 *     (a) el frame externo sobrescribía con un valor obsoleto el
 *         `previousValue` que la reentrada había dejado correcto,
 *         produciendo notificaciones espurias posteriores;
 *     (b) la llamada reentrante recibía un `previousValue` desactualizado;
 *     (c) los listeners restantes de un selector compartido recibían un
 *         `currentValue` obsoleto, anterior a la mutación reentrante.
 *   El fix lee la entrada viva del registro, evalúa el selector por
 *   listener y avanza `previousValue` antes de invocar. Ver
 *   `PULSAR_R1_FIX.md`.
 *
 * Cambios respecto a v0.2.0:
 * - El módulo expone únicamente el named export `createStatePulsar`,
 *   alineado con el contrato. Se removió `export default Pulsar` y
 *   el named export de la clase.
 * - `subscribeSelector` ahora registra el listener antes de invocarlo
 *   con `immediate: true`, replicando la semántica de `subscribe`.
 *   Un `setState` disparado dentro del callback inmediato ahora sí
 *   notifica al listener recién suscrito.
 *
 * Características:
 * - Cero dependencias
 * - ES Module puro (type="module")
 * - Browser-first (sin Node.js, sin build steps)
 * - Estado como árbol de objetos
 * - Suscripciones globales y selectivas
 * - Reentrancy-safe
 * - Congelamiento opcional del estado
 */

// ============================================
// CLASE INTERNA
// ============================================

class Pulsar {
  /**
   * Crea una nueva instancia de Pulsar
   * @param {Object} initialState - Estado inicial (debe ser objeto plano)
   * @param {Object} options - Opciones de configuración
   * @param {boolean} options.freeze - Si true, congela el estado (default: true)
   * @param {boolean} options.skipEqualUpdates - Si true, no notifica si el estado es igual (default: false)
   */
  constructor(initialState = {}, options = {}) {
    // Validar estado inicial
    if (!this._isPlainObject(initialState)) {
      throw new TypeError('[Pulsar] initialState debe ser un objeto plano');
    }

    // Estado interno
    this._state = initialState;
    this._listeners = new Set();           // Listeners globales (subscribe)
    // Registro PLANO: Map<id, {selector, listener, equality, previousValue}>.
    //
    // Hasta v0.2.2 era Map<selectorFn, Map<id, entry>>. El agrupamiento
    // por función existía para evaluar cada selector una sola vez por
    // pasada y repartir el resultado entre sus listeners. El fix R-1(b)
    // eliminó esa economía: desde entonces el selector se evalúa por
    // listener, porque una mutación reentrante de un listener anterior
    // obliga a que los siguientes vean el estado real. Con la evaluación
    // ya desagregada, el nivel extra de Map sólo aportaba el doble
    // lookup vivo/snapshot y un agrupamiento que además no se cumplía:
    // `subscribeSelector('ui.x', ...)` crea una función nueva en cada
    // llamada, de modo que dos suscripciones a la misma ruta nunca
    // compartieron grupo.
    this._selectorListeners = new Map();
    this._nextSelectorId = 1;

    // Opciones
    this._options = {
      freeze: true,
      skipEqualUpdates: false,
      ...options
    };

    // Congelar estado inicial si está activado
    if (this._options.freeze) {
      this._state = this._deepFreeze(this._state);
    }
  }

  // ============================================
  // API PRINCIPAL
  // ============================================

  /**
   * Obtiene el estado actual
   * @returns {Object} Estado actual (congelado si freeze=true)
   */
  getState() {
    return this._state;
  }

  /**
   * Actualiza el estado con shallow merge
   * @param {Object} partial - Objeto con las propiedades a actualizar
   * @throws {TypeError} Si partial no es un objeto plano
   */
  setState(partial) {
    // Validar
    if (!this._isPlainObject(partial)) {
      throw new TypeError('[Pulsar] setState: partial debe ser un objeto plano');
    }

    // Crear nuevo estado con shallow merge
    const next = { ...this._state, ...partial };

    // Skip si es igual (opcional)
    if (this._options.skipEqualUpdates && this._shallowEqual(this._state, next)) {
      return;
    }

    // Congelar si está activado
    if (this._options.freeze) {
      this._deepFreeze(next);
    }

    // Actualizar estado y notificar
    this._state = next;
    this._notify();
  }

  // ============================================
  // SUSCRIPCIONES
  // ============================================

  /**
   * Suscribe un listener global (se llama con todo el estado)
   * @param {Function} listener - Función (state) => void
   * @param {Object} options - Opciones
   * @param {boolean} options.immediate - Si true, llama al listener inmediatamente
   * @returns {Function} Función para cancelar la suscripción
   */
  subscribe(listener, options = {}) {
    // Validar
    if (typeof listener !== 'function') {
      throw new TypeError('[Pulsar] subscribe: listener debe ser una función');
    }

    // Registrar ANTES de invocar (para que un setState reentrante desde
    // el callback inmediato notifique al listener recién suscrito).
    this._listeners.add(listener);

    if (options.immediate) {
      try {
        listener(this._state);
      } catch (error) {
        console.error('[Pulsar] Error en listener inmediato:', error);
      }
    }

    // Retornar función de cancelación
    return () => {
      this._listeners.delete(listener);
    };
  }

  /**
   * Suscribe un listener selectivo (solo se llama si el valor derivado cambia)
   * @param {Function|string} selector - Función (state) => any o string con ruta ('ui.selectedNode')
   * @param {Function} listener - Función (currentValue, previousValue, state) => void
   * @param {Object} options - Opciones
   * @param {Function} options.equality - Función de comparación (default: Object.is)
   * @param {boolean} options.immediate - Si true, llama al listener inmediatamente
   * @returns {Function} Función para cancelar la suscripción
   */
  subscribeSelector(selector, listener, options = {}) {
    // Validar
    if (typeof listener !== 'function') {
      throw new TypeError('[Pulsar] subscribeSelector: listener debe ser una función');
    }

    // Normalizar selector
    const selectorFn = typeof selector === 'string'
      ? this._createPathSelector(selector)
      : selector;

    if (typeof selectorFn !== 'function') {
      throw new TypeError('[Pulsar] subscribeSelector: selector debe ser función o string');
    }

    // Configurar
    const equalityFn = options.equality || Object.is;
    const listenerId = this._nextSelectorId++;

    // Evaluar valor inicial
    let previousValue;
    try {
      previousValue = selectorFn(this._state);
    } catch (error) {
      console.error('[Pulsar] Error evaluando selector:', error);
      previousValue = undefined;
    }

    // Registrar ANTES de invocar (simetría con subscribe): un setState
    // reentrante desde el callback inmediato debe alcanzar a este listener.
    this._selectorListeners.set(listenerId, {
      selector: selectorFn,
      listener,
      equality: equalityFn,
      previousValue
    });

    // Llamar inmediatamente si se solicita
    if (options.immediate) {
      try {
        listener(previousValue, undefined, this._state);
      } catch (error) {
        console.error('[Pulsar] Error en listener inmediato:', error);
      }
    }

    // Retornar función de cancelación
    return () => {
      this._selectorListeners.delete(listenerId);
    };
  }

  // ============================================
  // MÉTODOS INTERNOS
  // ============================================

  /**
   * Notifica a todos los listeners (reentrancy-safe)
   */
  _notify() {
    // Snapshot de listeners globales (reentrancy safety)
    const listenersSnapshot = [...this._listeners];

    // Notificar listeners globales
    for (const listener of listenersSnapshot) {
      try {
        listener(this._state);
      } catch (error) {
        console.error('[Pulsar] Error en listener global:', error);
      }
    }

    // Notificar selector listeners. Snapshot del registro para que
    // suscribir o desuscribir durante la pasada no altere la iteración.
    const selectorSnapshot = [...this._selectorListeners.entries()];

    for (const [id, snapshotEntry] of selectorSnapshot) {
      // R-1(a): leer la entrada VIVA, no la capturada en el snapshot.
      // Un listener anterior de esta misma pasada pudo disparar un
      // setState reentrante que ya avanzó este previousValue.
      // Si el listener se desuscribió durante la pasada, caemos al
      // snapshot: la semántica previa (un listener presente al inicio
      // de la pasada se invoca) se preserva intacta.
      const liveEntry = this._selectorListeners.get(id);
      const entry = liveEntry || snapshotEntry;
      const { selector, listener, equality, previousValue } = entry;

      // R-1(b): evaluar el selector por listener. Un listener anterior
      // pudo mutar el estado de forma reentrante; los restantes deben
      // ver el estado real, no el que existía al entrar a la pasada.
      let currentValue;
      try {
        currentValue = selector(this._state);
      } catch (error) {
        console.error('[Pulsar] Error evaluando selector:', error);
        continue;
      }

      if (equality(currentValue, previousValue)) continue;

      // R-1(c): avanzar previousValue ANTES de invocar. Si el listener
      // dispara un setState reentrante, la notificación anidada parte
      // de este valor. Escribir después permitiría que este frame
      // sobrescriba con un valor obsoleto lo que la reentrada dejó
      // correcto.
      //
      // Se escribe una entrada NUEVA en lugar de mutar la existente,
      // para que el snapshot conserve el valor con el que entró la
      // pasada. Si el listener lanza, previousValue queda igualmente
      // avanzado: misma semántica que v0.2.2.
      if (liveEntry) {
        this._selectorListeners.set(id, {
          selector,
          listener,
          equality,
          previousValue: currentValue
        });
      }

      try {
        listener(currentValue, previousValue, this._state);
      } catch (error) {
        console.error('[Pulsar] Error en selector listener:', error);
      }
    }
  }

  /**
   * Crea un selector de ruta a partir de un string
   * @param {string} path - Ruta (ej: 'ui.selectedNode')
   * @returns {Function} Función selector
   */
  _createPathSelector(path) {
    // Dividir la ruta en segmentos respetando los corchetes.
    // Ejemplo: "users[0].address.city" -> ["users", "0", "address", "city"]
    const segments = [];
    let current = '';

    for (let i = 0; i < path.length; i++) {
      const char = path[i];
      if (char === '.') {
        if (current) {
          segments.push(current);
          current = '';
        }
      } else if (char === '[') {
        if (current) {
          segments.push(current);
          current = '';
        }
        // Extraer el número hasta el ']' correspondiente
        let j = i + 1;
        while (j < path.length && path[j] !== ']') j++;
        if (j < path.length) {
          const index = path.substring(i + 1, j);
          if (/^\d+$/.test(index)) {
            segments.push(index); // El número será usado como clave numérica
          }
          i = j; // Saltar el ']'
        }
      } else {
        current += char;
      }
    }
    if (current) segments.push(current);

    // Retornar la función selector que recorre los segmentos
    return (state) => {
      let value = state;
      for (const seg of segments) {
        if (value === null || value === undefined || typeof value !== 'object') {
          return undefined;
        }
        value = value[seg]; // 'seg' puede ser string o número (para arrays)
      }
      return value;
    };
  }

  /**
   * Verifica si un objeto es plano
   * @param {*} obj - Objeto a verificar
   * @returns {boolean} true si es objeto plano
   */
  _isPlainObject(obj) {
    if (obj === null || typeof obj !== 'object') return false;
    if (Array.isArray(obj)) return false;

    const proto = Object.getPrototypeOf(obj);
    return proto === Object.prototype || proto === null;
  }

  /**
   * Congela un objeto recursivamente
   * @param {Object} obj - Objeto a congelar
   * @returns {Object} Objeto congelado
   */
  _deepFreeze(obj) {
    if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
      Object.freeze(obj);
      for (const key of Object.keys(obj)) {
        this._deepFreeze(obj[key]);
      }
    }
    return obj;
  }

  /**
   * Compara dos objetos superficialmente
   * @param {Object} a - Primer objeto
   * @param {Object} b - Segundo objeto
   * @returns {boolean} true si son iguales superficialmente
   */
  _shallowEqual(a, b) {
    if (Object.is(a, b)) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    return keysA.every(key => Object.is(a[key], b[key]));
  }
}

// ============================================
// FACTORY FUNCTION (API pública del contrato)
// ============================================

/**
 * Crea una nueva instancia de Pulsar.
 * Esta es la única API pública del módulo, conforme al contrato v0.2.0.
 *
 * @param {Object} initialState - Estado inicial
 * @param {Object} options - Opciones
 * @returns {Object} Nueva instancia con métodos getState, setState,
 *                   subscribe y subscribeSelector.
 */
export function createStatePulsar(initialState = {}, options = {}) {
  return new Pulsar(initialState, options);
}