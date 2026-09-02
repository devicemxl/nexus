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
    key: options.key || 'form',
    errorKey: options.errorKey || 'errors',
    submissionKey: options.submissionKey || 'submitting',
    debounce: options.debounce || 0,
    validateOn: options.validateOn || 'change',
  };

  // Estado interno
  const _fields = new Map(); // name -> { element, path, unbindFn }
  let _destroyed = false;
  let _unsubscribeStore = null;

  // ============================================
  // UTILIDADES PRIVADAS
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

  function _subscribeToStore() {
    return pulsarStore.subscribeSelector(
      (state) => state[config.key],
      (formData) => {
        if (_destroyed) return;
        // Actualizar cada campo vinculado
        for (const [name, field] of _fields) {
          const value = _getValueByPath(formData, field.path);
          const currentDomValue = _getElementValue(field.element);
          // Solo actualizar si el valor del DOM es diferente al del store (evitar bucles)
          if (value !== currentDomValue) {
            _setElementValue(field.element, value);
          }
        }
      },
      { immediate: true }
    );
  }

  _unsubscribeStore = _subscribeToStore();

  // ============================================
  // BINDING (CP2)
  // ============================================

  /**
   * Vincula un elemento o un contenedor de elementos al store.
   */
  function bind(element) {
    if (_destroyed) {
      throw new Error('[Binder] bind: El binder ya fue destruido');
    }

    // Si es un contenedor, vincular todos los descendientes con data-bind
    if (element.querySelectorAll) {
      const elements = element.querySelectorAll('[data-bind]');
      if (elements.length === 0 && element.hasAttribute('data-bind')) {
        // Es un solo elemento con data-bind
        _bindSingle(element);
      } else {
        elements.forEach(el => _bindSingle(el));
      }
      return;
    }

    // Si es un elemento individual
    _bindSingle(element);
  }

  /**
   * Vincula un solo elemento.
   */
  function _bindSingle(element) {
    const path = element.getAttribute('data-bind');
    if (!path) {
      console.warn('[Binder] Elemento sin data-bind, ignorado');
      return;
    }

    // Usar path como nombre único para el campo
    const name = path;

    // Si ya está vinculado, no hacer nada
    if (_fields.has(name)) {
      return;
    }

    // Determinar el evento a escuchar según el tipo de input
    let eventType = 'input';
    if (element.type === 'checkbox' || element.type === 'radio' || element.tagName === 'SELECT') {
      eventType = 'change';
    }

    // Crear el handler que actualiza el store
    const handler = (e) => {
      if (_destroyed) return;

      // Obtener el valor actual del DOM
      const domValue = _getElementValue(element);

      // Obtener el valor actual del store para evitar bucles
      const currentData = _getFormData();
      const storeValue = _getValueByPath(currentData, path);

      // Solo actualizar si el valor cambió realmente
      if (domValue !== storeValue) {
        // Actualizar el store (setValue actualiza el store y notifica a los suscriptores)
        // Pero cuidado: setValue llamará a _setFormData, que dispara la suscripción.
        // Para evitar un bucle, la suscripción ya se encarga de NO actualizar el DOM si el valor es igual.
        setValue(path, domValue);
      }
    };

    // Añadir el listener
    element.addEventListener(eventType, handler);

    // Registrar el campo
    _fields.set(name, {
      element,
      path,
      unbindFn: () => {
        element.removeEventListener(eventType, handler);
      }
    });

    // Establecer el valor inicial desde el store
    const initialData = _getFormData();
    const initialValue = _getValueByPath(initialData, path);
    if (initialValue !== undefined) {
      _setElementValue(element, initialValue);
    }
  }

  /**
   * Desvincula un elemento o contenedor.
   */
  function unbind(element) {
    if (_destroyed) return;

    if (element.querySelectorAll) {
      const elements = element.querySelectorAll('[data-bind]');
      if (elements.length === 0 && element.hasAttribute('data-bind')) {
        _unbindSingle(element);
      } else {
        elements.forEach(el => _unbindSingle(el));
      }
      return;
    }

    _unbindSingle(element);
  }

  function _unbindSingle(element) {
    const path = element.getAttribute('data-bind');
    if (!path) return;

    const field = _fields.get(path);
    if (field) {
      // Ejecutar la función de unbind para eliminar listeners
      if (field.unbindFn) {
        field.unbindFn();
      }
      _fields.delete(path);
    }
  }

  // ============================================
  // API PÚBLICA
  // ============================================

  function getValues() {
    return _getFormData();
  }

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
    // Desvincular todos los campos
    for (const [name, field] of _fields) {
      if (field.unbindFn) {
        field.unbindFn();
      }
    }
    _fields.clear();
  }

  // Stubs para CP3 y CP4
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