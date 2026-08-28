/**
 * VoyajerJS - URL routing
 * Sistema de enrutamiento SPA con soporte para hash y history API
 * 
    Características implementadas:

      Route - Clase para manejar rutas con patrones dinámicos
      NavigationHistory - Historial de navegación con capacidad de retroceder/avanzar
      Voyajer - Clase principal del router
      Soporte dual - Modo hash y modo history API
      Rutas dinámicas - Parámetros en la URL con :param
      Wildcards - Rutas comodín con *
      Middlewares - Funciones intermedias en la navegación
      Hooks - beforeEnter, afterEnter, beforeLeave
      Eventos - navigate, afterEach, notfound, ready
      Historial - Navegación hacia adelante y atrás
      Utilidades - parseURL, parseQuery, buildQuery, joinPaths, matchesPattern, extractParams
 */

// Clase para manejar rutas
class Route {
  constructor(pattern, handler, options = {}) {
    this.pattern = pattern;
    this.handler = handler;
    this.options = {
      name: null,
      meta: {},
      beforeEnter: null,
      afterEnter: null,
      beforeLeave: null,
      ...options
    };

    this._compilePattern();
  }

  /**
   * Compila el patrón de la ruta
   */
  _compilePattern() {
    // Convertir patrón a regex
    let pattern = this.pattern
      .replace(/\/{2,}/g, '/') // Normalizar slashes
      .replace(/:([^/]+)/g, '(?<$1>[^/]+)') // Parámetros dinámicos
      .replace(/\*/g, '(.*)') // Wildcards
      .replace(/\//g, '\\/');

    this._regex = new RegExp(`^${pattern}$`);
  }

  /**
   * Verifica si la ruta coincide con el patrón
   * @param {string} path - Ruta a verificar
   * @returns {Object|null} Parámetros de la ruta o null
   */
  match(path) {
    const match = this._regex.exec(path);
    if (!match) return null;

    // Extraer parámetros
    const params = {};
    if (match.groups) {
      Object.assign(params, match.groups);
    }

    return params;
  }

  /**
   * Ejecuta el handler de la ruta
   * @param {Object} context - Contexto de la navegación
   * @returns {Promise} Promesa con el resultado
   */
  async execute(context) {
    // beforeEnter hook
    if (this.options.beforeEnter) {
      const result = await this.options.beforeEnter(context);
      if (result === false) return false;
    }

    // Ejecutar handler
    const result = await this.handler(context);

    // afterEnter hook
    if (this.options.afterEnter) {
      await this.options.afterEnter(context);
    }

    return result;
  }

  /**
   * Genera una URL para esta ruta
   * @param {Object} params - Parámetros para la URL
   * @returns {string} URL generada
   */
  generate(params = {}) {
    let url = this.pattern;

    Object.entries(params).forEach(([key, value]) => {
      url = url.replace(`:${key}`, encodeURIComponent(value));
    });

    return url;
  }

  /**
   * Serializa la ruta
   * @returns {Object} Representación de la ruta
   */
  toJSON() {
    return {
      pattern: this.pattern,
      name: this.options.name,
      meta: this.options.meta
    };
  }
}

// Clase para manejar el historial de navegación
class NavigationHistory {
  constructor(maxSize = 50) {
    this._entries = [];
    this._index = -1;
    this._maxSize = maxSize;
  }

  /**
   * Agrega una entrada al historial
   * @param {Object} entry - Entrada de navegación
   */
  push(entry) {
    // Eliminar entradas futuras si estamos en medio del historial
    if (this._index < this._entries.length - 1) {
      this._entries = this._entries.slice(0, this._index + 1);
    }

    this._entries.push(entry);
    this._index++;

    // Limitar tamaño
    if (this._entries.length > this._maxSize) {
      this._entries.shift();
      this._index--;
    }
  }

  /**
   * Retrocede en el historial
   * @returns {Object|null} Entrada anterior o null
   */
  back() {
    if (this._index > 0) {
      this._index--;
      return this._entries[this._index];
    }
    return null;
  }

  /**
   * Avanza en el historial
   * @returns {Object|null} Siguiente entrada o null
   */
  forward() {
    if (this._index < this._entries.length - 1) {
      this._index++;
      return this._entries[this._index];
    }
    return null;
  }

  /**
   * Obtiene la entrada actual
   * @returns {Object|null} Entrada actual o null
   */
  current() {
    return this._entries[this._index] || null;
  }

  /**
   * Obtiene todas las entradas
   * @returns {Array} Array de entradas
   */
  getAll() {
    return [...this._entries];
  }

  /**
   * Limpia el historial
   */
  clear() {
    this._entries = [];
    this._index = -1;
  }

  /**
   * Obtiene la longitud del historial
   * @returns {number} Longitud del historial
   */
  get length() {
    return this._entries.length;
  }

  /**
   * Verifica si puede retroceder
   * @returns {boolean} true si puede retroceder
   */
  get canBack() {
    return this._index > 0;
  }

  /**
   * Verifica si puede avanzar
   * @returns {boolean} true si puede avanzar
   */
  get canForward() {
    return this._index < this._entries.length - 1;
  }
}

// Clase principal Voyajer
class Voyajer {
  constructor(options = {}) {
    this._routes = [];
    this._currentRoute = null;
    this._currentParams = {};
    this._currentPath = '';
    this._listeners = new Map();
    this._middlewares = [];
    this._history = new NavigationHistory(options.maxHistory || 50);

    this.options = {
      mode: 'hash', // 'hash' | 'history'
      base: '/',
      scrollBehavior: 'smooth',
      caseSensitive: false,
      ...options
    };

    // Configurar modo
    if (this.options.mode === 'history' && !window.history.pushState) {
      console.warn('[Voyajer] History API no soportada, usando hash mode');
      this.options.mode = 'hash';
    }

    this._setupListeners();
  }

  /**
   * Configura los listeners del router
   */
  _setupListeners() {
    // Escuchar cambios en hash
    window.addEventListener('hashchange', () => {
      if (this.options.mode === 'hash') {
        this._handleNavigation();
      }
    });

    // Escuchar cambios en history
    window.addEventListener('popstate', () => {
      if (this.options.mode === 'history') {
        this._handleNavigation();
      }
    });

    // Interceptar clics en enlaces
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (link && this._shouldHandleLink(link)) {
        e.preventDefault();
        this.push(link.getAttribute('href'));
      }
    });
  }

  /**
   * Verifica si un enlace debe ser manejado por el router
   * @param {HTMLAnchorElement} link - Enlace a verificar
   * @returns {boolean} true si debe ser manejado
   */
  _shouldHandleLink(link) {
    // Verificar si tiene target
    if (link.target && link.target !== '_self') return false;

    // Verificar si tiene download
    if (link.hasAttribute('download')) return false;

    // Verificar si es enlace externo
    const url = new URL(link.href);
    if (url.origin !== window.location.origin) return false;

    // Verificar si tiene data-voyajer-ignore
    if (link.hasAttribute('data-voyajer-ignore')) return false;

    return true;
  }

  /**
   * Maneja la navegación
   */
  _handleNavigation() {
    const path = this._getCurrentPath();
    this._navigate(path, { updateHistory: false });
  }

  /**
   * Obtiene la ruta actual
   * @returns {string} Ruta actual
   */
  _getCurrentPath() {
    if (this.options.mode === 'hash') {
      const hash = window.location.hash.substring(1);
      return hash || '/';
    } else {
      let path = window.location.pathname;
      if (this.options.base !== '/') {
        path = path.replace(new RegExp(`^${this.options.base}`), '');
      }
      return path || '/';
    }
  }

  /**
   * Navega a una ruta
   * @param {string} path - Ruta a navegar
   * @param {Object} options - Opciones de navegación
   */
  async _navigate(path, options = {}) {
    const { updateHistory = true, replace = false } = options;

    // Normalizar path
    path = this._normalizePath(path);

    // Ejecutar middlewares
    for (const middleware of this._middlewares) {
      const result = await middleware({ path, router: this });
      if (result === false) return;
      if (typeof result === 'string') {
        path = result;
      }
    }

    // Buscar ruta
    const { route, params } = this._matchRoute(path);

    if (!route) {
      this.emit('notfound', { path });
      return;
    }

    // Preparar contexto
    const context = {
      path,
      route,
      params,
      router: this,
      query: this._parseQuery(),
      hash: window.location.hash
    };

    // beforeLeave hook de la ruta actual
    if (this._currentRoute?.options.beforeLeave) {
      const result = await this._currentRoute.options.beforeLeave(context);
      if (result === false) return;
    }

    // Actualizar URL
    if (updateHistory) {
      if (replace) {
        this._replace(path);
      } else {
        this._push(path);
      }
    }

    // Guardar en historial
    this._history.push({
      path,
      route: route.pattern,
      timestamp: new Date().toISOString()
    });

    // Actualizar estado
    const previousRoute = this._currentRoute;
    this._currentRoute = route;
    this._currentParams = params;
    this._currentPath = path;

    // Ejecutar ruta
    await route.execute(context);

    // Emitir eventos
    this.emit('navigate', { path, route, params });
    this.emit('afterEach', { path, route, params });

    // Manejar scroll
    if (this.options.scrollBehavior) {
      this._handleScroll();
    }

    // Actualizar título
    if (route.options.meta?.title) {
      document.title = route.options.meta.title;
    }
  }

  /**
   * Normaliza un path
   * @param {string} path - Path a normalizar
   * @returns {string} Path normalizado
   */
  _normalizePath(path) {
    if (this.options.caseSensitive) {
      return path;
    }
    return path.toLowerCase();
  }

  /**
   * Busca una ruta que coincida con el path
   * @param {string} path - Path a buscar
   * @returns {Object|null} Ruta encontrada o null
   */
  _matchRoute(path) {
    for (const route of this._routes) {
      const params = route.match(path);
      if (params) {
        return { route, params };
      }
    }
    return { route: null, params: {} };
  }

  /**
   * Parsea la query string
   * @returns {Object} Objeto con los parámetros de query
   */
  _parseQuery() {
    const search = window.location.search.substring(1);
    if (!search) return {};

    const params = {};
    search.split('&').forEach(pair => {
      const [key, value] = pair.split('=');
      params[decodeURIComponent(key)] = decodeURIComponent(value || '');
    });

    return params;
  }

  /**
   * Empuja una nueva entrada al historial
   * @param {string} path - Path a navegar
   */
  _push(path) {
    if (this.options.mode === 'hash') {
      window.location.hash = path;
    } else {
      window.history.pushState({}, '', this.options.base + path);
    }
  }

  /**
   * Reemplaza la entrada actual del historial
   * @param {string} path - Path a navegar
   */
  _replace(path) {
    if (this.options.mode === 'hash') {
      window.location.replace(`#${path}`);
    } else {
      window.history.replaceState({}, '', this.options.base + path);
    }
  }

  /**
   * Maneja el scroll después de la navegación
   */
  _handleScroll() {
    if (this.options.scrollBehavior === 'smooth') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (typeof this.options.scrollBehavior === 'function') {
      this.options.scrollBehavior(this._currentRoute, this._currentParams);
    } else {
      window.scrollTo(0, 0);
    }
  }

  /**
   * Registra una ruta
   * @param {string|Object} path - Patrón de ruta o configuración
   * @param {Function|Object} handler - Handler de la ruta o configuración
   * @param {Object} options - Opciones de la ruta
   * @returns {Route} Ruta registrada
   */
  register(path, handler, options = {}) {
    let route;

    if (typeof path === 'object') {
      // Configuración completa
      route = new Route(path.path, path.handler, {
        name: path.name,
        meta: path.meta,
        beforeEnter: path.beforeEnter,
        afterEnter: path.afterEnter,
        beforeLeave: path.beforeLeave
      });
    } else {
      // Patrón simple
      route = new Route(path, handler, options);
    }

    this._routes.push(route);
    return route;
  }

  /**
   * Registra múltiples rutas
   * @param {Array} routes - Array de configuraciones de rutas
   */
  registerRoutes(routes = []) {
    routes.forEach(route => this.register(route));
  }

  /**
   * Agrega un middleware
   * @param {Function} middleware - Función middleware
   */
  use(middleware) {
    this._middlewares.push(middleware);
  }

  /**
   * Navega a una ruta
   * @param {string} path - Ruta a navegar
   * @param {Object} options - Opciones de navegación
   */
  push(path, options = {}) {
    this._navigate(path, { ...options, updateHistory: true, replace: false });
  }

  /**
   * Reemplaza la ruta actual
   * @param {string} path - Ruta a navegar
   */
  replace(path) {
    this._navigate(path, { updateHistory: true, replace: true });
  }

  /**
   * Retrocede en el historial
   */
  back() {
    if (this.options.mode === 'hash') {
      window.history.back();
    } else {
      const entry = this._history.back();
      if (entry) {
        this._navigate(entry.path, { updateHistory: false });
      }
    }
  }

  /**
   * Avanza en el historial
   */
  forward() {
    if (this.options.mode === 'hash') {
      window.history.forward();
    } else {
      const entry = this._history.forward();
      if (entry) {
        this._navigate(entry.path, { updateHistory: false });
      }
    }
  }

  /**
   * Navega a una ruta por nombre
   * @param {string} name - Nombre de la ruta
   * @param {Object} params - Parámetros para la ruta
   */
  navigateTo(name, params = {}) {
    const route = this._routes.find(r => r.options.name === name);
    if (route) {
      const path = route.generate(params);
      this.push(path);
    } else {
      console.error(`[Voyajer] Ruta "${name}" no encontrada`);
    }
  }

  /**
   * Obtiene la ruta actual
   * @returns {Object} Información de la ruta actual
   */
  getCurrentRoute() {
    return {
      path: this._currentPath,
      route: this._currentRoute,
      params: this._currentParams,
      query: this._parseQuery()
    };
  }

  /**
   * Obtiene una ruta por nombre
   * @param {string} name - Nombre de la ruta
   * @returns {Route|undefined} Ruta encontrada
   */
  getRoute(name) {
    return this._routes.find(r => r.options.name === name);
  }

  /**
   * Obtiene todas las rutas
   * @returns {Array<Route>} Array de rutas
   */
  getRoutes() {
    return [...this._routes];
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
        console.error(`[Voyajer] Error en listener de ${event}:`, error);
      }
    });
  }

  /**
   * Inicia el router
   */
  start() {
    this._handleNavigation();
    this.emit('ready', { router: this });
  }

  /**
   * Detiene el router
   */
  stop() {
    window.removeEventListener('hashchange', this._handleNavigation);
    window.removeEventListener('popstate', this._handleNavigation);
    this._listeners.clear();
  }

  /**
   * Limpia todas las rutas
   */
  clearRoutes() {
    this._routes = [];
  }

  /**
   * Método estático para crear instancia de Voyajer
   * @param {Object} options - Opciones de configuración
   * @returns {Voyajer} Nueva instancia
   */
  static create(options = {}) {
    return new Voyajer(options);
  }

  /**
   * Método estático para navegar programáticamente
   * @param {string} path - Ruta a navegar
   */
  static go(path) {
    window.location.hash = path;
  }
}

// Utilidades de Voyajer
export const VoyajerUtils = {
  /**
   * Parsea una URL en sus componentes
   * @param {string} url - URL a parsear
   * @returns {Object} Componentes de la URL
   */
  parseURL(url) {
    const a = document.createElement('a');
    a.href = url;

    return {
      hash: a.hash,
      host: a.host,
      hostname: a.hostname,
      href: a.href,
      origin: a.origin,
      pathname: a.pathname,
      port: a.port,
      protocol: a.protocol,
      search: a.search,
      query: this.parseQuery(a.search)
    };
  },

  /**
   * Parsea una query string
   * @param {string} query - Query string a parsear
   * @returns {Object} Objeto con los parámetros
   */
  parseQuery(query) {
    if (!query) return {};

    const params = {};
    query = query.replace(/^\?/, '');

    query.split('&').forEach(pair => {
      const [key, value] = pair.split('=');
      params[decodeURIComponent(key)] = decodeURIComponent(value || '');
    });

    return params;
  },

  /**
   * Construye una query string
   * @param {Object} params - Parámetros para la query
   * @returns {string} Query string
   */
  buildQuery(params = {}) {
    const pairs = Object.entries(params).map(([key, value]) => 
      `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    );

    return pairs.length > 0 ? `?${pairs.join('&')}` : '';
  },

  /**
   * Combina paths
   * @param {...string} paths - Paths a combinar
   * @returns {string} Path combinado
   */
  joinPaths(...paths) {
    return paths
      .filter(Boolean)
      .map(path => path.replace(/^\/+|\/+$/g, ''))
      .join('/');
  },

  /**
   * Verifica si un path coincide con un patrón
   * @param {string} path - Path a verificar
   * @param {string} pattern - Patrón a comparar
   * @returns {boolean} true si coincide
   */
  matchesPattern(path, pattern) {
    const route = new Route(pattern, () => {});
    return route.match(path) !== null;
  },

  /**
   * Extrae parámetros de un path
   * @param {string} path - Path del que extraer
   * @param {string} pattern - Patrón de la ruta
   * @returns {Object|null} Parámetros extraídos o null
   */
  extractParams(path, pattern) {
    const route = new Route(pattern, () => {});
    return route.match(path);
  }
};

// Exportar clases
export { Voyajer, Route, NavigationHistory };

// Exportar instancia singleton para uso global
export const voyajer = new Voyajer();

// Exportar función helper para crear router
export function createRouter(options = {}) {
  return new Voyajer(options);
}

export default Voyajer;