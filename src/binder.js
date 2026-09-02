/**
 * BinderJS - Form binding (Contrato v0.2.0)
 * Integración con Pulsar para sincronización bidireccional.
 * 
 * Características:
 * - Escribe y lee de Pulsar bajo una clave configurable (por defecto 'form').
 * - Actualiza el DOM cuando el store cambia externamente (via subscribeSelector).
 * - No genera DOM, solo trabaja con elementos existentes.
 * 
 * CP1: Estructura y fábrica
 * CP2: Binding de campos
 * CP3: Validación y errores
 */

export function createBinder(pulsarStore, options = {}) {
  // Validar store
  if (!pulsarStore || typeof pulsarStore.getState !== 'function' || typeof pulsarStore.setState !== 'function') {
    throw new TypeError('[Binder] pulsarStore debe tener getState y setState');
  }
  if (typeof pulsarStore.subscribeSelector !== 'function') {
    throw new TypeError('[Binder] pulsarStore debe tener subscribeSelector');
  }

  const config = {
    key: options.key || 'form',
    errorKey: options.errorKey || 'errors',
    submissionKey: options.submissionKey || 'submitting',
    debounce: options.debounce || 0,
    validateOn: options.validateOn || 'change',
  };

  // Estado interno
  const _fields = new Map(); // path -> { element, listeners }
  let _destroyed = false;
  let _unsubscribeStore = null;

  // ============================================
  // UTILIDADES (clonación, paths, etc.)
  // ============================================

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

  function _getFormData() {
    const state = pulsarStore.getState();
    const data = state[config.key] || {};
    return _clone(data);
  }

  function _setFormData(data) {
    const current = pulsarStore.getState();
    pulsarStore.setState({
      [config.key]: { ...(current[config.key] || {}), ...data }
    });
  }

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

  function _getElementValue(element) {
    if (element.type === 'checkbox') return element.checked;
    if (element.type === 'radio') return element.checked ? element.value : null;
    if (element.type === 'number') return element.value !== '' ? Number(element.value) : null;
    if (element.tagName === 'SELECT' && element.multiple) {
      return Array.from(element.selectedOptions).map(opt => opt.value);
    }
    return element.value;
  }

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
  // SUSCRIPCIÓN AL STORE (actualiza DOM)
  // ============================================

  function _subscribeToStore() {
    return pulsarStore.subscribeSelector(
      (state) => state[config.key],
      (formData) => {
        if (_destroyed) return;
        for (const [path, field] of _fields) {
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

  // ============================================
  // BINDING (CP2)
  // ============================================

  function bind(element) {
    if (_destroyed) throw new Error('[Binder] bind: Binder ya fue destruido');

    let target = element;
    if (typeof element === 'string') {
      target = document.querySelector(element);
      if (!target) {
        throw new Error(`[Binder] bind: Elemento "${element}" no encontrado`);
      }
    }

    if (target.tagName === 'FORM') {
      const inputs = target.querySelectorAll('[data-bind], input[name], select[name], textarea[name]');
      inputs.forEach(el => _bindSingle(el));
    } else {
      _bindSingle(target);
    }
  }

  function _bindSingle(element) {
    let path = element.getAttribute('data-bind') || element.getAttribute('name');
    if (!path) {
      console.warn('[Binder] Elemento sin data-bind ni name:', element);
      return;
    }

    if (_fields.has(path)) {
      console.warn(`[Binder] El campo "${path}" ya está vinculado`);
      return;
    }

    const field = {
      element,
      path,
      listeners: [],
    };

    function handleInput() {
      const value = _getElementValue(element);
      const currentData = _getFormData();
      _setValueByPath(currentData, path, value);
      _setFormData(currentData);
    }

    let eventType = 'input';
    if (element.type === 'checkbox' || element.type === 'radio' || element.tagName === 'SELECT') {
      eventType = 'change';
    }

    element.addEventListener(eventType, handleInput);
    field.listeners.push({ event: eventType, handler: handleInput });
    _fields.set(path, field);

    // Inicializar DOM desde store
    const formData = _getFormData();
    const initialValue = _getValueByPath(formData, path);
    if (initialValue !== undefined) {
      _setElementValue(element, initialValue);
    }
  }

  function unbind(element) {
    let target = element;
    if (typeof element === 'string') {
      target = document.querySelector(element);
      if (!target) return;
    }

    if (target.tagName === 'FORM') {
      const inputs = target.querySelectorAll('[data-bind], input[name], select[name], textarea[name]');
      inputs.forEach(el => _unbindSingle(el));
    } else {
      _unbindSingle(target);
    }
  }

  function _unbindSingle(element) {
    let path = element.getAttribute('data-bind') || element.getAttribute('name');
    if (!path) return;

    const field = _fields.get(path);
    if (!field) return;

    field.listeners.forEach(({ event, handler }) => {
      element.removeEventListener(event, handler);
    });
    _fields.delete(path);
  }

  // ============================================
  // VALIDACIÓN (CP3)
  // ============================================

  /**
   * Valida los datos del formulario usando una función proporcionada.
   * @param {Function} validateFn - función que recibe los datos y devuelve un objeto de errores { path: 'mensaje' } o null.
   * @returns {Object|null} - Objeto de errores o null si no hay errores.
   */
  function validate(validateFn) {
    if (typeof validateFn !== 'function') {
      throw new TypeError('[Binder] validate: validateFn debe ser una función');
    }

    const data = _getFormData();
    const errors = validateFn(data);

    // Almacenar errores en Pulsar bajo la clave de errores
    const currentState = pulsarStore.getState();
    const errorData = (errors && typeof errors === 'object' && !Array.isArray(errors)) ? errors : null;

    const currentFormData = currentState[config.key] || {};
    pulsarStore.setState({
      [config.key]: {
        ...currentFormData,
        [config.errorKey]: errorData
      }
    });

    return errorData;
  }

  /**
   * Establece manualmente un objeto de errores.
   * @param {Object|null} errors - objeto de errores { path: 'mensaje' } o null para borrar.
   */
  function setErrors(errors) {
    if (errors !== null && (typeof errors !== 'object' || Array.isArray(errors))) {
      throw new TypeError('[Binder] setErrors: errors debe ser un objeto o null');
    }

    const currentState = pulsarStore.getState();
    const currentFormData = currentState[config.key] || {};
    pulsarStore.setState({
      [config.key]: {
        ...currentFormData,
        [config.errorKey]: errors
      }
    });
  }

  // ============================================
  // STUB PARA CP4 (submit)
  // ============================================

  function submit(onSubmit) {
    throw new Error('[Binder] submit: Pendiente de implementación (CP4)');
  }

  // ============================================
  // API PÚBLICA (CP1, CP2, CP3)
  // ============================================

  function getValues() { return _getFormData(); }

  function setValues(data) {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new TypeError('[Binder] setValues: data debe ser un objeto plano');
    }
    _setFormData(data);
  }

  function getValue(name) {
    const data = _getFormData();
    return _getValueByPath(data, name);
  }

  function setValue(name, value) {
    const data = _getFormData();
    _setValueByPath(data, name, value);
    _setFormData(data);
  }

  function destroy() {
    if (_destroyed) return;
    _destroyed = true;
    if (_unsubscribeStore) {
      _unsubscribeStore();
      _unsubscribeStore = null;
    }
    for (const [path, field] of _fields) {
      _unbindSingle(field.element);
    }
    _fields.clear();
  }

  // Iniciar suscripción al store
  _unsubscribeStore = _subscribeToStore();

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

export default createBinder;