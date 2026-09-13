/**
 * VoyajerJS - URL routing (Contrato v0.2.2, código v0.2.2)
 * Integración con Pulsar para sincronización bidireccional.
 *
 * Cambios respecto a v0.2.1:
 * - Fix A: `base` se normaliza una sola vez a forma canónica
 *   ('/' o '/prefijo' sin slash final). Antes, un `base` con slash
 *   final producía doble slash al navegar y rompía la idempotencia de
 *   `push`/`replace` sobre la URL servida por el servidor. La
 *   sustracción de `base` pasa a compararse por segmento, lo que
 *   además cierra el caso frontera '/admin' vs '/administrator'.
 * - Fix 1 (breaking en conducta, no en API): `_writeToStore` REEMPLAZA
 *   la clave de navegación en lugar de fusionarla. Se alinea con el
 *   contrato de `parse`, que retorna estado completo. Consecuencia para
 *   consumidores: un `parse` que retorne parches parciales ya no
 *   acumula; debe retornar la forma completa de la ruta.
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

  /**
   * Normaliza `base` a una forma canónica única: o bien '/' (sin base),
   * o bien una ruta con slash inicial y SIN slash final ('/admin').
   *
   * Motivo (fix A, v0.2.2): la versión anterior usaba `base` verbatim en
   * dos lugares con convenciones incompatibles. Con `base: '/admin/'`:
   *   - al construir:  '/admin/' + '/projects/42' = '/admin//projects/42'
   *   - al sustraer:   '/admin/projects/42' → 'projects/42' (sin slash
   *     inicial), que nunca iguala al '/projects/42' que produce
   *     `serialize`, de modo que la idempotencia de push/replace no
   *     disparaba jamás sobre una URL servida por el servidor.
   * Los dos defectos se cancelaban entre sí SÓLO después de una
   * navegación propia, así que la conducta difería entre la carga
   * inicial y el resto de la sesión. Normalizar una vez elimina las dos.
   */
  function _normalizeBase(base) {
    if (typeof base !== 'string') return '/';
    let b = base.trim();
    if (b === '' || b === '/') return '/';
    if (!b.startsWith('/')) b = '/' + b;
    while (b.length > 1 && b.endsWith('/')) b = b.slice(0, -1);
    return b;
  }

  // Configuración
  const config = {
    key: options.key || 'route',
    mode: options.mode || 'history', // 'history' o 'hash'
    base: _normalizeBase(options.base),
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

  /**
   * Sustrae `base` de un pathname respetando el límite de segmento y
   * garantizando que el resultado empieza con '/'.
   *
   * La sustracción por regex de la versión anterior tenía además un
   * fallo de frontera: con `base: '/admin'`, el pathname
   * '/administrator' quedaba convertido en 'istrator'. Comparar por
   * segmento lo cierra sin necesidad de escapar nada.
   */
  function _stripBase(pathname) {
    if (config.base === '/') return pathname || '/';
    if (pathname === config.base) return '/';
    if (pathname.startsWith(config.base + '/')) {
      return pathname.slice(config.base.length) || '/';
    }
    return pathname || '/';
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
      const path = _stripBase(window.location.pathname);
      return path + window.location.search + window.location.hash;
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

    if (config.base !== '/') {
      const trimmedPath = _stripBase(realURL.pathname);
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

    // REEMPLAZO, no fusión (fix 1, v0.2.2).
    //
    // El contrato de `parse` (§5.2) es que retorna EL estado de
    // navegación, no un parche: `_defaultParse` devuelve siempre las tres
    // claves, y la garantía de simetría `serialize(parse(url)) === url`
    // sólo se sostiene si el estado es completo. Fusionar contradecía ese
    // contrato y dejaba claves fantasma: navegar de /c/abc
    // ({vista, conversacionId}) a / ({vista}) conservaba conversacionId
    // apuntando a una conversación que ya no es la ruta actual.
    //
    // Reemplazar la clave entera es seguro porque `config.key` es
    // namespace exclusivo de Voyajer por la convención del Nexus Contract
    // (`route.*`). Ningún otro productor escribe ahí; si una aplicación
    // necesita guardar algo propio junto a la ruta, va en otra clave.
    pulsarStore.setState({ [config.key]: navigationState });
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
