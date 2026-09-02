/**
 * BinderJS - Form binding (Contrato v0.2.0)
 * Integración con Pulsar para sincronización bidireccional.
 * 
 * Características:
 * - Escribe y lee de Pulsar bajo una clave configurable (por defecto 'form').
 * - Actualiza el DOM cuando el store cambia externamente (via subscribeSelector).
 * - No genera DOM, solo trabaja con elementos existentes.
 */

// ============================================
// FACTORY FUNCTION
// ============================================

export function createBinder(pulsarStore, options = {}) {
  // Validar que el store tenga los métodos necesarios
  if (!pulsarStore || typeof pulsarStore.getState !== 'function' || typeof pulsarStore.setState !== 'function') {
    throw new TypeError('[Binder] pulsarStore debe tener getState y setState');
  }
  if (typeof pulsarStore.subscribeSelector !== 'function') {
    throw new TypeError('[Binder] pulsarStore debe tener subscribeSelector (para escuchar cambios)');
  }

  // Configuración
  const config = {
    key: options.key || 'form',           // Clave principal en Pulsar
    errorKey: options.errorKey || 'errors', // Subclave para errores
    submissionKey: options.submissionKey || 'submitting', // Subclave para estado de envío
    debounce: options.debounce || 0,       // Debounce en ms para inputs
    validateOn: options.validateOn || 'change', // 'input', 'change', 'blur', 'submit'
  };

  // Estado interno
  const _fields = new Map(); // nombre del campo -> { element, path, transform? }
  let _destroyed = false;
  let _unsubscribeStore = null;

  // ============================================
  // UTILIDADES PRIVADAS
  // ============================================

  /**
   * Clona profundamente un objeto (solo valores JSON-serializables).
   */
  function _clone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(item => _clone(item));
    const cloned = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        cloned[key] = _clone(obj[key]);
      }
    }
    return cloned;
  }

  /**
   * Obtiene el valor actual del store para la clave principal.
   * Retorna una copia para evitar mutaciones accidentales.
   */
  function _getFormData() {
    const state = pulsarStore.getState();
    const data = state[config.key] || {};
    return _clone(data); // Clonar para que sea mutable si se modifica
  }

  /**
   * Actualiza el store con un nuevo objeto de datos (shallow merge bajo la clave).
   */
  function _setFormData(data) {
    const current = pulsarStore.getState();
    pulsarStore.setState({
      [config.key]: { ...(current[config.key] || {}), ...data }
    });
  }

  /**
   * Obtiene el valor de una ruta (path) dentro del objeto de datos.
   * Soporta notación de puntos y corchetes (ej. 'user.name', 'items[0].label').
   */
  function _getValueByPath(data, path) {
    const segments = [];
    let current = '';
    for (let i = 0; i < path.length; i++) {
      const char = path[i];
      if (char === '.') {
        if (current) { segments.push(current); current = ''; }
      } else if (char === '[') {
        if (current) { segments.push(current); current = ''; }
        let j = i + 1;
        while (j < path.length && path[j] !== ']') j++;
        if (j < path.length) {
          const index = path.substring(i + 1, j);
          if (/^\d+$/.test(index)) segments.push(index);
          i = j;
        }
      } else {
        current += char;
      }
    }
    if (current) segments.push(current);

    let value = data;
    for (const seg of segments) {
      if (value === null || value === undefined || typeof value !== 'object') return undefined;
      value = value[seg];
    }
    return value;
  }

  /**
   * Establece un valor en una ruta dentro de un objeto (crea objetos intermedios si es necesario).
   * ASUME que el objeto recibido es mutable (no congelado).
   */
  function _setValueByPath(obj, path, value) {
    const segments = [];
    let current = '';
    for (let i = 0; i < path.length; i++) {
      const char = path[i];
      if (char === '.') {
        if (current) { segments.push(current); current = ''; }
      } else if (char === '[') {
        if (current) { segments.push(current); current = ''; }
        let j = i + 1;
        while (j < path.length && path[j] !== ']') j++;
        if (j < path.length) {
          const index = path.substring(i + 1, j);
          if (/^\d+$/.test(index)) segments.push(index);
          i = j;
        }
      } else {
        current += char;
      }
    }
    if (current) segments.push(current);

    let ref = obj;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      if (ref[seg] === undefined || typeof ref[seg] !== 'object') {
        ref[seg] = {};
      }
      ref = ref[seg];
    }
    const last = segments[segments.length - 1];
    ref[last] = value;
  }

  /**
   * Obtiene el valor de un elemento DOM según su tipo.
   */
  function _getElementValue(element) {
    if (element.type === 'checkbox') {
      return element.checked;
    } else if (element.type === 'radio') {
      if (element.checked) return element.value;
      return null;
    } else if (element.type === 'number') {
      return element.value !== '' ? Number(element.value) : null;
    } else if (element.tagName === 'SELECT' && element.multiple) {
      return Array.from(element.selectedOptions).map(opt => opt.value);
    } else {
      return element.value;
    }
  }

  /**
   * Establece el valor de un elemento DOM según su tipo.
   */
  function _setElementValue(element, value) {
    if (element.type === 'checkbox') {
      element.checked = Boolean(value);
    } else if (element.type === 'radio') {
      const radio = element.form?.querySelector(`input[name="${element.name}"][value="${value}"]`);
      if (radio) radio.checked = true;
    } else if (element.type === 'number') {
      element.value = value !== null && value !== undefined ? String(value) : '';
    } else if (element.tagName === 'SELECT' && element.multiple) {
      const selectedValues = Array.isArray(value) ? value : [];
      Array.from(element.options).forEach(opt => {
        opt.selected = selectedValues.includes(opt.value);
      });
    } else {
      element.value = value !== null && value !== undefined ? String(value) : '';
    }
  }

  // ============================================
  // SUSCRIPCIÓN A CAMBIOS DEL STORE
  // ============================================

  /**
   * Escucha cambios en la clave principal y actualiza el DOM.
   */
  function _subscribeToStore() {
    return pulsarStore.subscribeSelector(
      (state) => state[config.key],
      (formData) => {
        if (_destroyed) return;
        // Actualizar cada campo vinculado
        for (const [name, field] of _fields) {
          const value = _getValueByPath(formData, field.path);
          const currentDomValue = _getElementValue(field.element);
          if (value !== currentDomValue) {
            _setElementValue(field.element, value);
          }
        }
      },
      { immediate: true }
    );
  }

  // Iniciar suscripción
  _unsubscribeStore = _subscribeToStore();

  // ============================================
  // API PÚBLICA (CP1)
  // ============================================

  /**
   * Obtiene todos los datos del formulario desde Pulsar.
   */
  function getValues() {
    return _getFormData();
  }

  /**
   * Establece todo el objeto de datos en Pulsar (reemplaza bajo la clave).
   */
  function setValues(data) {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new TypeError('[Binder] setValues: data debe ser un objeto plano');
    }
    _setFormData(data);
  }

  /**
   * Obtiene el valor de un campo específico (por su nombre o path).
   */
  function getValue(name) {
    const data = _getFormData();
    return _getValueByPath(data, name);
  }

  /**
   * Establece el valor de un campo específico en el store.
   * Trabaja sobre una copia mutable para evitar mutar objetos congelados.
   */
  function setValue(name, value) {
    // Obtener una copia mutable del estado actual
    const data = _getFormData(); // ya clonado
    _setValueByPath(data, name, value);
    _setFormData(data);
  }

  /**
   * Destruye el binder: limpia suscripciones y referencias.
   */
  function destroy() {
    if (_destroyed) return;
    _destroyed = true;
    if (_unsubscribeStore) {
      _unsubscribeStore();
      _unsubscribeStore = null;
    }
    _fields.clear();
  }

  // ============================================
  // STUBS para siguientes CP
  // ============================================

  function bind(element) {
    throw new Error('[Binder] bind: Pendiente de implementación (CP2)');
  }

  function unbind(element) {
    throw new Error('[Binder] unbind: Pendiente de implementación (CP2)');
  }

  function validate(validateFn) {
    throw new Error('[Binder] validate: Pendiente de implementación (CP3)');
  }

  function setErrors(errors) {
    throw new Error('[Binder] setErrors: Pendiente de implementación (CP3)');
  }

  function submit(onSubmit) {
    throw new Error('[Binder] submit: Pendiente de implementación (CP4)');
  }

  // ============================================
  // EXPORTACIÓN DE LA API
  // ============================================

  return {
    getValues,
    setValues,
    getValue,
    setValue,
    bind,
    unbind,
    validate,
    setErrors,
    submit,
    destroy,
  };
}

// ============================================
// EXPORTACIÓN POR DEFECTO (Opcional)
// ============================================

export default createBinder;