/**
 * BinderJS - Form binding
 * Sistema de enlace bidireccional entre formularios y estado
 * 
    Características implementadas:

      Validator - Sistema de validación con reglas personalizadas
      FormField - Manejo individual de campos del formulario
      Binder - Clase principal para enlace bidireccional
      Reglas de validación predefinidas - required, email, minLength, maxLength, number, integer, url, phone, password, confirm
      Eventos - field:change, field:set, field:error, field:reset, field:bind, field:unbind, submit, submit:invalid, validate, reset, fill, destroy
      Soporte para diferentes tipos de input - text, checkbox, radio, number, date, select, textarea
      Transformación de valores - Función personalizada para transformar valores
      Utilidades - serialize, deserialize, getErrors, groupBySection
      
 */

// Clase para manejar validación
class Validator {
  constructor() {
    this._rules = new Map();
    this._messages = new Map();
  }

  /**
   * Registra una regla de validación
   * @param {string} name - Nombre de la regla
   * @param {Function} rule - Función de validación
   * @param {string} message - Mensaje de error
   */
  addRule(name, rule, message = 'Validación fallida') {
    this._rules.set(name, rule);
    this._messages.set(name, message);
  }

  /**
   * Valida un valor contra una regla
   * @param {string} ruleName - Nombre de la regla
   * @param {*} value - Valor a validar
   * @param {Object} context - Contexto adicional
   * @returns {Object} Resultado de la validación
   */
  validate(ruleName, value, context = {}) {
    const rule = this._rules.get(ruleName);
    if (!rule) {
      return { valid: true, message: '' };
    }

    const result = rule(value, context);
    if (typeof result === 'boolean') {
      return {
        valid: result,
        message: result ? '' : this._messages.get(ruleName) || 'Validación fallida'
      };
    }

    return result;
  }

  /**
   * Valida múltiples reglas
   * @param {Array<string>} ruleNames - Nombres de las reglas
   * @param {*} value - Valor a validar
   * @param {Object} context - Contexto adicional
   * @returns {Object} Resultado de la validación
   */
  validateAll(ruleNames, value, context = {}) {
    for (const ruleName of ruleNames) {
      const result = this.validate(ruleName, value, context);
      if (!result.valid) {
        return result;
      }
    }
    return { valid: true, message: '' };
  }
}

// Clase para manejar un campo del formulario
class FormField {
  constructor(binder, name, element, options = {}) {
    this.binder = binder;
    this.name = name;
    this.element = element;
    this.options = {
      type: 'text',
      validateOn: 'blur', // 'blur', 'input', 'submit'
      rules: [],
      transform: null,
      defaultValue: '',
      ...options
    };

    this._value = this.options.defaultValue;
    this._error = '';
    this._touched = false;
    this._dirty = false;

    this._setupListeners();
    this._setupValidation();
  }

  /**
   * Configura los listeners del campo
   */
  _setupListeners() {
    const eventType = this.element.tagName === 'SELECT' ? 'change' : 'input';

    this.element.addEventListener(eventType, (e) => {
      const value = this._getElementValue();
      this._value = value;
      this._dirty = true;

      if (this.options.transform) {
        const transformed = this.options.transform(value);
        this._setElementValue(transformed);
        this._value = transformed;
      }

      this.binder.emit('field:change', { field: this, value: this._value });

      if (this.options.validateOn === 'input') {
        this.validate();
      }
    });

    this.element.addEventListener('blur', () => {
      this._touched = true;
      if (this.options.validateOn === 'blur') {
        this.validate();
      }
    });
  }

  /**
   * Configura la validación del campo
   */
  _setupValidation() {
    if (this.options.rules.length > 0) {
      this.validator = new Validator();
      this.options.rules.forEach(rule => {
        if (typeof rule === 'string') {
          // Regla predefinida
          const predefined = this.binder.getRule(rule);
          if (predefined) {
            this.validator.addRule(rule, predefined.rule, predefined.message);
          }
        } else if (typeof rule === 'object' && rule.name) {
          // Regla personalizada
          this.validator.addRule(rule.name, rule.rule, rule.message);
        }
      });
    }
  }

  /**
   * Obtiene el valor del elemento
   * @returns {*} Valor del elemento
   */
  _getElementValue() {
    switch (this.element.type) {
      case 'checkbox':
        return this.element.checked;
      case 'radio':
        return this.element.checked ? this.element.value : null;
      case 'number':
        return this.element.value ? Number(this.element.value) : null;
      case 'date':
        return this.element.value ? new Date(this.element.value) : null;
      default:
        return this.element.value;
    }
  }

  /**
   * Establece el valor del elemento
   * @param {*} value - Valor a establecer
   */
  _setElementValue(value) {
    switch (this.element.type) {
      case 'checkbox':
        this.element.checked = Boolean(value);
        break;
      case 'radio':
        this.element.checked = this.element.value === String(value);
        break;
      case 'number':
        this.element.value = value !== null ? String(value) : '';
        break;
      case 'date':
        this.element.value = value ? value.toISOString().split('T')[0] : '';
        break;
      default:
        this.element.value = value !== null ? String(value) : '';
    }
  }

  /**
   * Obtiene el valor del campo
   * @returns {*} Valor del campo
   */
  get value() {
    return this._value;
  }

  /**
   * Establece el valor del campo
   * @param {*} value - Valor a establecer
   */
  set value(value) {
    this._value = value;
    this._setElementValue(value);
    this.binder.emit('field:set', { field: this, value });
  }

  /**
   * Obtiene el error del campo
   * @returns {string} Mensaje de error
   */
  get error() {
    return this._error;
  }

  /**
   * Establece el error del campo
   * @param {string} message - Mensaje de error
   */
  set error(message) {
    this._error = message;
    this.element.classList.toggle('has-error', Boolean(message));
    this.binder.emit('field:error', { field: this, error: message });
  }

  /**
   * Verifica si el campo ha sido tocado
   * @returns {boolean} true si ha sido tocado
   */
  get touched() {
    return this._touched;
  }

  /**
   * Verifica si el campo ha sido modificado
   * @returns {boolean} true si ha sido modificado
   */
  get dirty() {
    return this._dirty;
  }

  /**
   * Valida el campo
   * @returns {boolean} true si es válido
   */
  validate() {
    if (!this.validator) return true;

    const ruleNames = this.options.rules
      .filter(rule => typeof rule === 'string' || rule.name)
      .map(rule => typeof rule === 'string' ? rule : rule.name);

    const result = this.validator.validateAll(ruleNames, this._value, {
      field: this,
      binder: this.binder
    });

    this.error = result.valid ? '' : result.message;
    return result.valid;
  }

  /**
   * Resetea el campo
   */
  reset() {
    this._value = this.options.defaultValue;
    this._setElementValue(this.options.defaultValue);
    this._error = '';
    this._touched = false;
    this._dirty = false;
    this.element.classList.remove('has-error');
    this.binder.emit('field:reset', { field: this });
  }

  /**
   * Marca el campo como tocado
   */
  markAsTouched() {
    this._touched = true;
  }

  /**
   * Marca el campo como no tocado
   */
  markAsUntouched() {
    this._touched = false;
  }

  /**
   * Marca el campo como modificado
   */
  markAsDirty() {
    this._dirty = true;
  }

  /**
   * Marca el campo como no modificado
   */
  markAsPristine() {
    this._dirty = false;
  }
}

// Clase principal Binder
class Binder {
  constructor(form, options = {}) {
    this.form = typeof form === 'string' ? document.querySelector(form) : form;

    if (!this.form) {
      throw new Error('[Binder] Formulario no encontrado');
    }

    this.options = {
      autoBind: true,
      validateOnSubmit: true,
      showErrors: true,
      errorClass: 'field-error',
      successClass: 'field-success',
      ...options
    };

    this.fields = new Map();
    this._listeners = new Map();
    this._rules = new Map();
    this._data = {};

    this._setupDefaultRules();

    if (this.options.autoBind) {
      this.bindAll();
    }

    this._setupFormSubmit();
  }

  /**
   * Configura reglas de validación predefinidas
   */
  _setupDefaultRules() {
    this.addRule('required', (value) => value !== null && value !== undefined && value !== '', 'Este campo es requerido');
    this.addRule('email', (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), 'Email inválido');
    this.addRule('minLength', (value, context) => {
      const min = context.field?.options.minLength || 0;
      return !value || value.length >= min;
    }, 'Longitud mínima no cumplida');
    this.addRule('maxLength', (value, context) => {
      const max = context.field?.options.maxLength || Infinity;
      return !value || value.length <= max;
    }, 'Longitud máxima excedida');
    this.addRule('number', (value) => !value || !isNaN(Number(value)), 'Debe ser un número');
    this.addRule('integer', (value) => !value || Number.isInteger(Number(value)), 'Debe ser un entero');
    this.addRule('url', (value) => !value || /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/.test(value), 'URL inválida');
    this.addRule('phone', (value) => !value || /^[\d\s()+-]{7,15}$/.test(value), 'Teléfono inválido');
    this.addRule('password', (value) => !value || value.length >= 6, 'La contraseña debe tener al menos 6 caracteres');
    this.addRule('confirm', (value, context) => {
      const confirmField = context.binder?.getField(context.field?.options.confirmField);
      return !value || !confirmField || value === confirmField.value;
    }, 'Las contraseñas no coinciden');
  }

  /**
   * Registra una regla de validación
   * @param {string} name - Nombre de la regla
   * @param {Function} rule - Función de validación
   * @param {string} message - Mensaje de error
   */
  addRule(name, rule, message) {
    this._rules.set(name, { rule, message });
  }

  /**
   * Obtiene una regla de validación
   * @param {string} name - Nombre de la regla
   * @returns {Object|null} Regla o null
   */
  getRule(name) {
    return this._rules.get(name) || null;
  }

  /**
   * Vincula todos los campos del formulario
   */
  bindAll() {
    // Inputs
    this.form.querySelectorAll('input, select, textarea').forEach(element => {
      this.bindField(element);
    });
  }

  /**
   * Vincula un campo específico
   * @param {string|HTMLElement} element - Elemento o selector
   * @returns {FormField} Campo vinculado
   */
  bindField(element) {
    if (typeof element === 'string') {
      element = this.form.querySelector(element);
    }

    if (!element) return null;

    const name = element.name || element.id;
    if (!name) return null;

    // Si ya está vinculado, retornar el existente
    if (this.fields.has(name)) {
      return this.fields.get(name);
    }

    const options = {
      type: element.type || 'text',
      defaultValue: element.value,
      rules: (element.dataset.rules || '').split(',').map(r => r.trim()).filter(Boolean),
      validateOn: element.dataset.validateOn || 'blur',
      minLength: Number(element.dataset.minLength) || undefined,
      maxLength: Number(element.dataset.maxLength) || undefined,
      confirmField: element.dataset.confirmField
    };

    const field = new FormField(this, name, element, options);
    this.fields.set(name, field);

    // Inicializar valor
    if (element.value) {
      this._data[name] = field.value;
    }

    this.emit('field:bind', { field });

    return field;
  }

  /**
   * Desvincula un campo
   * @param {string} name - Nombre del campo
   */
  unbindField(name) {
    const field = this.fields.get(name);
    if (field) {
      this.fields.delete(name);
      this.emit('field:unbind', { field });
    }
  }

  /**
   * Obtiene un campo vinculado
   * @param {string} name - Nombre del campo
   * @returns {FormField|undefined} Campo vinculado
   */
  getField(name) {
    return this.fields.get(name);
  }

  /**
   * Obtiene todos los campos vinculados
   * @returns {Array<FormField>} Array de campos
   */
  getFields() {
    return Array.from(this.fields.values());
  }

  /**
   * Obtiene el valor de un campo
   * @param {string} name - Nombre del campo
   * @returns {*} Valor del campo
   */
  getValue(name) {
    return this.fields.get(name)?.value;
  }

  /**
   * Establece el valor de un campo
   * @param {string} name - Nombre del campo
   * @param {*} value - Valor a establecer
   */
  setValue(name, value) {
    const field = this.fields.get(name);
    if (field) {
      field.value = value;
      this._data[name] = value;
    }
  }

  /**
   * Obtiene todos los datos del formulario
   * @returns {Object} Datos del formulario
   */
  getData() {
    const data = {};
    this.fields.forEach((field, name) => {
      data[name] = field.value;
    });
    return data;
  }

  /**
   * Establece múltiples valores
   * @param {Object} data - Objeto con los valores
   */
  setData(data = {}) {
    Object.entries(data).forEach(([key, value]) => {
      this.setValue(key, value);
    });
  }

  /**
   * Valida todos los campos
   * @returns {boolean} true si todos son válidos
   */
  validateAll() {
    let valid = true;

    this.fields.forEach(field => {
      const fieldValid = field.validate();
      if (!fieldValid) {
        valid = false;
        if (this.options.showErrors) {
          this._showFieldError(field);
        }
      }
    });

    this.emit('validate', { valid });
    return valid;
  }

  /**
   * Muestra el error de un campo
   * @param {FormField} field - Campo con error
   */
  _showFieldError(field) {
    // Eliminar error anterior
    const existingError = field.element.parentElement?.querySelector(`.${this.options.errorClass}`);
    if (existingError) {
      existingError.remove();
    }

    // Crear mensaje de error
    if (field.error) {
      const errorElement = document.createElement('span');
      errorElement.className = this.options.errorClass;
      errorElement.textContent = field.error;
      field.element.parentElement?.appendChild(errorElement);
    }
  }

  /**
   * Configura el submit del formulario
   */
  _setupFormSubmit() {
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();

      if (this.options.validateOnSubmit && !this.validateAll()) {
        this.emit('submit:invalid', { binder: this });
        return;
      }

      const data = this.getData();
      this.emit('submit', { data, binder: this });
    });
  }

  /**
   * Suscribe una función a un evento
   * @param {string} event - Nombre del evento
   * @param {Function} callback - Función a ejecutar
   * @returns {Function} Función para cancelar la suscripción
   */
  subscribe(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);

    return () => this.unsubscribe(event, callback);
  }

  /**
   * Cancela la suscripción a un evento
   * @param {string} event - Nombre del evento
   * @param {Function} callback - Función a eliminar
   */
  unsubscribe(event, callback) {
    this._listeners.get(event)?.delete(callback);
  }

  /**
   * Emite un evento
   * @param {string} event - Nombre del evento
   * @param {Object} data - Datos del evento
   */
  emit(event, data = {}) {
    this._listeners.get(event)?.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`[Binder] Error en listener de ${event}:`, error);
      }
    });
  }

  /**
   * Resetea el formulario
   */
  reset() {
    this.fields.forEach(field => field.reset());
    this._data = {};
    this.emit('reset', {});
  }

  /**
   * Llena el formulario desde datos externos
   * @param {Object} data - Datos para llenar
   */
  fill(data = {}) {
    this.setData(data);
    this.emit('fill', { data });
  }

  /**
   * Verifica si el formulario es válido
   * @returns {boolean} true si es válido
   */
  isValid() {
    return this.validateAll();
  }

  /**
   * Verifica si el formulario ha sido modificado
   * @returns {boolean} true si ha sido modificado
   */
  isDirty() {
    return Array.from(this.fields.values()).some(field => field.dirty);
  }

  /**
   * Verifica si el formulario ha sido tocado
   * @returns {boolean} true si ha sido tocado
   */
  isTouched() {
    return Array.from(this.fields.values()).some(field => field.touched);
  }

  /**
   * Destruye el binder
   */
  destroy() {
    this.fields.clear();
    this._listeners.clear();
    this._rules.clear();
    this.emit('destroy', {});
  }

  /**
   * Método estático para crear instancia de Binder
   * @param {string|HTMLFormElement} form - Selector o elemento formulario
   * @param {Object} options - Opciones de configuración
   * @returns {Binder} Nueva instancia
   */
  static create(form, options = {}) {
    return new Binder(form, options);
  }

  /**
   * Método estático para validar un valor
   * @param {*} value - Valor a validar
   * @param {Array} rules - Reglas de validación
   * @returns {Object} Resultado de la validación
   */
  static validate(value, rules = []) {
    const validator = new Validator();

    rules.forEach(rule => {
      if (typeof rule === 'string') {
        // Regla predefinida
        const predefined = this._defaultRules?.[rule];
        if (predefined) {
          validator.addRule(rule, predefined.rule, predefined.message);
        }
      } else if (rule.name) {
        validator.addRule(rule.name, rule.rule, rule.message);
      }
    });

    const ruleNames = rules
      .filter(rule => typeof rule === 'string' || rule.name)
      .map(rule => typeof rule === 'string' ? rule : rule.name);

    return validator.validateAll(ruleNames, value);
  }
}

// Reglas estáticas predefinidas
Binder._defaultRules = {
  required: {
    rule: (value) => value !== null && value !== undefined && value !== '',
    message: 'Este campo es requerido'
  },
  email: {
    rule: (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    message: 'Email inválido'
  },
  number: {
    rule: (value) => !value || !isNaN(Number(value)),
    message: 'Debe ser un número'
  },
  url: {
    rule: (value) => !value || /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/.test(value),
    message: 'URL inválida'
  }
};

// Exportar clases
export { Binder, FormField, Validator };

// Exportar instancia helper
export function createBinder(form, options = {}) {
  return new Binder(form, options);
}

// Exportar utilidades adicionales
export const BinderUtils = {
  /**
   * Serializa un formulario a JSON
   * @param {HTMLFormElement} form - Formulario a serializar
   * @returns {Object} Datos del formulario
   */
  serialize(form) {
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
   * Deserializa datos a un formulario
   * @param {HTMLFormElement} form - Formulario a llenar
   * @param {Object} data - Datos para llenar
   */
  deserialize(form, data = {}) {
    Object.entries(data).forEach(([key, value]) => {
      const element = form.elements[key];
      if (element) {
        if (element.type === 'checkbox') {
          element.checked = Boolean(value);
        } else if (element.type === 'radio') {
          const radio = form.querySelector(`input[name="${key}"][value="${value}"]`);
          if (radio) radio.checked = true;
        } else {
          element.value = value;
        }
      }
    });
  },

  /**
   * Obtiene los errores de un formulario
   * @param {Binder} binder - Instancia de Binder
   * @returns {Object} Objeto con los errores
   */
  getErrors(binder) {
    const errors = {};
    binder.getFields().forEach(field => {
      if (field.error) {
        errors[field.name] = field.error;
      }
    });
    return errors;
  },

  /**
   * Agrupa campos por sección
   * @param {Binder} binder - Instancia de Binder
   * @returns {Object} Campos agrupados
   */
  groupBySection(binder) {
    const groups = {};
    binder.getFields().forEach(field => {
      const section = field.element.dataset.section || 'default';
      if (!groups[section]) {
        groups[section] = [];
      }
      groups[section].push(field);
    });
    return groups;
  }
};

export default Binder;