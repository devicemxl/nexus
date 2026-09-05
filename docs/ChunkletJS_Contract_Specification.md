# ChunkletJS Contract Specification

**Version:** 0.4.0
**Status:** Design Contract (aligned with implementation v0.4.0)
**Scope:** DOM behavior and lifecycle primitive for browser environments, integrated as the orchestration layer of the Nexus stack.

**Changes from v0.3.0 (breaking):**
- **C-2 (symmetry of `enable`/`disable`).** Both operations now produce an explicit entry in the enabled map even when no previous entry existed for the target entity. When no entry exists, the DOM is consulted (via the `data-entity` attribute and the `data-chunk` values on matching elements) to materialize the base list of declared behaviors, and then the union (`enable`) or difference (`disable`) is applied and written back. The prior semantics — where `enable` on an absent entity was a silent no-op — are removed. See §7.3.
- **New public API: `configure()`.** A deferred configuration step is added, allowing `graphlet` and `voyajer` (but not `pulsar`) to be replaced after `setup()`. This closes the gap where an application needs to instantiate the stack before it has all its dependencies (e.g., Voyajer configured with mode/base derived from runtime information). See §3.2 and §4.
- **Consumer impact.** Applications that relied on `enable(entity, name)` being a no-op when `entity` had no prior entry must adapt. The new behavior writes an entry that reflects the DOM's declared behaviors plus the enabled name; downstream observers of `enabledPath` will see the entry appear where previously they saw nothing. Applications that wrote directly to the map at `enabledPath` continue to work unchanged.

**Non-breaking refactor (C-1):** Internal helpers for reading the enabled map are unified into a single `_readEnabledMap` with a single validation criterion (`_isPlainObject`). This is not observable through the public API but is noted for changelog completeness.

---

## 1. Core Principles

- ES Module only (`type: "module"`).
- Browser-first: runs without bundlers, toolchains, or Node.js-specific APIs.
- Depends on PulsarJS and GraphletJS. Optionally depends on VoyajerJS. No other dependencies.
- The DOM is the source of structure. Chunklet decorates existing DOM fragments with behavior; it does not replace, clone, or generate DOM nodes.
- HTML may be static, server-rendered, or produced dynamically at runtime by application code. Chunklet supports all three uniformly.
- Every behavior has an explicit, deterministic lifecycle: `mount` → `running` → `destroy`.
- Every resource acquired during `mount` is released during `destroy`.
- A single DOM element may host multiple independent behaviors, each with its own lifecycle and context.
- No state management of its own. Reactive state lives in Pulsar; domain data lives in Graphlet; navigation state lives in Voyajer (when present). Chunklet consumes them but does not own them.
- No templating engine, no expression parsing inside attributes, no virtual DOM.

The move from zero-dependency primitive to stack orchestrator is a deliberate architectural choice: reinventing state, identity, or navigation inside Chunklet would duplicate what the three base primitives already resolve. Chunklet's value is not in being independent from them but in providing a coherent, ergonomic surface for using them together to decorate the DOM.

---

## 2. Core Concepts

### 2.1 The Stack

Chunklet operates over a stack of three primitives:

- **PulsarJS** provides reactive state.
- **GraphletJS** provides the domain model (entities, properties, relationships).
- **VoyajerJS** provides URL synchronization. Optional.

The application initializes the stack through `Chunklet.setup(options)` exactly once. Optionally, the application may later refine the stack through `Chunklet.configure(options)` (§3.2) to replace `graphlet` or `voyajer` without tearing down `pulsar` or the module singleton.

After setup, all behaviors mounted through Chunklet have access to the primitives through the context passed to their factory. The context reads the current stack through getters, so a subsequent `configure()` call is visible to already-mounted behaviors as well.

### 2.2 Chunklet Definition

A Chunklet is a named behavior factory that receives a DOM element and a lifecycle context. The factory is responsible for attaching event listeners, subscribing to Pulsar, reading from Graphlet, invoking navigation, and returning a cleanup function if additional teardown is required.

### 2.3 Chunklet Context

The context is a resource registry and a stack accessor combined. It exposes:

- Automatic resource cleanup helpers (`listen`, `subscribe`, `subscribeSelector`, `observe`, `timeout`, `interval`, `cleanup`), all of which release their resources when the Chunklet is destroyed.
- Direct references to the stack (`ctx.pulsar`, `ctx.graphlet`, `ctx.voyajer`), implemented as getters so a `configure()` call is reflected immediately.
- Convenience shortcuts to the most common operations (`ctx.getState`, `ctx.setState`, `ctx.entity`, `ctx.navigate`, and others).

Each behavior on a multi-behavior element receives its own independent context.

### 2.4 Discovery

Chunklets are discovered by scanning the DOM for elements with the `data-chunk` attribute. The value of the attribute is one or more registered Chunklet names separated by whitespace. Discovery can be triggered explicitly via `Chunklet.mount(element)` or automatically via `Chunklet.observe(root)`.

### 2.5 Multi-Behavior Elements

A single element may declare multiple behaviors, whitespace-separated:

```html
<div class="node" data-entity="node:42" data-chunk="draggable selectable resizable context-menu">...</div>
```

Each named behavior is mounted independently with its own context. Their lifecycles are independent: destroying one does not affect the others. Execution order at mount is the reading order of the attribute value; at destroy, the reverse (LIFO).

### 2.6 Entity Identity

Elements that participate in the external enable/disable mechanism (see §7) declare their identity via the `data-entity` attribute. The value is an opaque string that typically matches a GraphletJS entity identifier (`node:42`, `port:xyz`), but Chunklet treats it as opaque.

Chunklet **never generates identifiers**. If an element has no `data-entity`, it cannot be controlled by the enable/disable mechanism and always mounts all its declared behaviors.

### 2.7 Lifecycle Phases

1. **Mount**: The element is found. For each declared behavior name, the corresponding factory is invoked with the element and a fresh context.
2. **Running**: The behaviors are active. Listeners, subscriptions, timers, and observers are operational.
3. **Destroy**: The behaviors are terminated. All resources registered in each context are automatically released. Each factory's explicit cleanup function (if returned) is invoked, in reverse mount order.

---

## 3. Setup and Configuration Contract

### 3.1 `Chunklet.setup(options)`

Initializes the stack. Must be called exactly once before any `mount`, `define`, or `observe` call operates. Calling `setup` more than once is a runtime error.

**Options**

| Name | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `pulsar` | `PulsarInstance` \| `{ initialState, options }` \| `undefined` | auto-create with `{}` | Existing Pulsar instance, factory configuration, or `undefined` to auto-create with defaults. |
| `graphlet` | `GraphletInstance` \| `undefined` | auto-create empty | Existing Graphlet instance, or `undefined` to auto-create empty. |
| `voyajer` | `VoyajerInstance` \| `{ ...voyajerOptions }` \| `undefined` | not created | Existing Voyajer instance, factory options, or `undefined` to skip Voyajer entirely. |
| `entityAttr` | `string` | `'data-entity'` | Attribute name that carries the entity identifier on controllable elements. |
| `enabledPath` | `string` \| `undefined` | `undefined` | When set, Chunklet subscribes to this path in Pulsar and uses the value to determine which behaviors are active per element (see §7). When `undefined`, all declared behaviors mount unconditionally. |

**Behavior**

1. If `pulsar` is a Pulsar instance, use it. If it is a configuration object, call `createStatePulsar(initialState, options)`. If it is `undefined`, create `createStatePulsar({})`.
2. If `graphlet` is a Graphlet instance, use it. Otherwise create an empty one via `createGraphlet()`.
3. If `voyajer` is a Voyajer instance, use it. If it is an options object, call `createVoyajer(pulsar, options)` with the resolved Pulsar. If `undefined`, do not create Voyajer; `ctx.voyajer` will be `undefined` and navigation helpers will throw when invoked.
4. Store the resolved instances internally as the module-scoped stack.
5. If `enabledPath` is provided, subscribe to that path in Pulsar (via `subscribeSelector`) and remount affected elements when the value changes.

**Throws**

- Throws if called more than once.
- Throws if `pulsar` is neither a Pulsar instance nor a plain object nor `undefined`.
- Throws if `graphlet` is neither a Graphlet instance nor `undefined`.
- Throws if `voyajer` is provided but Voyajer cannot be instantiated (missing options, invalid mode, etc.).
- Throws if `entityAttr` or `enabledPath` are provided but are not non-empty strings.

**Returns**

The resolved stack as `{ pulsar, graphlet, voyajer }`, so the application can hold references to the instances it did not create.

---

### 3.2 `Chunklet.configure(options)`

Refines the stack after `setup()` has been called. Enables patterns where the application must instantiate Chunklet before it knows the full stack configuration (e.g., Voyajer requires a `base` derived from runtime information, or `graphlet` needs to be replaced with a hydrated instance loaded asynchronously).

**Options**

| Name | Type | Description |
| :--- | :--- | :--- |
| `graphlet` | `GraphletInstance` \| `undefined` | Replaces the current Graphlet instance if provided. Not modified if omitted. |
| `voyajer` | `VoyajerInstance` \| `{ ...voyajerOptions }` \| `undefined` | Replaces the current Voyajer instance if provided. If a previous Voyajer existed, its `destroy()` is called before replacement. Not modified if omitted. |

**Not configurable via `configure`:** `pulsar`, `entityAttr`, `enabledPath`. These are fixed at `setup` time. To change any of them, the application must restart the module (currently requires a page reload; a `reset()` helper is deferred to future versions).

**Behavior**

1. If `graphlet` is provided, resolve it (must be an existing Graphlet instance) and assign to the stack. Already-mounted behaviors that access `ctx.graphlet` afterward will see the new instance (getters).
2. If `voyajer` is provided:
   a. If a previous Voyajer existed and exposes `destroy`, call it. This detaches its event listeners and marks it inert.
   b. Resolve the new Voyajer (existing instance or options for a fresh one) and assign to the stack.
3. Return the current stack `{ pulsar, graphlet, voyajer }`.

**Throws**

- Throws if called before `setup()`.
- Throws if `options` is not a plain object.
- Throws if `graphlet` is provided but is not a Graphlet instance.
- Throws if `voyajer` is provided but cannot be resolved (neither an instance nor valid options).

**Returns**

The current stack `{ pulsar, graphlet, voyajer }` with any provided replacements applied.

**Notes**

- Because `ctx.pulsar`, `ctx.graphlet`, `ctx.voyajer` are getters into the stack, a `configure()` call is visible to already-mounted behaviors on their next access. Behaviors that captured `ctx.graphlet` into a local variable before the `configure()` call will still see the old instance through that local reference — code that needs to be robust against `configure()` should always access through `ctx` at use time.
- Behaviors that had subscriptions or listeners against the previous Voyajer's Pulsar path continue to function, since `pulsar` itself does not change; the URL side of the story simply becomes served by a different Voyajer.

---

### 3.3 Canonical Startup Sequence

```javascript
import * as Chunklet from './chunklet.js';

// 1. Setup: initialize the stack.
const { pulsar, graphlet, voyajer } = Chunklet.setup({
  pulsar: { initialState: { ui: {}, entities: {} } },
  voyajer: { mode: 'hash' }
});

// 2. Optional hydration: load persisted data into graphlet/pulsar
//    BEFORE mounting behaviors, so the first render sees populated state.
//    See adapters/hydration-adapter.spec.md.
await hydrateFromStorage(graphlet, pulsar);

// 3. Optional configure: refine stack pieces discovered after setup.
//    Example: swap Voyajer once we know the runtime base path.
Chunklet.configure({ voyajer: { mode: 'history', base: runtimeBase } });

// 4. Define behaviors.
Chunklet.define('node-card', (element, ctx) => {
  const id = element.dataset.entity;
  const node = ctx.entity(id);
  // ...
});

// 5. Mount: attach behaviors to existing DOM.
Chunklet.mount(document.body);

// 6. Optional: observe for dynamically inserted HTML.
Chunklet.observe(document.body);
```

---

## 4. Global API

### `Chunklet.setup(options)` — See §3.1.

### `Chunklet.configure(options)` — See §3.2.

### `Chunklet.define(name, factory)`

Registers a new Chunklet behavior. Must be called after `setup`.

**Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | A unique identifier for the behavior. Referenced in `data-chunk` alone or as part of a whitespace-separated list. |
| `factory` | `function` | A factory: `(element: Element, ctx: Context) => void \| { destroy: function }`. |

**Behavior**

- If a Chunklet with the same `name` is already defined, the new definition overwrites the previous one.
- The factory may optionally return an object with a `destroy` method for custom teardown that the context does not capture.

**Throws**

- Throws if called before `setup`.
- Throws if `name` is not a non-empty string.
- Throws if `name` contains whitespace.
- Throws if `factory` is not a function.

---

### `Chunklet.mount(element)`

Discovers and mounts all Chunklets within the given element's subtree.

**Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `element` | `Element` | The root element to scan for `data-chunk` attributes. |

**Behavior**

- Scans the subtree of `element` (including the element itself) for elements with a `data-chunk` attribute.
- For each matching element, parses the attribute value as a whitespace-separated list of behavior names.
- For each name in the list, if the corresponding behavior is not already mounted on the element, the factory is invoked with a new context.
- If the enable/disable mechanism is active (§7), only behaviors permitted by the current state are mounted.

**Throws**

- Throws if called before `setup`.
- Throws if `element` is not a valid DOM Element.
- If a behavior name is not registered, logs a warning and skips it. Other behaviors on the same element still mount.

---

### `Chunklet.unmount(element)`

Destroys all Chunklets associated with the given element's subtree.

**Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `element` | `Element` | The root element to unmount. |

**Behavior**

- For every mounted Chunklet within the subtree, in reverse mount order, the context releases all registered resources.
- Each factory's explicit `destroy` method (if provided) is invoked.
- The internal mount record is cleared, allowing the element to be mounted again in the future.

**Returns**

`void`

---

### `Chunklet.observe(root)`

Enables automatic discovery of Chunklets using a `MutationObserver`.

**Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `root` | `Node` | The root node to observe for child additions and removals. |

**Behavior**

- Attaches a `MutationObserver` to `root` watching `childList` and `subtree` mutations.
- When new nodes are added, they are scanned for `data-chunk` attributes and mounted.
- When nodes are removed, any mounted Chunklets within them are unmounted in reverse mount order. Removals are processed before additions within the same mutation batch.
- Observation continues until `disconnect()` is called or the returned disconnect function is invoked.

**Returns**

`function` — A disconnect function specific to this observer.

**Throws**

- Throws if called before `setup`.
- Throws if `root` is not a valid DOM Node.

---

### `Chunklet.disconnect()`

Stops all active `Chunklet.observe` observers. Already-mounted Chunklets are not destroyed by this call — only future automatic discovery ceases.

---

### `Chunklet.enable(entity, name)` and `Chunklet.disable(entity, name)`

Convenience helpers that manipulate the enable/disable state in Pulsar without requiring the application to write to the state tree directly. Only functional when `enabledPath` was configured in `setup`. See §7 for the mechanism and §7.3 for the symmetry contract.

**Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `entity` | `string` | The entity identifier as declared in `data-entity`. |
| `name` | `string` | The name of the behavior to enable or disable. |

**Behavior**

Both operations follow the same shape:

1. Read the current map at `enabledPath` from Pulsar (or `{}` if absent).
2. If there is no entry for `entity`, consult the DOM: read all elements with `[data-entity="${entity}"]` and collect their declared behavior names from `data-chunk`. This becomes the **base list** for the operation.
3. If there is an entry for `entity`, its current array becomes the base list.
4. Compute the next list:
   - `enable`: union of base list with `{name}` (append if absent).
   - `disable`: difference of base list minus `{name}`.
5. Write the new map (with the entry for `entity` replaced) back to Pulsar via `setState`.

The write is always performed, even when the resulting list is identical to the base list or empty. This materializes the caller's intent as an explicit entry that downstream code (persistence, cross-tab sync, undo/redo) can observe. Consumers that want to suppress notifications on identical writes can enable Pulsar's `skipEqualUpdates`.

**Throws**

- Throws if called before `setup`.
- Throws if `enabledPath` is not configured.
- Throws if `entity` or `name` is not a non-empty string.

---

## 5. Context API

The `ctx` object passed to every factory exposes:

### 5.1 Stack accessors

Implemented as getters into the module-scoped stack, so `configure()` (§3.2) is reflected immediately on next access.

| Property | Type | Description |
| :--- | :--- | :--- |
| `ctx.pulsar` | `PulsarInstance` | The Pulsar instance. Always present. Not replaceable via `configure()`. |
| `ctx.graphlet` | `GraphletInstance` | The current Graphlet instance. Replaceable via `configure()`. |
| `ctx.voyajer` | `VoyajerInstance` \| `undefined` | The current Voyajer instance if configured, otherwise `undefined`. Can be introduced or replaced via `configure()`. |

### 5.2 Resource registry (auto-cleanup on destroy)

All methods in this group register a resource that is automatically released when the Chunklet is destroyed.

**`ctx.listen(target, event, handler, options?)`** — Attaches a DOM event listener. Auto-removed on destroy with the same arguments.

**`ctx.subscribe(listener)`** — Subscribes to the full state of `ctx.pulsar`. Auto-unsubscribed on destroy.

**`ctx.subscribeSelector(selector, listener, options?)`** — Subscribes to a slice of `ctx.pulsar` via a selector (function or dotted path string). Auto-unsubscribed on destroy. This is the preferred subscription mechanism for UI behaviors.

**`ctx.observe(target, callback, options?)`** — Instantiates a `MutationObserver` on a DOM node. Auto-disconnected on destroy. Default options: `{ childList: true, subtree: true }`.

**`ctx.timeout(handler, delay, ...args)`** — Registers a `setTimeout`. Auto-cleared on destroy.

**`ctx.interval(handler, interval, ...args)`** — Registers a `setInterval`. Auto-cleared on destroy.

**`ctx.cleanup(fn)`** — Registers an arbitrary cleanup function. Executed in reverse registration order (LIFO) on destroy.

### 5.3 Convenience shortcuts

These do not register resources; they are pure delegates to the underlying primitives, provided for ergonomic reasons.

| Shortcut | Equivalent |
| :--- | :--- |
| `ctx.getState()` | `ctx.pulsar.getState()` |
| `ctx.setState(partial)` | `ctx.pulsar.setState(partial)` |
| `ctx.entity(id)` | `ctx.graphlet.get(id)` |
| `ctx.upsertEntity(id, props)` | `ctx.graphlet.upsert(id, props)` |
| `ctx.updateEntity(id, patch)` | `ctx.graphlet.update(id, patch)` |
| `ctx.deleteEntity(id)` | `ctx.graphlet.delete(id)` |
| `ctx.navigate(state)` | `ctx.voyajer.push(state)` — throws if Voyajer not configured |
| `ctx.replace(state)` | `ctx.voyajer.replace(state)` — throws if Voyajer not configured |

The navigation helpers throw a descriptive error (`[Chunklet] Voyajer no configurado`) if called when Voyajer was not passed to setup **and** has not been introduced by `configure()`. This prevents silent no-ops that would be hard to diagnose.

### 5.4 Example: a complete node-card factory

```javascript
Chunklet.define('node-card', (element, ctx) => {
  const nodeId = element.dataset.entity;
  const node = ctx.entity(nodeId);
  if (!node) return; // Silent skip if entity missing.

  element.textContent = node.properties.title || 'Untitled';

  ctx.subscribeSelector(
    (state) => state.ui.selectedNode === nodeId,
    (isSelected) => element.classList.toggle('selected', isSelected)
  );

  ctx.listen(element, 'click', () => {
    ctx.setState({
      ui: { ...ctx.getState().ui, selectedNode: nodeId }
    });
  });

  ctx.listen(element, 'dblclick', () => {
    ctx.navigate({ path: `/node/${nodeId}` });
  });
});
```

Note that the factory does not import Pulsar, Graphlet, or Voyajer. Everything arrives through `ctx`.

---

## 6. Discovery Rules

- An element is decorable if it has a `data-chunk` attribute whose value contains at least one registered name.
- The attribute value is parsed as a whitespace-separated list. Empty values are ignored. Unknown names generate a warning but do not block other names on the same element.
- Each (element, behaviorName) pair is tracked independently. Mounting a new behavior on an already-mounted element only mounts the new behavior; existing ones are untouched.
- Nested Chunklets are fully supported. Parent and child Chunklets have independent lifecycles and contexts.
- If an element with `data-chunk` is added via `innerHTML` and `Chunklet.observe` is active, all its behaviors are automatically mounted (subject to the enable/disable filter if configured).
- If an element with `data-chunk` is removed from the DOM while `Chunklet.observe` is active, all its behaviors are unmounted in reverse mount order.

---

## 7. Enable/Disable Mechanism (Optional)

When the `enabledPath` option is provided to `setup`, Chunklet subscribes to that path in Pulsar. The value at that path is a map from entity identifiers to lists of enabled behavior names. Elements without `data-entity` are unaffected.

### 7.1 State shape

The value at `enabledPath` is a plain object of the following shape:

```javascript
{
  'node:42': ['draggable', 'selectable'],   // only these two are active
  'node:43': [],                            // no behaviors active
  // 'node:44' absent → all declared behaviors active (default)
}
```

The absence of an entry for a given entity means "all declared behaviors active". Explicit empty array means "no behaviors active". Explicit list means "only these behaviors active from among those declared".

### 7.2 Application to the DOM

When the value at `enabledPath` changes, Chunklet iterates the mounted elements. For each element with a `data-entity` that appears in the map, it unmounts all currently mounted behaviors and remounts only the permitted ones. Elements not in the map are untouched.

### 7.3 Symmetry of `enable` and `disable` (C-2, v0.4.0)

Both `Chunklet.enable(entity, name)` and `Chunklet.disable(entity, name)` follow the identical algorithm described in §4 (`Chunklet.enable` / `Chunklet.disable`). The property this establishes:

**Symmetry property.** After any sequence of `enable` and `disable` calls on `(entity, name)` pairs, the value at `enabledPath[entity]` is an explicit array whose contents depend only on the final call and the DOM's declared behaviors, not on whether the entity had a previous entry. There are no silent no-ops that leave the map without an entry.

**Predictability corollary.** Consumers observing `enabledPath` see a deterministic sequence of writes that reflect caller intent. A `disable` followed by an `enable` of the same behavior returns the entry to a state observationally indistinguishable from having never called either (subject to the base list from the DOM), while still producing two explicit writes that persistence or undo/redo layers can capture.

This behavior differs from v0.3.0, where `enable` on an entity without a prior entry was a silent no-op. Applications that depended on that silent no-op must switch to guarding at the call site.

### 7.4 Rationale

This mechanism resolves the pattern where the application wants to toggle behaviors declaratively without individual factories checking permissions. Example: switching a diagram editor to read-only mode disables `draggable` and `resizable` on every node with a single `setState` under `enabledPath`, without touching the node factories at all.

The symmetry established in §7.3 exists because downstream consumers of `enabledPath` (persistence adapters, cross-tab sync, undo/redo) benefit from a map where every relevant entity is represented explicitly. An absent entry is genuinely ambiguous — it can mean "not yet touched" or "no restriction" — whereas an explicit entry always represents a decision.

### 7.5 Identity discipline

The keys in the map are entity identifiers read from `data-entity`. This ties the enable/disable state to the same identifiers used by Graphlet, making it stable across reloads (assuming the application hydrates Graphlet from persistent storage with the same identifiers). Under no circumstances does Chunklet generate synthetic identifiers.

---

## 8. Plug-in / Extension Contract

Chunklet is designed as an orchestration layer, not an extensible framework. The following extension points are exposed:

**Factory wrapping.** Applications may wrap factories before registering them:

```javascript
function withLogging(originalFactory) {
  return (element, ctx) => {
    console.log('Mounting', element);
    ctx.cleanup(() => console.log('Unmounting', element));
    return originalFactory(element, ctx);
  };
}

Chunklet.define('node-card', withLogging(nodeCardFactory));
```

**Custom discovery.** Applications may bypass `Chunklet.mount` and call factories directly if they have custom DOM traversal logic. The factories then receive their context normally through the mount API, or the application constructs a context manually if it needs full control.

---

## 9. Error Handling and Resilience

- **Factory errors.** If a factory throws during `mount`, that specific behavior is considered failed. The error is caught and logged. Other behaviors on the same element still mount successfully. The failed behavior can be retried by explicit unmount/mount.
- **Listener and callback errors.** Errors thrown inside event listeners, store subscriptions, or timers are not caught by Chunklet. The application handles them.
- **Context release errors.** Errors thrown during resource cleanup are caught and logged. All registered resources are still iterated and released.
- **Reentrancy.** `Chunklet.unmount` is reentrant-safe. Calling `unmount` within a listener does not cause double iteration of the context resources.
- **Enable/disable errors.** If the value at `enabledPath` is not a plain object, Chunklet logs a warning and treats it as if the mechanism were disabled (all behaviors mount).

---

## 10. Behavioral Guarantees

| Guarantee | Description |
| :--- | :--- |
| **Single setup** | `setup` must be called exactly once. Subsequent calls throw. |
| **Deferred configuration** | `configure` may be called any number of times after `setup` to replace `graphlet` or `voyajer`. `pulsar` is fixed for the lifetime of the module. |
| **Stack coherence** | All contexts created during a single Chunklet lifetime reference the same Pulsar instance. Access to `graphlet` and `voyajer` through `ctx` goes through getters, so `configure()` replacements are immediately visible. |
| **Resource isolation** | Every Chunklet context is independent. Destroying one Chunklet does not affect another, even on the same element. |
| **Deterministic teardown** | All resources registered via the context are released during destroy. Custom cleanup via `cleanup()` is executed in LIFO order. |
| **Independent multi-behavior lifecycles** | On a multi-behavior element, each behavior has its own context and can fail, be added, or be removed independently. |
| **Manual discovery priority** | Explicitly mounted (element, behavior) pairs are not remounted by `observe`. |
| **Idempotent mount and unmount** | Calling `mount` on already-mounted (element, behavior) pairs is a no-op. Calling `unmount` on an unmounted or non-existent element is a no-op. |
| **Synchronous mount** | `mount` is synchronous. Factories are invoked immediately during the call. |
| **No generated identifiers** | Chunklet never generates identifiers for elements. Identity always comes from the DOM (`data-entity` or the attribute configured in setup). |
| **Voyajer opt-in** | If Voyajer was not configured (via `setup` or `configure`), `ctx.voyajer` is `undefined` and `ctx.navigate`/`ctx.replace` throw when invoked. Silent no-op is never the behavior. |
| **Symmetric enable/disable** | Both operations always produce an explicit entry in the enabled map, materializing intent even when no prior entry existed. See §7.3. |

---

## 11. Relationship with the Base Primitives

Chunklet depends on Pulsar and Graphlet. This is a deliberate design decision, discussed in §1 and formalized in the Nexus Contract (level 3 of the dependency hierarchy; level 4 is the application layer).

The base primitives remain independent of Chunklet and of each other. A consumer who wants only Pulsar, only Graphlet, or Pulsar+Voyajer without Chunklet can use them without ever loading Chunklet. This preserves the option that the base primitives be published, tested, and consumed independently.

Chunklet's role is not to reimplement identity, reactivity, or navigation — those exist in the base primitives. Chunklet's role is to bind the DOM to them with a coherent lifecycle, a resource discipline, and an ergonomic surface. Any capability that could be implemented on top of the base primitives without touching the DOM belongs in an adapter or an application module — not in Chunklet.

### 11.1 What belongs in Chunklet vs. in Adapters

An adapter observes primitives from outside and translates between them (Graphlet mutations to Pulsar projections, Pulsar changes to persistent storage, external events to primitive updates). Chunklet's factories operate inside the primitives, decorating DOM in response to their state. When you find yourself writing "on every Graphlet mutation, sync X", that is adapter work; when you find yourself writing "on every relevant state change, update this element's appearance", that is Chunklet work.

### 11.2 Emerging capability: composition helpers in `ctx`

A pattern emerging from real widget construction is the need to subscribe to an entity together with the entities it references through relations. Coordinating these subscriptions (adding/removing as the reference set changes, cleanup on unmount) is boilerplate that will repeat across widgets.

The resolution — a Chunklet `ctx` helper that watches an entity together with its related entities and re-invokes a callback when any of them change — has been decided architecturally to live in `ctx` (natural extension of the existing subscription primitives) but its exact API will be discovered iteratively during widget construction rather than specified in advance. See `PHASE_0_DEFERRED.md` (WIDGET-COMPOSITION).

---

## 12. Testing Considerations

Chunklet's dependency on the DOM means unit tests require either a browser environment or a DOM shim. For consistency with the rest of the Nexus stack (browser-first, no Node runtime required for production), the recommended approach is a browser-native test harness analogous to those used for Pulsar, Graphlet, and Voyajer.

Testable factories should be structured so that their behavior can be verified by:
1. Setting up Chunklet with an in-memory Pulsar and Graphlet.
2. Constructing a DOM fragment programmatically.
3. Mounting the fragment.
4. Asserting on the DOM state, Pulsar state, and Graphlet state after simulated events or state changes.
5. Unmounting and asserting that no resources leak (no leftover event listeners on the document, no active timers).

An optional test-utility helper (`Chunklet.reset()`) is deferred to future versions to allow test files to reinitialize the stack between test cases without a full page reload.

**Note on enable/disable tests.** Tests for the enable/disable mechanism (§7) require `enabledPath` to be configured at `setup`. Because `setup` can only be called once per module, a single test harness sharing one setup cannot cleanly test enable/disable in isolation from tests that assume the mechanism is off. The recommended pattern is a dedicated harness file (`chunklet-enable.test.html`) that runs its own setup with `enabledPath`. See `PHASE_0_DEFERRED.md` (C-T7, C-2 sym).

---

## 13. Export Contract

The module must expose a named export object containing all public methods:

```javascript
export { setup, configure, define, mount, unmount, observe, disconnect, enable, disable };
```

A default export bundling the same methods is also provided for `import Chunklet from '...'` style consumers.

The module must be compatible with the following import semantics:

```html
<script type="module">
  import * as Chunklet from 'https://cdn.jsdelivr.net/npm/@dfc/chunklet/chunklet.js';

  Chunklet.setup({ /* ... */ });
  Chunklet.define('my-behavior', (el, ctx) => { /* ... */ });
  Chunklet.mount(document.body);
</script>
```

Importing individual names is also supported for tree-shaking or terseness:

```javascript
import { setup, configure, define, mount } from '@dfc/chunklet';
```

Chunklet internally imports Pulsar, Graphlet, and optionally Voyajer from their canonical entry points. The exact import specifiers depend on the distribution channel:

- On npm / CDN: `import { createStatePulsar } from '@dfc/pulsar'` (equivalent for Graphlet and Voyajer).
- In a self-contained project: relative paths (`./pulsar.js`, etc.).

Chunklet does not bundle the base primitives. The consumer is responsible for ensuring they are resolvable at import time.

---

## 14. Versioning and Backward Compatibility

- **Patch releases:** Bug fixes that do not alter the public API signature.
- **Minor releases:** Additive features (e.g., new context helpers, new setup options) that do not break existing consumers.
- **Major releases:** Breaking changes to the API, changes to the lifecycle order, removal of context methods, or changes to how the stack is initialized or configured.

The following are considered part of the public API and cannot change without a major version bump:

- The names and signatures of `setup`, `configure`, `define`, `mount`, `unmount`, `observe`, `disconnect`, `enable`, `disable`.
- The names and signatures of context methods (`listen`, `subscribe`, `subscribeSelector`, `observe`, `timeout`, `interval`, `cleanup`).
- The names and signatures of context shortcuts (`getState`, `setState`, `entity`, `upsertEntity`, `updateEntity`, `deleteEntity`, `navigate`, `replace`).
- The set of stack accessors on `ctx` (`pulsar`, `graphlet`, `voyajer`) and their behavior as live getters.
- The shape of the `enabledPath` value (§7.1) and the symmetry contract of `enable`/`disable` (§7.3).
- The rule that identity comes from the DOM and Chunklet never generates identifiers.
- Multi-behavior support via whitespace-separated `data-chunk` values.
- The requirement that `setup` be called before any other API method, and that `configure` may be called only after `setup`.
- The rule that `pulsar` is fixed at `setup` time and cannot be replaced by `configure`.

---

## Change Summary (v0.3.0 → v0.4.0)

**Breaking:**
- §4 `enable` / `disable`: behavior changed to be symmetric. Both operations now always produce an explicit entry in the map at `enabledPath`, consulting the DOM to materialize the base list when no prior entry exists. See §7.3. Applications that relied on `enable` being a silent no-op on entities without prior entries must adapt.
- §3.2, §4: new public API `configure()` added. Allows `graphlet` and `voyajer` (not `pulsar`) to be replaced after `setup`. Its introduction shifts the "single setup" guarantee: `setup` is still once-only, but the stack is no longer immutable after setup — it is refinable via `configure`. Consumers that assumed the stack was frozen after `setup` should audit for that assumption.

**Additive/Clarifying:**
- Header: changelog block documenting v0.3.0 → v0.4.0 breaking changes and their consumer impact. Note about the non-breaking C-1 helper unification.
- §2.1 (The Stack): paragraph added on how `configure` refines the stack and how getters make refinements visible to already-mounted behaviors.
- §2.3 (Chunklet Context): note added that stack accessors are getters.
- §3.1 (setup): `Throws` list extended with validation of `entityAttr` and `enabledPath`.
- §3.2 (new subsection): full contract for `configure`.
- §3.3 (Canonical Startup Sequence): updated example includes an optional `configure()` step.
- §4: entry added for `configure`. `enable`/`disable` entry rewritten with the full symmetric algorithm.
- §4 `observe`: clarified that removals are processed before additions within the same mutation batch, formalizing an existing implementation guarantee.
- §5.1 (Stack accessors): rewritten as a table with note about getter semantics and which are replaceable via `configure`.
- §5.3 (Convenience shortcuts): navigation helpers note updated to mention `configure` as an alternative path to enabling Voyajer.
- §7 (Enable/Disable Mechanism): §7.3 rewritten as the formal symmetry contract with a "predictability corollary" for downstream consumers. §7.4 (Rationale) rewritten to explain why explicit entries matter for persistence/sync/undo. Old §7.4 (Identity discipline) renumbered to §7.5.
- §10 (Behavioral Guarantees): new rows for "Deferred configuration" and "Symmetric enable/disable". "Stack coherence" row rewritten to distinguish `pulsar` (fixed) from `graphlet`/`voyajer` (refinable). "Voyajer opt-in" row updated to mention `configure` as an alternative introduction path.
- §11.2 (Emerging capability): new subsection referencing the `PHASE_0_DEFERRED.md` item WIDGET-COMPOSITION.
- §12 (Testing Considerations): note added on the dedicated harness pattern for enable/disable tests, cross-referencing the deferred items.
- §13 (Export Contract): `configure` added to the exports list. Note added about the default export bundle.
- §14 (Versioning): `configure` signature added to the API-stable list. New entries for the pulsar-is-fixed rule and the symmetry contract.

**Corrective (post-write):**
- §11: reference "level 4 of the dependency hierarchy" corrected to "level 3" (level 4 is the application layer per Nexus Contract §3). Alignment fix caught during Nexus Contract audit; no semantic change.

**Not changed:**
- Lifecycle phases (§2.7).
- Multi-behavior element semantics (§2.5).
- Discovery rules (§6).
- Extension contract (§8) other than as it composes with the above.
- Error handling policies (§9).
- The Nexus-level relationship (§11.1).

---

*End of Specification.*
