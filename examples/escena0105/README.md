# Escena 1.5 — Consolidación

**Fase:** 1 (chatbot sobre Nexus)
**Estado:** implementada, pendiente de corrida en navegador
**Propósito:** extraer lo que los widgets construidos demostraron compartir, y cerrar `RECONCILIACION-CON-CLAVE`.

## El hallazgo

El roadmap describía esta escena como extraer una **widget factory** de los cuatro widgets construidos. El inventario no sostiene esa forma.

Lo que se repite no es "widget": es "lista de entidades", y sólo dos de los cinco widgets lo son.

| widget | líneas útiles | absorbibles por una factory de listas |
|---|---|---|
| `app-shell` | 35 | 0 |
| `conversation-list` | 57 | 26 |
| `conversation-item` | 30 | 0 |
| `conversation-messages` | 90 | 31 |
| `composer` | 84 | 5 |

Una factory que cubriera los cinco tendría que absorber tres widgets que no comparten estructura entre sí. Eso no es una factory, es un framework, y se construiría sin un solo caso que lo pida.

Lo que los cinco sí comparten es menudo y ya era de una línea: localizar zonas y escribir en `ui.*`. Da para dos ayudas pequeñas, no para una abstracción.

## Qué se extrajo

**`lista-de-entidades.js`** — la factory, con dos casos reales. Exactamente el mínimo de D-2, así que cubre lo que esos dos necesitan y nada más: sin filtros, sin ordenación, sin paginación, sin animaciones. Cada una entra cuando exista un widget que la pida.

**`zonas.js`** — `zonas()`, `plantilla()` y `fijarUi()`. Antes cada widget repetía el `querySelector` y cada uno decidía por su cuenta si ante una zona ausente avisaba, lanzaba o seguía.

`app-shell`, `conversation-item` y `composer` se quedan imperativos. Lo que hacen es distinto entre sí, y declararlos con configuración exigiría un vocabulario donde cada término tendría un solo usuario.

## RECONCILIACION-CON-CLAVE, cerrada

La factory compara la lista nueva con la pintada por identificador y toca el mínimo: actualiza en sitio lo que sigue, crea lo que llega, retira lo que se fue, mueve lo que cambió de orden.

Operaciones de DOM en un turno de conversación:

| mensajes previos | antes | ahora |
|---|---|---|
| 10 | 69 | 2 |
| 50 | 309 | 2 |
| 200 | 1209 | 2 |
| 500 | 3009 | 2 |

El coste antiguo crecía linealmente con el tamaño de la conversación. El nuevo es constante: un turno toca dos nodos porque un turno son dos mensajes.

**La ganancia que importa no es el rendimiento.** El nodo de una entidad que no cambió deja de recrearse, así que su estado de DOM sobrevive. El harness de navegador lo comprueba con foco real y selección de texto dentro de un campo — algo que Node no puede responder. Ésa era la condición de escalada anotada en la deuda, la que la convertía de coste en defecto funcional. Se cierra antes de que llegara.

## Cómo se validó la migración

**Las baterías de 1.2, 1.3 y 1.4 pasan sin modificarse.** Es el criterio central: una refactorización que exige reescribir sus propias pruebas no demostró preservar nada.

Con una excepción declarada por adelantado en la mini-spec, no descubierta a conveniencia. Tres aserciones de 1.3 contaban reconstrucciones completas, y con reconciliación no hay reconstrucciones que contar. Se sustituyeron por su equivalente honesto —nodos creados y destruidos— que sirve para los dos diseños y distingue lo que importa.

```
validar-modelo.mjs      57/57    (Escena 1.2, verbatim)
validar-mensajes.mjs    54/54    (Escena 1.3, con la sustitución declarada)
validar-composer.mjs    48/48    (Escena 1.4, verbatim)
validar-lista.mjs       47/47    (nueva)
```

## Cómo correrla

```
python -m http.server 8000
```

- Aplicación: `http://localhost:8000/examples/escena0105/`
- Harness: `http://localhost:8000/examples/escena0105/tests/lista.test.html`

```
cd examples/escena0105/tests
node validar-lista.mjs           # 47 aserciones
node medir-reconciliacion.mjs    # operaciones por turno
```

## Verificación

- 206/206 verdes en las cuatro baterías Node
- 45 aserciones en el harness de navegador, pendiente de corrida
- El coste por turno es constante e independiente del tamaño de la conversación
- El foco y la selección de texto sobreviven a cambios en otras entidades
