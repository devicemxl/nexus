/**
 * PulsarJS - Estado reactivo
 * Sistema de estado con suscripciones, computados y persistencia opcional
 * 
  Características implementadas:

    Estado reactivo básico - get(), set(), delete()
    Suscripciones - subscribe() con cancelación
    Propiedades computadas - computed() con dependencias
    Historial de cambios - undo(), redo() con límite configurable
    Persistencia opcional - localStorage con configuración
    Serialización - serialize(), deserialize()
    Métodos estáticos - Pulsar.create(), createState()
    Utilidades - PulsarUtils.combine(), derive(), watch()
    Modo debug - Logs en consola cuando está habilitado
 */

// Estado interno de Pulsar
const state = new Map();
const subscribers = new Map();
const computedCache = new Map();

// Configuración global
const config = {
  useLocalStorage: false,
  storageKey: 'pulsar-state',
  debug: false
};

class Pulsar {
  /**
   * Inicializa Pulsar con estado inicial
   * @param {Object} initialState - Estado inicial
   * @param {Object} options - Opciones de configuración
   */
  constructor(initialState = {}, options = {}) {
    this._state = { ...initialState };
    this._subscribers = new Map();
    this._computed = new Map();
    this._history = [];
    this._historyIndex = -1;
    this._maxHistory = 50;

    Object.assign(config, options);

    // Cargar estado persistido si está habilitado
    if (config.useLocalStorage) {
      this._loadFromStorage();
    }
  }

  /**
   * Obtiene el valor de una propiedad
   * @param {string} key - Nombre de la propiedad
   * @returns {*} Valor de la propiedad
   */
  get(key) {
    if (this._computed.has(key)) {
      return this._computed.get(key).value;
    }
    return this._state[key];
  }

  /**
   * Establece el valor de una propiedad
   * @param {string} key - Nombre de la propiedad
   * @param {*} value - Nuevo valor
   * @param {boolean} silent - Si true, no notifica a los suscriptores
   */
  set(key, value, silent = false) {
    const oldValue = this._state[key];

    // No hacer nada si el valor no cambió
    if (oldValue === value) return;

    // Guardar en historial para undo/redo
    if (!silent) {
      this._pushHistory(key, oldValue, value);
    }

    // Actualizar el estado
    this._state[key] = value;

    // Persistir si está habilitado
    if (config.useLocalStorage) {
      this._saveToStorage();
    }

    // Notificar a los suscriptores
    if (!silent) {
      this._notify(key, value, oldValue);
    }

    // Actualizar valores computados dependientes
    this._updateComputations(key);

    if (config.debug) {
      console.log(`[Pulsar] set(${key}) =`, value);
    }
  }

  /**
   * Suscribe una función a cambios en una propiedad
   * @param {string|string[]} keys - Propiedad o array de propiedades
   * @param {Function} callback - Función a ejecutar
   * @returns {Function} Función para cancelar la suscripción
   */
  subscribe(keys, callback) {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    const subscriptionId = Symbol('subscription');

    keyArray.forEach(key => {
      if (!this._subscribers.has(key)) {
        this._subscribers.set(key, new Map());
      }
      this._subscribers.get(key).set(subscriptionId, callback);
    });

    // Retornar función de cancelación
    return () => {
      keyArray.forEach(key => {
        if (this._subscribers.has(key)) {
          this._subscribers.get(key).delete(subscriptionId);
        }
      });
    };
  }

  /**
   * Crea una propiedad computada
   * @param {string} key - Nombre de la propiedad computada
   * @param {Function} computeFn - Función que calcula el valor
   * @param {string[]} dependencies - Propiedades de las que depende
   */
  computed(key, computeFn, dependencies = []) {
    const computedObj = {
      value: undefined,
      computeFn,
      dependencies,
      dirty: true
    };

    // Calcular valor inicial
    computedObj.value = this._executeComputed(computeFn);
    this._computed.set(key, computedObj);

    // Suscribirse a dependencias
    this.subscribe(dependencies, () => {
      const oldValue = computedObj.value;
      computedObj.value = this._executeComputed(computeFn);
      this._notify(key, computedObj.value, oldValue);
    });

    return computedObj.value;
  }

  /**
   * Ejecuta una función computada con manejo de errores
   * @param {Function} fn - Función a ejecutar
   * @returns {*} Resultado de la función
   */
  _executeComputed(fn) {
    try {
      return fn(this._state);
    } catch (error) {
      console.error('[Pulsar] Error en computado:', error);
      return undefined;
    }
  }

  /**
   * Notifica a los suscriptores de una propiedad
   * @param {string} key - Propiedad que cambió
   * @param {*} value - Nuevo valor
   * @param {*} oldValue - Valor anterior
   */
  _notify(key, value, oldValue) {
    if (this._subscribers.has(key)) {
      this._subscribers.get(key).forEach(callback => {
        try {
          callback(value, oldValue, key);
        } catch (error) {
          console.error(`[Pulsar] Error en suscriptor de ${key}:`, error);
        }
      });
    }

    // Notificar suscriptores globales
    if (this._subscribers.has('*')) {
      this._subscribers.get('*').forEach(callback => {
        try {
          callback({ key, value, oldValue });
        } catch (error) {
          console.error('[Pulsar] Error en suscriptor global:', error);
        }
      });
    }
  }

  /**
   * Actualiza los computados que dependen de una propiedad
   * @param {string} key - Propiedad que cambió
   */
  _updateComputations(key) {
    this._computed.forEach((computedObj, computedKey) => {
      if (computedObj.dependencies.includes(key)) {
        const oldValue = computedObj.value;
        computedObj.value = this._executeComputed(computedObj.computeFn);
        this._notify(computedKey, computedObj.value, oldValue);
      }
    });
  }

  /**
   * Guarda un cambio en el historial para undo/redo
   * @param {string} key - Propiedad que cambió
   * @param {*} oldValue - Valor anterior
   * @param {*} newValue - Nuevo valor
   */
  _pushHistory(key, oldValue, newValue) {
    // Eliminar entradas futuras si estamos en medio del historial
    if (this._historyIndex < this._history.length - 1) {
      this._history = this._history.slice(0, this._historyIndex + 1);
    }

    this._history.push({ key, oldValue, newValue });
    this._historyIndex++;

    // Limitar el tamaño del historial
    if (this._history.length > this._maxHistory) {
      this._history.shift();
      this._historyIndex--;
    }
  }

  /**
   * Deshace el último cambio
   * @returns {boolean} true si se pudo deshacer
   */
  undo() {
    if (this._historyIndex < 0) return false;

    const change = this._history[this._historyIndex];
    this._state[change.key] = change.oldValue;
    this._historyIndex--;

    this._notify(change.key, change.oldValue, change.newValue);
    this._updateComputations(change.key);

    if (config.useLocalStorage) {
      this._saveToStorage();
    }

    return true;
  }

  /**
   * Rehace un cambio deshecho
   * @returns {boolean} true si se pudo rehacer
   */
  redo() {
    if (this._historyIndex >= this._history.length - 1) return false;

    this._historyIndex++;
    const change = this._history[this._historyIndex];
    this._state[change.key] = change.newValue;

    this._notify(change.key, change.newValue, change.oldValue);
    this._updateComputations(change.key);

    if (config.useLocalStorage) {
      this._saveToStorage();
    }

    return true;
  }

  /**
   * Obtiene todo el estado actual
   * @returns {Object} Copia del estado actual
   */
  getState() {
    return { ...this._state };
  }

  /**
   * Establece múltiples propiedades a la vez
   * @param {Object} updates - Objeto con las propiedades a actualizar
   * @param {boolean} silent - Si true, no notifica a los suscriptores
   */
  setState(updates, silent = false) {
    const keys = Object.keys(updates);
    keys.forEach(key => {
      this.set(key, updates[key], silent);
    });
  }

  /**
   * Elimina una propiedad del estado
   * @param {string} key - Propiedad a eliminar
   */
  delete(key) {
    if (key in this._state) {
      const oldValue = this._state[key];
      delete this._state[key];
      this._notify(key, undefined, oldValue);

      if (config.useLocalStorage) {
        this._saveToStorage();
      }
    }
  }

  /**
   * Guarda el estado en localStorage
   */
  _saveToStorage() {
    try {
      localStorage.setItem(config.storageKey, JSON.stringify(this._state));
    } catch (error) {
      console.error('[Pulsar] Error guardando en localStorage:', error);
    }
  }

  /**
   * Carga el estado desde localStorage
   */
  _loadFromStorage() {
    try {
      const savedState = localStorage.getItem(config.storageKey);
      if (savedState) {
        this._state = { ...this._state, ...JSON.parse(savedState) };
      }
    } catch (error) {
      console.error('[Pulsar] Error cargando de localStorage:', error);
    }
  }

  /**
   * Limpia todo el estado y las suscripciones
   */
  reset() {
    this._state = {};
    this._subscribers.clear();
    this._computed.clear();
    this._history = [];
    this._historyIndex = -1;

    if (config.useLocalStorage) {
      localStorage.removeItem(config.storageKey);
    }
  }

  /**
   * Serializa el estado a JSON
   * @returns {string} Estado serializado
   */
  serialize() {
    return JSON.stringify(this._state);
  }

  /**
   * Deserializa estado desde JSON
   * @param {string} json - JSON con el estado
   */
  deserialize(json) {
    try {
      const parsed = JSON.parse(json);
      this.setState(parsed);
    } catch (error) {
      console.error('[Pulsar] Error deserializando:', error);
    }
  }

  /**
   * Método estático para crear instancia de Pulsar
   * @param {Object} initialState - Estado inicial
   * @param {Object} options - Opciones de configuración
   * @returns {Pulsar} Nueva instancia
   */
  static create(initialState = {}, options = {}) {
    return new Pulsar(initialState, options);
  }
}

// Exportar la clase Pulsar
export { Pulsar };

// Exportar instancia singleton para uso global
export const pulsar = new Pulsar();

// Exportar función helper para crear estados reactivos
export function createState(initialState = {}, options = {}) {
  return new Pulsar(initialState, options);
}

// Exportar utilidades adicionales
export const PulsarUtils = {
  /**
   * Combina múltiples estados en uno
   * @param {...Pulsar} states - Estados a combinar
   * @returns {Pulsar} Nuevo estado combinado
   */
  combine(...states) {
    const combined = {};
    states.forEach(state => {
      Object.assign(combined, state.getState());
    });
    return new Pulsar(combined);
  },

  /**
   * Crea un estado derivado de otro
   * @param {Pulsar} source - Estado fuente
   * @param {Object} transformations - Transformaciones a aplicar
   * @returns {Pulsar} Estado derivado
   */
  derive(source, transformations = {}) {
    const derived = new Pulsar();

    Object.entries(transformations).forEach(([key, transformFn]) => {
      source.subscribe(key, (value) => {
        derived.set(key, transformFn(value));
      });
    });

    return derived;
  },

  /**
   * Observa cambios en múltiples propiedades
   * @param {Pulsar} state - Estado a observar
   * @param {string[]} keys - Propiedades a observar
   * @param {Function} callback - Función a ejecutar
   */
  watch(state, keys, callback) {
    return state.subscribe(keys, (value, oldValue, key) => {
      callback({ key, value, oldValue });
    });
  }
};

export default Pulsar;