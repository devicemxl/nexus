/**
 * GraphletJS - Modelo semántico
 * Sistema de grafo para representar relaciones entre nodos y aristas
 */

// Clase Nodo
class GraphNode {
  constructor(id, type = 'generic', data = {}) {
    this.id = id;
    this.type = type;
    this.data = data;
    this.edges = new Set(); // IDs de aristas conectadas
    this.metadata = {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1
    };
  }

  /**
   * Actualiza los datos del nodo
   * @param {Object} newData - Nuevos datos
   */
  update(newData = {}) {
    this.data = { ...this.data, ...newData };
    this.metadata.updatedAt = new Date().toISOString();
    this.metadata.version++;
  }

  /**
   * Obtiene el valor de una propiedad
   * @param {string} key - Nombre de la propiedad
   * @returns {*} Valor de la propiedad
   */
  get(key) {
    return this.data[key];
  }

  /**
   * Establece el valor de una propiedad
   * @param {string} key - Nombre de la propiedad
   * @param {*} value - Nuevo valor
   */
  set(key, value) {
    this.data[key] = value;
    this.metadata.updatedAt = new Date().toISOString();
    this.metadata.version++;
  }

  /**
   * Serializa el nodo a JSON
   * @returns {Object} Representación JSON del nodo
   */
  toJSON() {
    return {
      id: this.id,
      type: this.type,
      data: this.data,
      edges: Array.from(this.edges),
      metadata: this.metadata
    };
  }

  /**
   * Crea un nodo desde JSON
   * @param {Object} json - Representación JSON del nodo
   * @returns {GraphNode} Nuevo nodo
   */
  static fromJSON(json) {
    const node = new GraphNode(json.id, json.type, json.data);
    node.edges = new Set(json.edges || []);
    node.metadata = json.metadata || node.metadata;
    return node;
  }
}

// Clase Arista
class GraphEdge {
  constructor(id, source, target, type = 'default', data = {}) {
    this.id = id;
    this.source = source;
    this.target = target;
    this.type = type;
    this.data = data;
    this.metadata = {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1
    };
  }

  /**
   * Actualiza los datos de la arista
   * @param {Object} newData - Nuevos datos
   */
  update(newData = {}) {
    this.data = { ...this.data, ...newData };
    this.metadata.updatedAt = new Date().toISOString();
    this.metadata.version++;
  }

  /**
   * Obtiene el valor de una propiedad
   * @param {string} key - Nombre de la propiedad
   * @returns {*} Valor de la propiedad
   */
  get(key) {
    return this.data[key];
  }

  /**
   * Establece el valor de una propiedad
   * @param {string} key - Nombre de la propiedad
   * @param {*} value - Nuevo valor
   */
  set(key, value) {
    this.data[key] = value;
    this.metadata.updatedAt = new Date().toISOString();
    this.metadata.version++;
  }

  /**
   * Serializa la arista a JSON
   * @returns {Object} Representación JSON de la arista
   */
  toJSON() {
    return {
      id: this.id,
      source: this.source,
      target: this.target,
      type: this.type,
      data: this.data,
      metadata: this.metadata
    };
  }

  /**
   * Crea una arista desde JSON
   * @param {Object} json - Representación JSON de la arista
   * @returns {GraphEdge} Nueva arista
   */
  static fromJSON(json) {
    const edge = new GraphEdge(json.id, json.source, json.target, json.type, json.data);
    edge.metadata = json.metadata || edge.metadata;
    return edge;
  }
}

// Clase principal Graphlet
class Graphlet {
  constructor(options = {}) {
    this._nodes = new Map();
    this._edges = new Map();
    this._subscribers = new Map();
    this._config = {
      allowMultipleEdges: true,
      allowSelfLoops: true,
      directed: true,
      ...options
    };
    this._nextId = 1;
  }

  /**
   * Genera un ID único
   * @param {string} prefix - Prefijo para el ID
   * @returns {string} ID único
   */
  _generateId(prefix = 'node') {
    return `${prefix}_${Date.now()}_${this._nextId++}`;
  }

  /**
   * Notifica a los suscriptores de un evento
   * @param {string} event - Tipo de evento
   * @param {Object} data - Datos del evento
   */
  _notify(event, data) {
    if (this._subscribers.has(event)) {
      this._subscribers.get(event).forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[Graphlet] Error en suscriptor de ${event}:`, error);
        }
      });
    }

    // Suscriptores globales
    if (this._subscribers.has('*')) {
      this._subscribers.get('*').forEach(callback => {
        try {
          callback({ event, ...data });
        } catch (error) {
          console.error('[Graphlet] Error en suscriptor global:', error);
        }
      });
    }
  }

  /**
   * Agrega un nodo al grafo
   * @param {Object} options - Opciones del nodo
   * @param {string} [options.id] - ID del nodo (auto-generado si no se especifica)
   * @param {string} [options.type] - Tipo de nodo
   * @param {Object} [options.data] - Datos del nodo
   * @returns {GraphNode} Nodo creado
   */
  addNode({ id, type = 'generic', data = {} } = {}) {
    const nodeId = id || this._generateId('node');

    if (this._nodes.has(nodeId)) {
      throw new Error(`[Graphlet] Nodo con ID ${nodeId} ya existe`);
    }

    const node = new GraphNode(nodeId, type, data);
    this._nodes.set(nodeId, node);

    this._notify('nodeAdded', { node });
    this._notify('change', { type: 'addNode', node });

    return node;
  }

  /**
   * Agrega múltiples nodos al grafo
   * @param {Array<Object>} nodes - Array de configuraciones de nodos
   * @returns {Array<GraphNode>} Nodos creados
   */
  addNodes(nodes = []) {
    return nodes.map(nodeConfig => this.addNode(nodeConfig));
  }

  /**
   * Obtiene un nodo por su ID
   * @param {string} id - ID del nodo
   * @returns {GraphNode|undefined} Nodo encontrado
   */
  getNode(id) {
    return this._nodes.get(id);
  }

  /**
   * Obtiene todos los nodos
   * @returns {Array<GraphNode>} Array de nodos
   */
  getNodes() {
    return Array.from(this._nodes.values());
  }

  /**
   * Obtiene nodos por tipo
   * @param {string} type - Tipo de nodo
   * @returns {Array<GraphNode>} Array de nodos del tipo especificado
   */
  getNodesByType(type) {
    return this.getNodes().filter(node => node.type === type);
  }

  /**
   * Actualiza un nodo existente
   * @param {string} id - ID del nodo
   * @param {Object} data - Nuevos datos
   * @returns {GraphNode} Nodo actualizado
   */
  updateNode(id, data = {}) {
    const node = this._nodes.get(id);
    if (!node) {
      throw new Error(`[Graphlet] Nodo con ID ${id} no existe`);
    }

    node.update(data);
    this._notify('nodeUpdated', { node, data });
    this._notify('change', { type: 'updateNode', node, data });

    return node;
  }

  /**
   * Elimina un nodo del grafo
   * @param {string} id - ID del nodo
   * @returns {boolean} true si se eliminó correctamente
   */
  removeNode(id) {
    const node = this._nodes.get(id);
    if (!node) {
      return false;
    }

    // Eliminar aristas conectadas
    node.edges.forEach(edgeId => {
      this.removeEdge(edgeId);
    });

    this._nodes.delete(id);
    this._notify('nodeRemoved', { node });
    this._notify('change', { type: 'removeNode', node });

    return true;
  }

  /**
   * Agrega una arista al grafo
   * @param {Object} options - Opciones de la arista
   * @param {string} [options.id] - ID de la arista
   * @param {string} options.source - ID del nodo fuente
   * @param {string} options.target - ID del nodo destino
   * @param {string} [options.type] - Tipo de arista
   * @param {Object} [options.data] - Datos de la arista
   * @returns {GraphEdge} Arista creada
   */
  addEdge({ id, source, target, type = 'default', data = {} } = {}) {
    // Validar que los nodos existan
    if (!this._nodes.has(source)) {
      throw new Error(`[Graphlet] Nodo fuente ${source} no existe`);
    }
    if (!this._nodes.has(target)) {
      throw new Error(`[Graphlet] Nodo destino ${target} no existe`);
    }

    // Validar self-loops
    if (source === target && !this._config.allowSelfLoops) {
      throw new Error('[Graphlet] Self-loops no permitidos');
    }

    // Validar múltiples aristas
    if (!this._config.allowMultipleEdges) {
      const existingEdge = this.getEdges().find(e => 
        e.source === source && e.target === target && e.type === type
      );
      if (existingEdge) {
        throw new Error('[Graphlet] Ya existe una arista entre estos nodos');
      }
    }

    const edgeId = id || this._generateId('edge');
    const edge = new GraphEdge(edgeId, source, target, type, data);

    this._edges.set(edgeId, edge);
    this._nodes.get(source).edges.add(edgeId);
    this._nodes.get(target).edges.add(edgeId);

    this._notify('edgeAdded', { edge });
    this._notify('change', { type: 'addEdge', edge });

    return edge;
  }

  /**
   * Agrega múltiples aristas al grafo
   * @param {Array<Object>} edges - Array de configuraciones de aristas
   * @returns {Array<GraphEdge>} Aristas creadas
   */
  addEdges(edges = []) {
    return edges.map(edgeConfig => this.addEdge(edgeConfig));
  }

  /**
   * Obtiene una arista por su ID
   * @param {string} id - ID de la arista
   * @returns {GraphEdge|undefined} Arista encontrada
   */
  getEdge(id) {
    return this._edges.get(id);
  }

  /**
   * Obtiene todas las aristas
   * @returns {Array<GraphEdge>} Array de aristas
   */
  getEdges() {
    return Array.from(this._edges.values());
  }

  /**
   * Obtiene aristas por tipo
   * @param {string} type - Tipo de arista
   * @returns {Array<GraphEdge>} Array de aristas del tipo especificado
   */
  getEdgesByType(type) {
    return this.getEdges().filter(edge => edge.type === type);
  }

  /**
   * Obtiene las aristas conectadas a un nodo
   * @param {string} nodeId - ID del nodo
   * @returns {Array<GraphEdge>} Array de aristas conectadas
   */
  getNodeEdges(nodeId) {
    const node = this._nodes.get(nodeId);
    if (!node) return [];
    return Array.from(node.edges).map(edgeId => this._edges.get(edgeId)).filter(Boolean);
  }

  /**
   * Actualiza una arista existente
   * @param {string} id - ID de la arista
   * @param {Object} data - Nuevos datos
   * @returns {GraphEdge} Arista actualizada
   */
  updateEdge(id, data = {}) {
    const edge = this._edges.get(id);
    if (!edge) {
      throw new Error(`[Graphlet] Arista con ID ${id} no existe`);
    }

    edge.update(data);
    this._notify('edgeUpdated', { edge, data });
    this._notify('change', { type: 'updateEdge', edge, data });

    return edge;
  }

  /**
   * Elimina una arista del grafo
   * @param {string} id - ID de la arista
   * @returns {boolean} true si se eliminó correctamente
   */
  removeEdge(id) {
    const edge = this._edges.get(id);
    if (!edge) {
      return false;
    }

    // Remover de los nodos conectados
    const sourceNode = this._nodes.get(edge.source);
    const targetNode = this._nodes.get(edge.target);

    if (sourceNode) sourceNode.edges.delete(id);
    if (targetNode) targetNode.edges.delete(id);

    this._edges.delete(id);
    this._notify('edgeRemoved', { edge });
    this._notify('change', { type: 'removeEdge', edge });

    return true;
  }

  /**
   * Obtiene los vecinos de un nodo
   * @param {string} nodeId - ID del nodo
   * @returns {Array<GraphNode>} Array de nodos vecinos
   */
  getNeighbors(nodeId) {
    const edges = this.getNodeEdges(nodeId);
    const neighborIds = new Set();

    edges.forEach(edge => {
      if (edge.source === nodeId) neighborIds.add(edge.target);
      if (edge.target === nodeId) neighborIds.add(edge.source);
    });

    return Array.from(neighborIds).map(id => this._nodes.get(id)).filter(Boolean);
  }

  /**
   * Obtiene los hijos directos de un nodo (en grafos dirigidos)
   * @param {string} nodeId - ID del nodo
   * @returns {Array<GraphNode>} Array de nodos hijos
   */
  getChildren(nodeId) {
    const edges = this.getNodeEdges(nodeId);
    const childIds = new Set();

    edges.forEach(edge => {
      if (edge.source === nodeId) childIds.add(edge.target);
    });

    return Array.from(childIds).map(id => this._nodes.get(id)).filter(Boolean);
  }

  /**
   * Obtiene los padres directos de un nodo (en grafos dirigidos)
   * @param {string} nodeId - ID del nodo
   * @returns {Array<GraphNode>} Array de nodos padres
   */
  getParents(nodeId) {
    const edges = this.getNodeEdges(nodeId);
    const parentIds = new Set();

    edges.forEach(edge => {
      if (edge.target === nodeId) parentIds.add(edge.source);
    });

    return Array.from(parentIds).map(id => this._nodes.get(id)).filter(Boolean);
  }

  /**
   * Busca nodos que cumplan con un criterio
   * @param {Function} predicate - Función de filtrado
   * @returns {Array<GraphNode>} Array de nodos que cumplen el criterio
   */
  findNodes(predicate) {
    return this.getNodes().filter(predicate);
  }

  /**
   * Busca aristas que cumplan con un criterio
   * @param {Function} predicate - Función de filtrado
   * @returns {Array<GraphEdge>} Array de aristas que cumplen el criterio
   */
  findEdges(predicate) {
    return this.getEdges().filter(predicate);
  }

  /**
   * Cuenta el número total de nodos
   * @returns {number} Número de nodos
   */
  getNodeCount() {
    return this._nodes.size;
  }

  /**
   * Cuenta el número total de aristas
   * @returns {number} Número de aristas
   */
  getEdgeCount() {
    return this._edges.size;
  }

  /**
   * Verifica si existe un nodo
   * @param {string} id - ID del nodo
   * @returns {boolean} true si existe
   */
  hasNode(id) {
    return this._nodes.has(id);
  }

  /**
   * Verifica si existe una arista
   * @param {string} id - ID de la arista
   * @returns {boolean} true si existe
   */
  hasEdge(id) {
    return this._edges.has(id);
  }

  /**
   * Verifica si existe una conexión entre dos nodos
   * @param {string} sourceId - ID del nodo fuente
   * @param {string} targetId - ID del nodo destino
   * @returns {boolean} true si existe conexión
   */
  areConnected(sourceId, targetId) {
    return this.getEdges().some(edge => 
      (edge.source === sourceId && edge.target === targetId) ||
      (edge.source === targetId && edge.target === sourceId)
    );
  }

  /**
   * Suscribe una función a cambios en el grafo
   * @param {string|string[]} events - Eventos a suscribirse
   * @param {Function} callback - Función a ejecutar
   * @returns {Function} Función para cancelar la suscripción
   */
  subscribe(events, callback) {
    const eventArray = Array.isArray(events) ? events : [events];
    const subscriptionId = Symbol('subscription');

    eventArray.forEach(event => {
      if (!this._subscribers.has(event)) {
        this._subscribers.set(event, new Map());
      }
      this._subscribers.get(event).set(subscriptionId, callback);
    });

    return () => {
      eventArray.forEach(event => {
        if (this._subscribers.has(event)) {
          this._subscribers.get(event).delete(subscriptionId);
        }
      });
    };
  }

  /**
   * Serializa el grafo completo a JSON
   * @returns {Object} Representación JSON del grafo
   */
  toJSON() {
    return {
      config: this._config,
      nodes: this.getNodes().map(node => node.toJSON()),
      edges: this.getEdges().map(edge => edge.toJSON())
    };
  }

  /**
   * Crea un grafo desde JSON
   * @param {Object} json - Representación JSON del grafo
   * @returns {Graphlet} Nuevo grafo
   */
  static fromJSON(json) {
    const graph = new Graphlet(json.config || {});

    // Agregar nodos
    (json.nodes || []).forEach(nodeJson => {
      graph.addNode({
        id: nodeJson.id,
        type: nodeJson.type,
        data: nodeJson.data
      });
    });

    // Agregar aristas
    (json.edges || []).forEach(edgeJson => {
      graph.addEdge({
        id: edgeJson.id,
        source: edgeJson.source,
        target: edgeJson.target,
        type: edgeJson.type,
        data: edgeJson.data
      });
    });

    return graph;
  }

  /**
   * Limpia el grafo
   */
  clear() {
    this._nodes.clear();
    this._edges.clear();
    this._nextId = 1;
    this._notify('cleared', {});
    this._notify('change', { type: 'clear' });
  }

  /**
   * Obtiene estadísticas del grafo
   * @returns {Object} Estadísticas del grafo
   */
  getStats() {
    const nodeTypes = {};
    const edgeTypes = {};

    this.getNodes().forEach(node => {
      nodeTypes[node.type] = (nodeTypes[node.type] || 0) + 1;
    });

    this.getEdges().forEach(edge => {
      edgeTypes[edge.type] = (edgeTypes[edge.type] || 0) + 1;
    });

    return {
      nodes: this.getNodeCount(),
      edges: this.getEdgeCount(),
      nodeTypes,
      edgeTypes,
      isolatedNodes: this.getNodes().filter(node => node.edges.size === 0).length
    };
  }

  /**
   * Método estático para crear instancia de Graphlet
   * @param {Object} options - Opciones de configuración
   * @returns {Graphlet} Nueva instancia
   */
  static create(options = {}) {
    return new Graphlet(options);
  }
}

// Exportar clases
export { Graphlet, GraphNode, GraphEdge };

// Exportar instancia singleton para uso global
export const graphlet = new Graphlet();

// Exportar función helper para crear grafos
export function createGraph(options = {}) {
  return new Graphlet(options);
}

// Exportar utilidades adicionales
export const GraphletUtils = {
  /**
   * Combina múltiples grafos en uno
   * @param {...Graphlet} graphs - Grafos a combinar
   * @returns {Graphlet} Nuevo grafo combinado
   */
  combine(...graphs) {
    const combined = new Graphlet();

    graphs.forEach(graph => {
      graph.getNodes().forEach(node => {
        combined.addNode({
          id: node.id,
          type: node.type,
          data: node.data
        });
      });

      graph.getEdges().forEach(edge => {
        combined.addEdge({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: edge.type,
          data: edge.data
        });
      });
    });

    return combined;
  },

  /**
   * Crea un subgrafo con nodos que cumplen un criterio
   * @param {Graphlet} source - Grafo fuente
   * @param {Function} predicate - Función de filtrado
   * @returns {Graphlet} Nuevo subgrafo
   */
  subgraph(source, predicate) {
    const sub = new Graphlet();
    const nodeIds = new Set();

    source.getNodes().forEach(node => {
      if (predicate(node)) {
        sub.addNode({
          id: node.id,
          type: node.type,
          data: node.data
        });
        nodeIds.add(node.id);
      }
    });

    source.getEdges().forEach(edge => {
      if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
        sub.addEdge({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: edge.type,
          data: edge.data
        });
      }
    });

    return sub;
  },

  /**
   * Encuentra el camino más corto entre dos nodos (BFS)
   * @param {Graphlet} graph - Grafo
   * @param {string} startId - ID del nodo inicial
   * @param {string} endId - ID del nodo final
   * @returns {Array<string>|null} Array de IDs del camino o null
   */
  shortestPath(graph, startId, endId) {
    if (!graph.hasNode(startId) || !graph.hasNode(endId)) return null;
    if (startId === endId) return [startId];

    const queue = [[startId]];
    const visited = new Set([startId]);

    while (queue.length > 0) {
      const path = queue.shift();
      const current = path[path.length - 1];

      const neighbors = graph.getNeighbors(current);
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor.id)) {
          const newPath = [...path, neighbor.id];
          if (neighbor.id === endId) {
            return newPath;
          }
          visited.add(neighbor.id);
          queue.push(newPath);
        }
      }
    }

    return null;
  }
};

export default Graphlet;