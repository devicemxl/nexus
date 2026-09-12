# PulsarJS Contract Specification

**Version:** 0.2.1
**Status:** Design Contract (pre-implementation)
**Scope:** Core reactive state management primitive for browser environments.

**Changes from v0.2.0 (documentation only, no API change):**
- §6 gains one guarantee row (**Reentrancy value coherence**) formalizing what
  the code has done since `pulsar.js` v0.2.2. The behavior existed under-specified
  before; the row makes the promise explicit so a future implementation cannot
  regress silently. See `PULSAR_R1_FIX.md` for the defect analysis that
  motivated the addition.

---

## 1. Core Principles

- Zero runtime dependencies.
- ES Module only (`type: "module"`).
- Browser-first: runs without bundlers, toolchains, or Node.js-specific APIs.
- Immutability is encouraged but not enforced by default; the core provides opt-in defensive mechanisms.
- Notification is synchronous and reentrancy-safe.
- Selective subscription is a first-class core capability, not a plug-in, because hot-path applications (editors, drag-and-drop, streaming UIs) cannot afford full-tree notification per update.
- The core does not handle asynchronous actions, side effects, or derivation. Those are delegated to application logic, Commands, or optional plug-ins.

---

## 2. Factory Function

### `createStatePulsar(initialState, options)`

Creates a new Pulsar instance.

**Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `initialState` | `object` | The initial state tree. Must be a plain object. |
| `options` | `object` | Optional configuration object. |

**Options**

| Name | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `freeze` | `boolean` | `true` | If `true`, recursively freezes the state object (`Object.freeze`) after every `setState`. Prevents accidental mutations of nested properties. Disable for large state trees or hot paths where performance is critical. |
| `skipEqualUpdates` | `boolean` | `false` | If `true`, `setState` compares the current state with the new state using shallow equality. If equal, `_notify()` is not called. |

**Returns**

An instance with the methods defined in Section 3.

**Throws**

- Throws if `initialState` is not a plain object.

---

## 3. Instance API

### `getState()`

Returns the current state object.

- If `freeze` is `true`, the returned object is deeply frozen.
- The returned reference may be the internal state object itself or a shallow copy depending on the implementation. Consumers **must not** mutate the returned object directly. Mutations must go through `setState`.

**Returns:** `object` – The current state.

---

### `setState(partial)`

Merges the provided `partial` object into the current state using a shallow merge.

**Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `partial` | `object` | An object containing the properties to update. Nested properties are replaced, not merged. |

**Behavior**

1. Creates a new state object: `next = { ...this.state, ...partial }`.
2. If `skipEqualUpdates` is `true` and `shallowEqual(this.state, next)` is `true`, the method returns immediately without notifying.
3. If `freeze` is `true`, applies `deepFreeze` to `next`.
4. Assigns `this.state = next`.
5. Calls `this._notify()`.

**Throws**

- Throws if `partial` is not a plain object.

**Notes**

- `setState` does not support functional updaters (e.g., `(state) => newState`). That capability is provided by the optional Immer plug-in (`withImmer`).
- To update nested properties, consumers must provide the full nested path:
  `store.setState({ user: { ...store.getState().user, name: "Alice" } })`.

---

### `subscribe(listener, options?)`

Adds a listener function that is called whenever `_notify()` is invoked with the entire state.

**Parameters**

| Name | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `listener` | `function` | – | A callback that receives the new state as its only argument: `(state) => void`. |
| `options.immediate` | `boolean` | `false` | If `true`, the listener is invoked synchronously with the current state before the subscription is finalized. |

**Returns**

`function` – An unsubscribe function. Calling it removes the listener from the internal set.

**Behavior**

- The listener is added to a `Set` of listeners.
- If `immediate` is `true`, the listener is called with `this.getState()` before the function returns.
- Errors thrown inside a listener are caught and swallowed to prevent them from breaking other listeners or the notification loop.

**When to Use `subscribe` vs `subscribeSelector`**

Use `subscribe` when the listener genuinely needs the entire state (debug loggers, DevTools bridges, persistence adapters that serialize everything). For all UI-facing consumers, `subscribeSelector` is preferred.

---

### `subscribeSelector(selector, listener, options?)`

Adds a listener that fires only when the value derived by `selector` changes. This is the primary subscription mechanism for UI consumers.

**Parameters**

| Name | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `selector` | `function` or `string` | – | Either a function `(state) => any` that computes a derived value, or a dotted path string (e.g., `'ui.selectedNode'`). |
| `listener` | `function` | – | Callback `(currentValue, previousValue, state) => void` invoked when the derived value changes. |
| `options.equality` | `function` | `Object.is` | Custom equality function `(a, b) => boolean`. Defaults to reference equality. |
| `options.immediate` | `boolean` | `false` | If `true`, the listener is invoked synchronously with the current value on subscribe. |

**Returns**

`function` – An unsubscribe function.

**Behavior**

1. On subscribe, the selector is evaluated once to establish the baseline value.
2. On every `_notify()`, the selector is evaluated against the new state.
3. If the new derived value is not equal (per `equality`) to the previous derived value, the listener is called with `(newValue, previousValue, state)`.
4. If equal, the listener is skipped.
5. Errors thrown by the selector or listener are caught and logged. Other selectors continue to evaluate.

**String Path Shortcut**

When `selector` is a string, it is interpreted as a dotted path into the state (with bracket notation supported for array indices). The following are equivalent:

```javascript
store.subscribeSelector('ui.selectedNode', listener);
store.subscribeSelector((s) => s.ui?.selectedNode, listener);
```

The string form is a convenience for the common case of subscribing to a specific slice. For any derivation involving computation or multiple slices, use the function form.

**Rationale**

Applications like editors, dashboards, and dynamic UIs subscribe many listeners to small slices of state. Without selective subscription, every `setState` walks every listener. `subscribeSelector` is placed in the core (not a plug-in) because the arithmetic of "N listeners × M setState calls per second" becomes prohibitive for interactive applications the moment the store crosses trivial sizes. Deferring this capability to an optional plug-in would either force applications to always install it (making it de facto core) or produce silent performance failures in real usage.

**Example**

```javascript
// Subscribe to a specific node's position, ignoring other state changes.
const unsub = store.subscribeSelector(
  (s) => s.entities?.[`node_${nodeId}`]?.position,
  (pos, prev) => {
    element.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  },
  { immediate: true }
);

// Later:
unsub();
```

---

### `_notify()`

Internal method that broadcasts the current state to all subscribed listeners (both `subscribe` and `subscribeSelector`).

**Behavior**

- Creates a **snapshot** of the current listener registries before iterating (`[...this.listeners]` and equivalent for selector subscriptions).
- Iterates over the snapshot and invokes each listener with the current state (or evaluates selectors and invokes only listeners whose derived value changed).
- Catches and logs any error thrown by a listener or selector (implementation may use `console.error`). The loop continues to the next listener.

**Accessibility**

- This method is intentionally public to enable plug-in composition. Plug-ins may override or wrap this method.
- Direct calls by application code are discouraged.

---

## 4. Plug-in Extension Contract

Plug-ins are functions that follow the `withX(pulsar)` pattern.

### Signature

```typescript
type Plugin = (pulsar: PulsarInstance) => PulsarInstance;
```

### Rules for Plug-ins

1.  Plug-ins receive a fully instantiated Pulsar object.
2.  Plug-ins may modify or replace public methods (`setState`, `subscribe`, `subscribeSelector`, `getState`).
3.  Plug-ins may access internal properties: `state`, `listeners`, `_notify`.
4.  Plug-ins **must** return the same instance (mutation) or a wrapped instance that preserves the original API surface.
5.  If a plug-in modifies `setState`, it should call the original method or `_notify()` to preserve notification semantics.
6.  Plug-ins should be pure in their composition order. Later plug-ins wrap earlier ones.

### Composition Example

```javascript
const store = withDevTools(
  withLogger(
    withImmer(
      createStatePulsar({ ui: {}, entities: {} })
    )
  )
);
```

Ordering convention: outer plug-ins wrap inner ones. The innermost plug-in (`withImmer`) handles the raw state mutation, while outer plug-ins (`withLogger`, `withDevTools`) intercept the operation for logging or debugging.

---

## 5. Error Handling and Resilience

- **Listener errors:** Errors thrown inside `subscribe` and `subscribeSelector` listeners are caught by `_notify()`. They do not prevent other listeners from firing, nor do they break the `setState` operation. The implementation logs the error to the console for debugging.
- **Selector errors:** Errors thrown inside a selector function are caught and logged. The selector's listener is not invoked for that update; other selectors continue to evaluate normally.
- **Freeze errors:** `Object.freeze` is silent on failure. No errors are thrown for non-extensible objects.
- **Invalid arguments:** `setState` and `createStatePulsar` must validate that inputs are plain objects and throw a `TypeError` otherwise.

---

## 6. Behavioral Guarantees

| Guarantee | Description |
| :--- | :--- |
| **Synchronous notification** | `_notify()` is called synchronously within `setState`. No microtask or macrotask scheduling. |
| **Reentrancy safety** | If a listener subscribes or unsubscribes during `_notify()`, the iteration uses a snapshot of the registry. The new subscription will **not** be called until the next `setState`. |
| **Shallow merge only** | `setState` does not deep merge. Nested objects are fully replaced. |
| **State reference stability** | When `skipEqualUpdates` is `false`, every `setState` produces a new state object reference, even if the merge result is identical. |
| **Freeze recursion** | If `freeze` is `true`, `deepFreeze` is applied recursively. Arrays are frozen but not deeply cloned. |
| **Selective notification** | `subscribeSelector` listeners fire only when their derived value changes per the configured equality. This is a guarantee, not an optimization. |
| **Reentrancy value coherence** | If a `subscribeSelector` listener triggers a `setState` during `_notify`, the nested notification receives as `previousValue` the value immediately preceding it, and the outer frame does not overwrite the advance made by the reentrant call. Remaining listeners of the same selector are evaluated against the post-mutation state. The sequence of values delivered to any single listener is monotonic with respect to the actual order of transitions. |

---

## 7. Recommended State Tree Convention

Pulsar itself imposes no structure on the state tree, but the **Nexus Contract Specification** defines a namespacing convention for applications that combine multiple producers (Voyajer, Binder, Graphlet adapters, application code). Consumers of Pulsar in Nexus applications are strongly encouraged to follow that convention:

- `route.*` — VoyajerJS
- `form.*` — BinderJS
- `entities.*` — Graphlet-to-Pulsar adapter projections
- `ui.*` — application-owned UI state
- `net.*` — network request states

This convention is a recommendation. Pulsar used in isolation may adopt any shape.

---

## 8. Export Contract

The module must expose a single named export:

```javascript
export { createStatePulsar };
```

No default export is required.

The module must be compatible with the following import semantics:

```html
<script type="module">
  import { createStatePulsar } from 'https://cdn.jsdelivr.net/npm/@dfc/pulsar/pulsar.js';
</script>
```

---

## 9. Versioning and Backward Compatibility

- **Patch releases:** Bug fixes that do not alter the public API signature.
- **Minor releases:** Additive features (e.g., new options, new methods) that do not break existing consumers.
- **Major releases:** Breaking changes to the API, internal contract exposed to plug-ins, or removal of options.

The plug-in extension contract (`state`, `listeners`, `_notify`, `subscribe`, `subscribeSelector`) is considered part of the public API for plug-in authors. Changes to these internal properties are **breaking changes** and require a major version bump.

---

*End of Specification.*
