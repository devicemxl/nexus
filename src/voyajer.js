/**
 * VoyajerJS - URL routing (Contrato v0.2.0)
 * Integración con Pulsar para sincronización bidireccional.
 * 
 * Características:
 * - Escribe el estado de navegación en Pulsar bajo una clave configurable (por defecto 'route').
 * - Escucha eventos popstate y hashchange para actualizar el store.
 * - No manipula el DOM, solo window.history y el store.
 */

export function createVoyajer(pulsarStore, options = {}) {
  // Validar store
  if (!pulsarStore || typeof pulsarStore.getState !== 'function' || typeof pulsarStore.setState !== 'function') {
    throw new TypeError('[Voyajer] pulsarStore debe tener getState y setState');
  }

  // Configuración
  const config = {
    key: options.key || 'route',
    mode: options.mode || 'hash', // 'hash' o 'history'
    base: options.base || '/',
    parse: options.parse || _defaultParse,
    serialize: options.serialize || _defaultSerialize,
    writeOnInit: options.writeOnInit !== undefined ? options.writeOnInit : true,
  };

  // Estado interno
  let _destroyed = false;
  let _currentState = null;
  let _listeners = []; // para eventos de navegación (si se necesitan)

  // ============================================
  // UTILIDADES PRIVADAS
  // ============================================

  /**
   * Parseo por defecto: extrae path, search y hash de la URL.
   */
  function _defaultParse(url) {
    return {
      path: url.pathname,
      search: url.search || '',
      hash: url.hash || '',
    };
  }

  /**
   * Serialización por defecto: construye una URL a partir de path, search y hash.
   */
  function _defaultSerialize(state) {
    const path = state.path || '/';
    const search = state.search || '';
    const hash = state.hash || '';
    return `${path}${search}${hash}`;
  }

  /**
   * Obtiene la ruta actual según el modo (hash o history).
   */
  function _getCurrentPath() {
    if (config.mode === 'hash') {
      const hash = window.location.hash.substring(1);
      return hash || '/';
    } else {
      let path = window.location.pathname;
      if (config.base !== '/') {
        path = path.replace(new RegExp(`^${config.base}`), '');
      }
      return path || '/';
    }
  }

  /**
   * Construye un objeto URL a partir de la ubicación actual.
   */
  function _getCurrentURL() {
    if (config.mode === 'hash') {
      // En modo hash, la URL completa es window.location.href
      // pero el path es lo que está después del #.
      return new URL(window.location.href);
    } else {
      return new URL(window.location.href);
    }
  }

  /**
   * Escribe el estado de navegación en Pulsar.
   */
  function _writeToStore(navigationState) {
    if (_destroyed) return;
    if (!navigationState || typeof navigationState !== 'object') {
      console.warn('[Voyajer] Estado de navegación inválido, no se escribe en el store');
      return;
    }

    const currentState = pulsarStore.getState();
    pulsarStore.setState({
      [config.key]: { ...(currentState[config.key] || {}), ...navigationState }
    });
    _currentState = navigationState;
  }

  /**
   * Sincroniza la URL actual con el store (escucha cambios del navegador).
   */
  function sync() {
    if (_destroyed) return;

    const url = _getCurrentURL();
    const parsed = config.parse(url);

    if (parsed === null) {
      console.warn('[Voyajer] parse retornó null, no se actualiza el store');
      return;
    }

    _writeToStore(parsed);
  }

  // ============================================
  // EVENT LISTENERS DEL NAVEGADOR
  // ============================================

  /**
   * Maneja eventos popstate y hashchange.
   */
  function _handleNavigation() {
    if (_destroyed) return;
    sync();
  }

  // Registrar listeners
  window.addEventListener('popstate', _handleNavigation);
  window.addEventListener('hashchange', _handleNavigation);

  // ============================================
  // API PÚBLICA (CP1)
  // ============================================

  /**
   * Obtiene el estado de navegación actual desde el store.
   */
  function getCurrent() {
    const state = pulsarStore.getState();
    return state[config.key] || null;
  }

  /**
   * Destruye la instancia: limpia event listeners y recursos.
   */
  function destroy() {
    if (_destroyed) return;
    _destroyed = true;
    window.removeEventListener('popstate', _handleNavigation);
    window.removeEventListener('hashchange', _handleNavigation);
    _listeners = [];
  }

  // ============================================
  // STUBS para CP2
  // ============================================

  // ============================================
  // NAVEGACIÓN PROGRAMÁTICA (CP2)
  // ============================================

  /**
   * Navega a un nuevo estado, añadiendo una entrada al historial.
   * @param {Object} state - Estado de navegación a serializar.
   * @throws {Error} Si el estado es inválido o no se puede serializar.
   */
  function push(state) {
    if (_destroyed) {
      throw new Error('[Voyajer] push: instancia destruida');
    }

    if (typeof state !== 'object' || state === null || Array.isArray(state)) {
      throw new TypeError('[Voyajer] push: state debe ser un objeto plano');
    }

    // Serializar el estado a una URL
    const url = config.serialize(state);
    if (typeof url !== 'string' || url === '') {
      throw new Error('[Voyajer] push: serialize retornó una cadena vacía o no válida');
    }

    // Verificar si la URL es igual a la actual (evitar navegaciones redundantes)
    const currentPath = _getCurrentPath();
    if (url === currentPath) {
      console.warn('[Voyajer] push: la URL ya es la actual, no se navega');
      return;
    }

    // Actualizar la URL según el modo
    if (config.mode === 'hash') {
      // En modo hash, solo cambiamos el hash
      window.location.hash = url;
    } else {
      // En modo history, usamos pushState
      window.history.pushState(null, '', config.base + url);
    }

    // Escribir el estado en el store (ya que pushState no dispara popstate)
    _writeToStore(state);
  }

  /**
   * Navega a un nuevo estado, reemplazando la entrada actual del historial.
   * @param {Object} state - Estado de navegación a serializar.
   * @throws {Error} Si el estado es inválido o no se puede serializar.
   */
  function replace(state) {
    if (_destroyed) {
      throw new Error('[Voyajer] replace: instancia destruida');
    }

    if (typeof state !== 'object' || state === null || Array.isArray(state)) {
      throw new TypeError('[Voyajer] replace: state debe ser un objeto plano');
    }

    // Serializar el estado a una URL
    const url = config.serialize(state);
    if (typeof url !== 'string' || url === '') {
      throw new Error('[Voyajer] replace: serialize retornó una cadena vacía o no válida');
    }

    // Verificar si la URL es igual a la actual
    const currentPath = _getCurrentPath();
    if (url === currentPath) {
      console.warn('[Voyajer] replace: la URL ya es la actual, no se navega');
      return;
    }

    // Actualizar la URL según el modo
    if (config.mode === 'hash') {
      // En modo hash, reemplazamos el hash
      window.location.replace(`#${url}`);
    } else {
      // En modo history, usamos replaceState
      window.history.replaceState(null, '', config.base + url);
    }

    // Escribir el estado en el store
    _writeToStore(state);
  }

  function back() {
    throw new Error('[Voyajer] back: Pendiente de implementación (CP3)');
  }

  function forward() {
    throw new Error('[Voyajer] forward: Pendiente de implementación (CP3)');
  }

  function go(delta) {
    throw new Error('[Voyajer] go: Pendiente de implementación (CP3)');
  }

  // ============================================
  // INICIALIZACIÓN
  // ============================================

  // Si writeOnInit es true, escribir el estado inicial en el store
  if (config.writeOnInit) {
    sync();
  }

  // ============================================
  // EXPORTACIÓN DE LA API
  // ============================================

  return {
    push,
    replace,
    back,
    forward,
    go,
    getCurrent,
    sync,
    destroy,
  };
}

// ============================================
// EXPORTACIÓN POR DEFECTO (Opcional)
// ============================================

export default createVoyajer;