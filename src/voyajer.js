/**
 * VoyajerJS - URL routing (Contrato v0.2.0)
 * Integración con Pulsar para sincronización bidireccional.
 * 
 * Características:
 * - Escribe el estado de navegación en Pulsar bajo una clave configurable (por defecto 'route').
 * - Escucha eventos popstate y hashchange para actualizar el store.
 * - Navegación programática con push, replace, back, forward, go.
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

  function _defaultParse(url) {
    return {
      path: url.pathname,
      search: url.search || '',
      hash: url.hash || '',
    };
  }

  function _defaultSerialize(state) {
    const path = state.path || '/';
    const search = state.search || '';
    const hash = state.hash || '';
    return `${path}${search}${hash}`;
  }

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

  function _getCurrentURL() {
    return new URL(window.location.href);
  }

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
   * Sincroniza la URL actual con el store.
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
  // NAVEGACIÓN PROGRAMÁTICA (CP2)
  // ============================================

  /**
   * Navega a un nuevo estado, añadiendo una entrada al historial.
   */
  function push(state) {
    if (_destroyed) return;
    if (typeof state !== 'object' || state === null) {
      throw new TypeError('[Voyajer] push: state debe ser un objeto');
    }

    const url = config.serialize(state);
    if (url === null || url === undefined) {
      console.warn('[Voyajer] serialize retornó null, no se navega');
      return;
    }

    const currentPath = _getCurrentPath();
    if (url === currentPath) return; // no-op si es la misma URL

    // Actualizar historial
    if (config.mode === 'hash') {
      window.location.hash = url;
    } else {
      window.history.pushState(null, '', config.base + url);
    }

    // Actualizar store (sync)
    sync();
  }

  /**
   * Navega a un nuevo estado, reemplazando la entrada actual del historial.
   */
  function replace(state) {
    if (_destroyed) return;
    if (typeof state !== 'object' || state === null) {
      throw new TypeError('[Voyajer] replace: state debe ser un objeto');
    }

    const url = config.serialize(state);
    if (url === null || url === undefined) {
      console.warn('[Voyajer] serialize retornó null, no se navega');
      return;
    }

    const currentPath = _getCurrentPath();
    if (url === currentPath) return;

    if (config.mode === 'hash') {
      window.location.replace(`#${url}`);
    } else {
      window.history.replaceState(null, '', config.base + url);
    }

    sync();
  }

  // ============================================
  // HISTORIAL Y NAVEGACIÓN (CP3)
  // ============================================

  /**
   * Retrocede una página en el historial.
   */
  function back() {
    if (_destroyed) return;
    window.history.back();
    // El evento popstate llamará a sync()
  }

  /**
   * Avanza una página en el historial.
   */
  function forward() {
    if (_destroyed) return;
    window.history.forward();
    // El evento popstate llamará a sync()
  }

  /**
   * Navega un número específico de pasos en el historial.
   * @param {number} delta - Número positivo (avanzar) o negativo (retroceder).
   */
  function go(delta) {
    if (_destroyed) return;
    if (typeof delta !== 'number') {
      throw new TypeError('[Voyajer] go: delta debe ser un número');
    }
    window.history.go(delta);
    // El evento popstate llamará a sync()
  }

  // ============================================
  // EVENT LISTENERS DEL NAVEGADOR
  // ============================================

  function _handleNavigation() {
    if (_destroyed) return;
    sync();
  }

  window.addEventListener('popstate', _handleNavigation);
  window.addEventListener('hashchange', _handleNavigation);

  // ============================================
  // API PÚBLICA
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
  // INICIALIZACIÓN
  // ============================================

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