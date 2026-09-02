/**
 * VoyajerJS - URL routing (Contrato v0.2.1, código v0.2.1)
 * Integración con Pulsar para sincronización bidireccional.
 *
 * Cambios respecto a v0.2.0:
 * - Default de `mode` cambia de 'hash' a 'history', alineado con
 *   `_defaultParse` que asume URLs con pathname significativo.
 * - En modo 'hash', la URL se normaliza a una URL virtual antes de
 *   pasarla al `parse` configurado, para que los parsers no necesiten
 *   conocer el modo. El contenido del hash aparece como pathname en
 *   la URL virtual.
 * - `push` y `replace` ahora son idempotentes: si la URL serializada
 *   coincide con la actual, retornan sin navegar ni notificar.
 * - El regex construido a partir de `base` escapa caracteres especiales
 *   para evitar interpretación inesperada.
 *
 * Características:
 * - Escribe el estado de navegación en Pulsar bajo una clave configurable (por defecto 'route').
 * - Escucha eventos popstate y hashchange para actualizar el store.
 * - Navegación programática con push, replace, back, forward, go.
 * - No manipula el DOM, solo window.history y el store.
 * - Soporta dos modos de routing: 'history' (default) y 'hash'.
 */

export function createVoyajer(pulsarStore, options = {}) {
  // Validar store
  if (!pulsarStore || typeof pulsarStore.getState !== 'function' || typeof pulsarStore.setState !== 'function') {
    throw new TypeError('[Voyajer] pulsarStore debe tener getState y setState');
  }

  // Configuración
  const config = {
    key: options.key || 'route',
    mode: options.mode || 'history', // 'history' o 'hash'
    base: options.base || '/',
    parse: options.parse || _defaultParse,
    serialize: options.serialize || _defaultSerialize,
    writeOnInit: options.writeOnInit !== undefined ? options.writeOnInit : true,
  };

  if (config.mode !== 'history' && config.mode !== 'hash') {
    throw new TypeError(`[Voyajer] mode debe ser 'history' o 'hash', recibido: '${config.mode}'`);
  }

  // Estado interno
  let _destroyed = false;

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

  function _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Retorna la representación textual de la ruta actual (path + search + hash
   * cuando aplica) en el modo configurado. Es lo que `serialize` debe producir
   * para que una navegación sea considerada equivalente a la posición actual.
   */
  function _getCurrentPathString() {
    if (config.mode === 'hash') {
      const hash = window.location.hash.substring(1);
      return hash || '/';
    } else {
      let path = window.location.pathname;
      if (config.base && config.base !== '/') {
        path = path.replace(new RegExp(`^${_escapeRegex(config.base)}`), '');
      }
      return (path || '/') + window.location.search + window.location.hash;
    }
  }

  /**
   * Construye una URL "virtual" apropiada para pasar a `parse`.
   * En modo 'history', es la URL real (con `base` sustraído del pathname).
   * En modo 'hash', el contenido del hash se promueve a pathname, para que
   * los parsers escritos contra `url.pathname` funcionen simétricamente en
   * ambos modos sin conocer la configuración.
   */
  function _getVirtualURL() {
    const realURL = new URL(window.location.href);

    if (config.mode === 'hash') {
      let hashContent = realURL.hash.substring(1);
      if (!hashContent) hashContent = '/';
      if (!hashContent.startsWith('/')) hashContent = '/' + hashContent;
      return new URL(hashContent, realURL.origin);
    }

    if (config.base && config.base !== '/') {
      const trimmedPath = realURL.pathname.replace(
        new RegExp(`^${_escapeRegex(config.base)}`),
        ''
      ) || '/';
      return new URL(trimmedPath + realURL.search + realURL.hash, realURL.origin);
    }

    return realURL;
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
  }

  /**
   * Lee la URL actual, la parsea y escribe el resultado en el store.
   */
  function _updateStoreFromURL() {
    if (_destroyed) return;

    const url = _getVirtualURL();
    const parsed = config.parse(url);

    if (parsed === null) {
      console.warn('[Voyajer] parse retornó null, no se actualiza el store');
      return;
    }

    _writeToStore(parsed);
  }

  // ============================================
  // NAVEGACIÓN PROGRAMÁTICA
  // ============================================

  /**
   * Navega a un nuevo estado, añadiendo una entrada al historial.
   * Si la URL serializada coincide con la actual, es un no-op.
   */
  function push(state) {
    if (_destroyed) return;
    if (typeof state !== 'object' || state === null) {
      throw new TypeError('[Voyajer] push: state debe ser un objeto');
    }

    const url = config.serialize(state);
    if (url === null || url === undefined || url === '') {
      console.warn('[Voyajer] serialize retornó null/vacío, no se navega');
      return;
    }

    // Idempotencia: si la URL a navegar coincide con la actual, no-op.
    if (url === _getCurrentPathString()) {
      return;
    }

    if (config.mode === 'hash') {
      window.location.hash = url;
    } else {
      const fullPath = (config.base === '/' ? '' : config.base) + url;
      window.history.pushState(null, '', fullPath);
    }

    _updateStoreFromURL();
  }

  /**
   * Navega reemplazando la entrada actual del historial.
   * Si la URL serializada coincide con la actual, es un no-op.
   */
  function replace(state) {
    if (_destroyed) return;
    if (typeof state !== 'object' || state === null) {
      throw new TypeError('[Voyajer] replace: state debe ser un objeto');
    }

    const url = config.serialize(state);
    if (url === null || url === undefined || url === '') {
      console.warn('[Voyajer] serialize retornó null/vacío, no se navega');
      return;
    }

    if (url === _getCurrentPathString()) {
      return;
    }

    if (config.mode === 'hash') {
      // window.location.replace acepta una URL completa; usamos href actual
      // con hash reemplazado para no perder el origen.
      const newURL = new URL(window.location.href);
      newURL.hash = url;
      window.location.replace(newURL.href);
    } else {
      const fullPath = (config.base === '/' ? '' : config.base) + url;
      window.history.replaceState(null, '', fullPath);
    }

    _updateStoreFromURL();
  }

  // ============================================
  // HISTORIAL
  // ============================================

  function back() {
    if (_destroyed) return;
    window.history.back();
  }

  function forward() {
    if (_destroyed) return;
    window.history.forward();
  }

  function go(delta) {
    if (_destroyed) return;
    if (typeof delta !== 'number') {
      throw new TypeError('[Voyajer] go: delta debe ser un número');
    }
    window.history.go(delta);
  }

  // ============================================
  // API PÚBLICA
  // ============================================

  function sync() {
    _updateStoreFromURL();
  }

  function getCurrent() {
    const state = pulsarStore.getState();
    return state[config.key] || null;
  }

  function destroy() {
    if (_destroyed) return;
    _destroyed = true;
    window.removeEventListener('popstate', _handleNavigation);
    window.removeEventListener('hashchange', _handleNavigation);
  }

  // ============================================
  // EVENT LISTENERS DEL NAVEGADOR
  // ============================================

  function _handleNavigation() {
    if (_destroyed) return;
    _updateStoreFromURL();
  }

  window.addEventListener('popstate', _handleNavigation);
  window.addEventListener('hashchange', _handleNavigation);

  // ============================================
  // INICIALIZACIÓN
  // ============================================

  if (config.writeOnInit) {
    _updateStoreFromURL();
  }

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

export default createVoyajer;
