/**
 * ChunkletJS - DOM behaviors
 * Sistema de componentes y comportamientos para el DOM
 * 
    Características implementadas:

      DataAttributes - Manejo de atributos data-*
      StyleManager - Manejo de estilos CSS
      EventManager - Sistema de eventos con delegación
      AnimationManager - Animaciones y transiciones
      DOMManager - Manipulación del DOM
      Chunklet - Clase principal con sistema de comportamientos
      Comportamientos predefinidos - tooltip, toggle, ajax
      Utilidades - createElement, serializeForm, detectDevice, debounce, throttle

 */

// Clase para manejar atributos de datos
class DataAttributes {
  constructor(element) {
    this.element = element;
  }

  /**
   * Obtiene el valor de un atributo data
   * @param {string} key - Nombre del atributo
   * @returns {*} Valor del atributo
   */
  get(key) {
    return this.element.dataset[key];
  }

  /**
   * Establece el valor de un atributo data
   * @param {string} key - Nombre del atributo
   * @param {*} value - Valor a establecer
   */
  set(key, value) {
    this.element.dataset[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }

  /**
   * Elimina un atributo data
   * @param {string} key - Nombre del atributo
   */
  remove(key) {
    delete this.element.dataset[key];
  }

  /**
   * Verifica si existe un atributo data
   * @param {string} key - Nombre del atributo
   * @returns {boolean} true si existe
   */
  has(key) {
    return key in this.element.dataset;
  }

  /**
   * Obtiene todos los atributos data
   * @returns {Object} Objeto con todos los atributos
   */
  getAll() {
    return { ...this.element.dataset };
  }
}

// Clase para manejar estilos
class StyleManager {
  constructor(element) {
    this.element = element;
  }

  /**
   * Aplica estilos CSS
   * @param {Object|string} styles - Objeto de estilos o string CSS
   */
  apply(styles) {
    if (typeof styles === 'string') {
      this.element.style.cssText = styles;
    } else {
      Object.assign(this.element.style, styles);
    }
  }

  /**
   * Obtiene un estilo específico
   * @param {string} property - Propiedad CSS
   * @returns {string} Valor de la propiedad
   */
  get(property) {
    return this.element.style[property];
  }

  /**
   * Establece un estilo específico
   * @param {string} property - Propiedad CSS
   * @param {string} value - Valor de la propiedad
   */
  set(property, value) {
    this.element.style[property] = value;
  }

  /**
   * Elimina un estilo específico
   * @param {string} property - Propiedad CSS
   */
  remove(property) {
    this.element.style[property] = '';
  }

  /**
   * Añade clases CSS
   * @param {...string} classes - Clases a añadir
   */
  addClass(...classes) {
    this.element.classList.add(...classes);
  }

  /**
   * Elimina clases CSS
   * @param {...string} classes - Clases a eliminar
   */
  removeClass(...classes) {
    this.element.classList.remove(...classes);
  }

  /**
   * Alterna clases CSS
   * @param {...string} classes - Clases a alternar
   */
  toggleClass(...classes) {
    classes.forEach(cls => this.element.classList.toggle(cls));
  }

  /**
   * Verifica si tiene una clase
   * @param {string} cls - Clase a verificar
   * @returns {boolean} true si tiene la clase
   */
  hasClass(cls) {
    return this.element.classList.contains(cls);
  }
}

// Clase para manejar eventos
class EventManager {
  constructor(element) {
    this.element = element;
    this._listeners = new Map();
  }

  /**
   * Añade un event listener
   * @param {string} event - Tipo de evento
   * @param {Function} callback - Función a ejecutar
   * @param {Object} options - Opciones del listener
   * @returns {Function} Función para eliminar el listener
   */
  on(event, callback, options = {}) {
    this.element.addEventListener(event, callback, options);

    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);

    return () => this.off(event, callback);
  }

  /**
   * Añade un event listener que se ejecuta una sola vez
   * @param {string} event - Tipo de evento
   * @param {Function} callback - Función a ejecutar
   * @param {Object} options - Opciones del listener
   * @returns {Function} Función para eliminar el listener
   */
  once(event, callback, options = {}) {
    const wrapper = (e) => {
      callback(e);
      this.off(event, wrapper);
    };
    return this.on(event, wrapper, { ...options, once: true });
  }

  /**
   * Elimina un event listener
   * @param {string} event - Tipo de evento
   * @param {Function} callback - Función a eliminar
   */
  off(event, callback) {
    this.element.removeEventListener(event, callback);
    if (this._listeners.has(event)) {
      this._listeners.get(event).delete(callback);
    }
  }

  /**
   * Elimina todos los listeners de un evento
   * @param {string} event - Tipo de evento
   */
  offAll(event) {
    if (this._listeners.has(event)) {
      this._listeners.get(event).forEach(callback => {
        this.element.removeEventListener(event, callback);
      });
      this._listeners.delete(event);
    }
  }

  /**
   * Dispara un evento personalizado
   * @param {string} event - Nombre del evento
   * @param {Object} detail - Datos del evento
   * @param {Object} options - Opciones del evento
   */
  emit(event, detail = {}, options = {}) {
    const customEvent = new CustomEvent(event, {
      detail,
      bubbles: options.bubbles || true,
      cancelable: options.cancelable || true,
      ...options
    });
    this.element.dispatchEvent(customEvent);
  }

  /**
   * Delega eventos a hijos específicos
   * @param {string} event - Tipo de evento
   * @param {string} selector - Selector CSS para los hijos
   * @param {Function} callback - Función a ejecutar
   * @returns {Function} Función para eliminar el listener
   */
  delegate(event, selector, callback) {
    const handler = (e) => {
      const target = e.target.closest(selector);
      if (target && this.element.contains(target)) {
        callback(e, target);
      }
    };
    return this.on(event, handler);
  }
}

// Clase para manejar animaciones
class AnimationManager {
  constructor(element) {
    this.element = element;
    this._animations = new Map();
  }

  /**
   * Aplica una animación CSS
   * @param {string} name - Nombre de la animación
   * @param {Object} options - Opciones de la animación
   */
  animate(name, options = {}) {
    const animation = this.element.animate(
      options.keyframes || [],
      {
        duration: options.duration || 300,
        easing: options.easing || 'ease',
        iterations: options.iterations || 1,
        ...options
      }
    );

    this._animations.set(name, animation);
    return animation;
  }

  /**
   * Aplica una transición CSS
   * @param {Object} properties - Propiedades a transicionar
   * @param {Object} options - Opciones de la transición
   */
  transition(properties, options = {}) {
    this.element.style.transition = `all ${options.duration || 300}ms ${options.easing || 'ease'}`;
    Object.assign(this.element.style, properties);

    return new Promise(resolve => {
      setTimeout(() => {
        this.element.style.transition = '';
        resolve();
      }, options.duration || 300);
    });
  }

  /**
   * Fade in del elemento
   * @param {number} duration - Duración en ms
   * @returns {Promise} Promesa que se resuelve al terminar
   */
  fadeIn(duration = 300) {
    this.element.style.opacity = '0';
    this.element.style.display = this.element.style.display || 'block';

    return this.transition({ opacity: '1' }, { duration });
  }

  /**
   * Fade out del elemento
   * @param {number} duration - Duración en ms
   * @returns {Promise} Promesa que se resuelve al terminar
   */
  fadeOut(duration = 300) {
    return this.transition({ opacity: '0' }, { duration }).then(() => {
      this.element.style.display = 'none';
      this.element.style.opacity = '';
    });
  }

  /**
   * Slide down del elemento
   * @param {number} duration - Duración en ms
   * @returns {Promise} Promesa que se resuelve al terminar
   */
  slideDown(duration = 300) {
    const height = this.element.scrollHeight;
    this.element.style.height = '0';
    this.element.style.overflow = 'hidden';
    this.element.style.display = this.element.style.display || 'block';

    return this.transition({ height: `${height}px` }, { duration }).then(() => {
      this.element.style.height = '';
      this.element.style.overflow = '';
    });
  }

  /**
   * Slide up del elemento
   * @param {number} duration - Duración en ms
   * @returns {Promise} Promesa que se resuelve al terminar
   */
  slideUp(duration = 300) {
    const height = this.element.scrollHeight;
    this.element.style.height = `${height}px`;
    this.element.style.overflow = 'hidden';

    return this.transition({ height: '0' }, { duration }).then(() => {
      this.element.style.display = 'none';
      this.element.style.height = '';
      this.element.style.overflow = '';
    });
  }
}

// Clase para manejar el DOM
class DOMManager {
  constructor(element) {
    this.element = element;
  }

  /**
   * Añade hijos al elemento
   * @param {...(string|HTMLElement)} children - Hijos a añadir
   * @returns {DOMManager} Instancia actual
   */
  append(...children) {
    children.forEach(child => {
      if (typeof child === 'string') {
        this.element.appendChild(document.createTextNode(child));
      } else if (child instanceof HTMLElement) {
        this.element.appendChild(child);
      }
    });
    return this;
  }

  /**
   * Elimina el elemento del DOM
   */
  remove() {
    this.element.parentNode?.removeChild(this.element);
  }

  /**
   * Reemplaza el elemento con otro
   * @param {HTMLElement} newElement - Nuevo elemento
   */
  replaceWith(newElement) {
    this.element.parentNode?.replaceChild(newElement, this.element);
  }

  /**
   * Clona el elemento
   * @param {boolean} deep - Si clona hijos
   * @returns {HTMLElement} Elemento clonado
   */
  clone(deep = true) {
    return this.element.cloneNode(deep);
  }

  /**
   * Obtiene o establece el contenido HTML
   * @param {string} [html] - HTML a establecer
   * @returns {string|DOMManager} HTML o instancia actual
   */
  html(html) {
    if (html === undefined) return this.element.innerHTML;
    this.element.innerHTML = html;
    return this;
  }

  /**
   * Obtiene o establece el contenido de texto
   * @param {string} [text] - Texto a establecer
   * @returns {string|DOMManager} Texto o instancia actual
   */
  text(text) {
    if (text === undefined) return this.element.textContent;
    this.element.textContent = text;
    return this;
  }

  /**
   * Obtiene o establece el valor de un atributo
   * @param {string} name - Nombre del atributo
   * @param {string} [value] - Valor a establecer
   * @returns {string|DOMManager} Valor o instancia actual
   */
  attr(name, value) {
    if (value === undefined) return this.element.getAttribute(name);
    this.element.setAttribute(name, value);
    return this;
  }

  /**
   * Elimina un atributo
   * @param {string} name - Nombre del atributo
   */
  removeAttr(name) {
    this.element.removeAttribute(name);
    return this;
  }

  /**
   * Obtiene o establece un atributo data
   * @param {string} key - Clave del atributo
   * @param {*} [value] - Valor a establecer
   * @returns {*} Valor o instancia actual
   */
  data(key, value) {
    if (value === undefined) {
      return this.element.dataset[key];
    }
    this.element.dataset[key] = typeof value === 'string' ? value : JSON.stringify(value);
    return this;
  }

  /**
   * Busca elementos hijos
   * @param {string} selector - Selector CSS
   * @returns {Array<HTMLElement>} Elementos encontrados
   */
  find(selector) {
    return Array.from(this.element.querySelectorAll(selector));
  }

  /**
   * Busca el primer elemento hijo
   * @param {string} selector - Selector CSS
   * @returns {HTMLElement|null} Elemento encontrado
   */
  findOne(selector) {
    return this.element.querySelector(selector);
  }

  /**
   * Verifica si el elemento coincide con un selector
   * @param {string} selector - Selector CSS
   * @returns {boolean} true si coincide
   */
  matches(selector) {
    return this.element.matches(selector);
  }

  /**
   * Obtiene el elemento padre
   * @param {string} [selector] - Selector para filtrar
   * @returns {HTMLElement|null} Elemento padre
   */
  parent(selector) {
    if (!selector) return this.element.parentElement;
    return this.element.closest(selector);
  }

  /**
   * Obtiene los hermanos del elemento
   * @returns {Array<HTMLElement>} Elementos hermanos
   */
  siblings() {
    return Array.from(this.element.parentElement?.children || []).filter(
      child => child !== this.element
    );
  }

  /**
   * Obtiene el siguiente hermano
   * @returns {HTMLElement|null} Siguiente hermano
   */
  next() {
    return this.element.nextElementSibling;
  }

  /**
   * Obtiene el hermano anterior
   * @returns {HTMLElement|null} Hermano anterior
   */
  prev() {
    return this.element.previousElementSibling;
  }
}

// Clase principal Chunklet
class Chunklet {
  constructor(element, options = {}) {
    if (typeof element === 'string') {
      element = document.querySelector(element);
    }

    if (!element) {
      throw new Error('[Chunklet] Elemento no encontrado');
    }

    this.element = element;
    this.options = options;
    this.data = new DataAttributes(element);
    this.style = new StyleManager(element);
    this.events = new EventManager(element);
    this.animations = new AnimationManager(element);
    this.dom = new DOMManager(element);
    this._behaviors = new Map();
    this._state = {};

    // Inicializar
    this._setup();
  }

  /**
   * Configuración inicial del componente
   */
  _setup() {
    // Procesar atributos data-chunklet
    const behaviors = this.element.dataset.chunklet;
    if (behaviors) {
      behaviors.split(',').map(b => b.trim()).forEach(behavior => {
        this.use(behavior);
      });
    }

    // Emitir evento de inicialización
    this.events.emit('chunklet:init', { instance: this });
  }

  /**
   * Registra un comportamiento
   * @param {string} name - Nombre del comportamiento
   * @param {Function} behavior - Función que define el comportamiento
   */
  static register(name, behavior) {
    if (!Chunklet._behaviors) {
      Chunklet._behaviors = new Map();
    }
    Chunklet._behaviors.set(name, behavior);
  }

  /**
   * Usa un comportamiento registrado
   * @param {string} name - Nombre del comportamiento
   * @param {Object} options - Opciones del comportamiento
   * @returns {Chunklet} Instancia actual
   */
  use(name, options = {}) {
    const behavior = Chunklet._behaviors?.get(name);
    if (!behavior) {
      console.warn(`[Chunklet] Comportamiento "${name}" no registrado`);
      return this;
    }

    const instance = behavior(this, options);
    this._behaviors.set(name, instance);
    return this;
  }

  /**
   * Elimina un comportamiento
   * @param {string} name - Nombre del comportamiento
   * @returns {Chunklet} Instancia actual
   */
  unuse(name) {
    const behavior = this._behaviors.get(name);
    if (behavior && typeof behavior.destroy === 'function') {
      behavior.destroy();
    }
    this._behaviors.delete(name);
    return this;
  }

  /**
   * Obtiene o establece el estado del componente
   * @param {string} key - Clave del estado
   * @param {*} [value] - Valor a establecer
   * @returns {*} Valor o instancia actual
   */
  state(key, value) {
    if (value === undefined) {
      return this._state[key];
    }
    this._state[key] = value;
    this.events.emit('chunklet:statechange', { key, value });
    return this;
  }

  /**
   * Actualiza múltiples valores de estado
   * @param {Object} updates - Objeto con actualizaciones
   * @returns {Chunklet} Instancia actual
   */
  setState(updates = {}) {
    Object.entries(updates).forEach(([key, value]) => {
      this.state(key, value);
    });
    return this;
  }

  /**
   * Obtiene todo el estado
   * @returns {Object} Estado completo
   */
  getState() {
    return { ...this._state };
  }

  /**
   * Renderiza el componente
   * @param {Function|string} content - Contenido a renderizar
   * @returns {Chunklet} Instancia actual
   */
  render(content) {
    if (typeof content === 'function') {
      this.dom.html(content(this._state));
    } else {
      this.dom.html(content);
    }
    this.events.emit('chunklet:render', {});
    return this;
  }

  /**
   * Destruye el componente
   */
  destroy() {
    this._behaviors.forEach((behavior, name) => {
      if (typeof behavior.destroy === 'function') {
        behavior.destroy();
      }
    });
    this._behaviors.clear();
    this.events.offAll('*');
    this.element.remove();
  }

  /**
   * Método estático para crear instancia de Chunklet
   * @param {string|HTMLElement} element - Selector o elemento
   * @param {Object} options - Opciones de configuración
   * @returns {Chunklet} Nueva instancia
   */
  static create(element, options = {}) {
    return new Chunklet(element, options);
  }

  /**
   * Método estático para crear múltiples instancias
   * @param {string} selector - Selector CSS
   * @param {Object} options - Opciones de configuración
   * @returns {Array<Chunklet>} Array de instancias
   */
  static createAll(selector, options = {}) {
    return Array.from(document.querySelectorAll(selector)).map(
      element => new Chunklet(element, options)
    );
  }
}

// Comportamientos predefinidos
Chunklet.register('tooltip', (chunklet, options = {}) => {
  const { text = 'Tooltip', position = 'top' } = options;

  const show = () => {
    const tooltip = document.createElement('div');
    tooltip.className = 'chunklet-tooltip';
    tooltip.textContent = typeof text === 'function' ? text(chunklet) : text;
    tooltip.style.position = 'absolute';
    document.body.appendChild(tooltip);

    const rect = chunklet.element.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    switch (position) {
      case 'top':
        tooltip.style.top = `${rect.top - tooltipRect.height - 5}px`;
        tooltip.style.left = `${rect.left + rect.width / 2 - tooltipRect.width / 2}px`;
        break;
      case 'bottom':
        tooltip.style.top = `${rect.bottom + 5}px`;
        tooltip.style.left = `${rect.left + rect.width / 2 - tooltipRect.width / 2}px`;
        break;
      case 'left':
        tooltip.style.top = `${rect.top + rect.height / 2 - tooltipRect.height / 2}px`;
        tooltip.style.left = `${rect.left - tooltipRect.width - 5}px`;
        break;
      case 'right':
        tooltip.style.top = `${rect.top + rect.height / 2 - tooltipRect.height / 2}px`;
        tooltip.style.left = `${rect.right + 5}px`;
        break;
    }

    chunklet._tooltip = tooltip;
  };

  const hide = () => {
    chunklet._tooltip?.remove();
    chunklet._tooltip = null;
  };

  chunklet.events.on('mouseenter', show);
  chunklet.events.on('mouseleave', hide);

  return {
    show,
    hide,
    destroy() {
      chunklet.events.off('mouseenter', show);
      chunklet.events.off('mouseleave', hide);
      hide();
    }
  };
});

Chunklet.register('toggle', (chunklet, options = {}) => {
  const { target = '.toggle-target', activeClass = 'active' } = options;

  const toggle = () => {
    const targets = chunklet.dom.find(target);
    targets.forEach(t => t.classList.toggle(activeClass));
    chunklet.element.classList.toggle(activeClass);
  };

  chunklet.events.on('click', toggle);

  return {
    toggle,
    destroy() {
      chunklet.events.off('click', toggle);
    }
  };
});

Chunklet.register('ajax', (chunklet, options = {}) => {
  const { url, method = 'GET', data = {}, success, error } = options;

  const fetchData = async () => {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: method !== 'GET' ? JSON.stringify(data) : undefined
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const result = await response.json();
      if (success) success(result);
      chunklet.events.emit('chunklet:ajax:success', { result });

    } catch (err) {
      if (error) error(err);
      chunklet.events.emit('chunklet:ajax:error', { error: err });
    }
  };

  chunklet.events.on('click', fetchData);

  return {
    fetchData,
    destroy() {
      chunklet.events.off('click', fetchData);
    }
  };
});

// Exportar clases
export { Chunklet, DataAttributes, StyleManager, EventManager, AnimationManager, DOMManager };

// Exportar instancia helper
export function createChunklet(element, options = {}) {
  return new Chunklet(element, options);
}

// Exportar utilidades adicionales
export const ChunkletUtils = {
  /**
   * Crea un elemento HTML
   * @param {string} tag - Etiqueta del elemento
   * @param {Object} attributes - Atributos del elemento
   * @param {Array|string} children - Hijos del elemento
   * @returns {HTMLElement} Elemento creado
   */
  createElement(tag, attributes = {}, children = []) {
    const element = document.createElement(tag);

    // Establecer atributos
    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'class') {
        element.className = value;
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(element.style, value);
      } else if (key.startsWith('data-')) {
        element.dataset[key.replace('data-', '')] = value;
      } else {
        element.setAttribute(key, value);
      }
    });

    // Añadir hijos
    if (typeof children === 'string') {
      element.textContent = children;
    } else {
      children.forEach(child => {
        if (typeof child === 'string') {
          element.appendChild(document.createTextNode(child));
        } else if (child instanceof HTMLElement) {
          element.appendChild(child);
        }
      });
    }

    return element;
  },

  /**
   * Serializa un formulario
   * @param {HTMLFormElement} form - Formulario a serializar
   * @returns {Object} Objeto con los datos del formulario
   */
  serializeForm(form) {
    const formData = new FormData(form);
    const data = {};

    formData.forEach((value, key) => {
      if (data[key] !== undefined) {
        if (!Array.isArray(data[key])) {
          data[key] = [data[key]];
        }
        data[key].push(value);
      } else {
        data[key] = value;
      }
    });

    return data;
  },

  /**
   * Detecta el tipo de dispositivo
   * @returns {Object} Información del dispositivo
   */
  detectDevice() {
    const ua = navigator.userAgent;
    return {
      mobile: /Mobile|Android|iPhone/i.test(ua),
      tablet: /Tablet|iPad/i.test(ua),
      desktop: !/Mobile|Android|iPhone|Tablet|iPad/i.test(ua),
      touch: 'ontouchstart' in window,
      os: /Windows/i.test(ua) ? 'windows' :
        /Mac/i.test(ua) ? 'mac' :
          /Linux/i.test(ua) ? 'linux' : 'unknown'
    };
  },

  /**
   * Debounce una función
   * @param {Function} fn - Función a ejecutar
   * @param {number} delay - Retraso en ms
   * @returns {Function} Función con debounce
   */
  debounce(fn, delay = 300) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), delay);
    };
  },

  /**
   * Throttle una función
   * @param {Function} fn - Función a ejecutar
   * @param {number} limit - Límite en ms
   * @returns {Function} Función con throttle
   */
  throttle(fn, limit = 300) {
    let inThrottle;
    return function (...args) {
      if (!inThrottle) {
        fn.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }
};

export default Chunklet;