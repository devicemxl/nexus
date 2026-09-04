# VoyajerJS Contract Specification

**Version:** 0.2.1
**Status:** Design Contract (pre-implementation)
**Scope:** URL synchronization primitive for browser environments.

**Changes from v0.2.0:**
- Added `mode` and `base` options, previously undocumented but present in early implementations. Both are now first-class configuration.
- Documented the URL normalization performed before invoking `parse`, which lets a single parse/serialize pair work symmetrically in both `history` and `hash` modes.
- Clarified the idempotence rule for `push` and `replace`, which was stated but not fully specified in v0.2.0.


## 1. Core Principles

- Zero runtime dependencies.
- ES Module only (`type: "module"`).
- Browser-first: runs without bundlers, toolchains, or Node.js-specific APIs.
- The URL (pathname, search, hash) is a serialized representation of application navigation state.
- Voyajer synchronizes the URL with a Pulsar store. It writes navigation state to Pulsar; it does not read Pulsar to update the URL automatically.
- Programmatic navigation is explicit: the application calls Voyajer methods to change the URL and update the store.
- The core does not handle route matching, parameter extraction, or authorization. These are delegated to the application via a parse/serialize contract.
- No DOM manipulation. Voyajer does not set classes, attributes, or text content on any element. It interacts only with `window.history`, `window.location`, and the Pulsar store.


## 2. Core Concepts

### 2.1 Navigation State

Navigation state is a plain JavaScript object that represents the current location. It typically includes a view name, identifiers, query parameters, and hash values. The shape is application-defined.

### 2.2 URL Serialization

Two functions define the bidirectional mapping between URL strings and navigation state:

- `parse(url: URL) => object | null`: Converts a URL object to a navigation state object. Returns `null` if the URL does not match any known route.
- `serialize(state: object) => string | null`: Converts a navigation state object to a URL string. Returns `null` if the state cannot be serialized to a valid URL.

The defaults are designed to be **symmetric**: parsing a URL and then serializing the parsed state reproduces the original URL.

### 2.3 Store Key

Voyajer writes the navigation state to a specific key in the Pulsar store. The default key is `'route'`. The application may choose a different key to avoid collisions with other state. This aligns with the state-tree namespacing convention in the Nexus Contract Specification.

### 2.4 Routing Modes

Voyajer supports two routing modes. Both are equally first-class; the default is `'history'` because it aligns with the default `parse`/`serialize` pair.

**History mode (`mode: 'history'`).** Uses the HTML5 History API (`pushState`, `replaceState`, `popstate`). The URL is a real pathname (e.g., `/projects/42`) and requires the server to serve the same document for all supported paths. Recommended for applications that control their server, including local files served through a dev server.

**Hash mode (`mode: 'hash'`).** Uses the URL fragment (`#/projects/42`) to represent the route. Requires no server cooperation because the fragment is never sent to the server. Recommended for applications that must run from `file://`, static hosts without SPA support, or embedded contexts (e.g., a diagram editor loaded as a page inside another application).

### 2.5 Base Path

The `base` option (default `'/'`) is a path prefix in front of every URL Voyajer produces. Useful when the application is mounted at a subpath like `/admin/` or `/tool.v2/`. In history mode, `base` is prepended to every `pushState`/`replaceState` call and subtracted from the URL before parsing. In hash mode, `base` is ignored because the hash fragment is inherently rooted.


## 3. Factory Function

### `createVoyajer(pulsarStore, options)`

Creates a new Voyajer instance.

**Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `pulsarStore` | `object` | A Pulsar instance (or any store with a `setState` method). |
| `options` | `object` | Configuration object. |

**Options**

| Name | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `key` | `string` | `'route'` | Key in the Pulsar store where navigation state is written. |
| `mode` | `string` | `'history'` | `'history'` (HTML5 History API) or `'hash'` (URL fragment). |
| `base` | `string` | `'/'` | Path prefix mounted in front of every URL. Ignored in hash mode. |
| `parse` | `function` | See §5 | Function `(URL) => object | null`. Receives a virtual URL normalized according to `mode` (see §5.4). |
| `serialize` | `function` | See §5 | Function `(state) => string | null`. Produces a path string (with leading slash) that Voyajer combines with `base` and `mode` to form the effective URL. |
| `writeOnInit` | `boolean` | `true` | If `true`, writes the current URL to the Pulsar store immediately upon instantiation. |

**Throws**

- Throws if `pulsarStore` does not expose `getState` and `setState`.
- Throws if `mode` is provided and is not `'history'` or `'hash'`.
- Throws if `parse` is provided and is not a function.
- Throws if `serialize` is provided and is not a function.

**Returns**

An instance with the methods defined in Section 4.


## 4. Instance API

### `push(state)`

Navigates to a new location, adding a new entry to the browser history stack.

**Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `state` | `object` | The navigation state object to serialize. |

**Behavior**

1. Calls `serialize(state)` to obtain a URL string.
2. If `serialize` returns `null`, `undefined`, or an empty string, the method returns without performing any navigation.
3. If the serialized URL is identical to the current URL (comparing against Voyajer's canonical representation of the current location), the method returns without navigating and without notifying subscribers.
4. In history mode, calls `window.history.pushState(null, '', base + url)`.
5. In hash mode, assigns `url` to `window.location.hash`.
6. Synchronously reads the new URL back and writes the parsed state to the Pulsar store.

**Throws**

- Throws if `state` is not a plain object.
- Throws if `serialize` throws an error.

**Returns**

`void`


### `replace(state)`

Navigates replacing the current entry in the browser history stack.

**Behavior**

Identical to `push(state)` in terms of validation, idempotence, and store update. The difference is that in history mode it uses `replaceState` instead of `pushState`, and in hash mode it uses `window.location.replace` with the same-origin URL modified to carry the new hash.

**Returns**

`void`


### `back()`, `forward()`, `go(delta)`

Direct proxies to the corresponding methods of `window.history`. The `popstate` event that follows (in history mode) or the `hashchange` event (in hash mode) triggers `_updateStoreFromURL()` internally and refreshes the Pulsar store.


### `getCurrent()`

Returns the current navigation state from the Pulsar store.

**Returns**

`object | null` – The current navigation state, or `null` if no state has been written.


### `sync()`

Reads the current browser URL, parses it, and writes the resulting state to the Pulsar store.

**Behavior**

1. Constructs a virtual URL according to `mode` (see §5.4).
2. Calls `parse(url)` to obtain a navigation state object.
3. If `parse` returns `null`, the method returns without writing to the store.
4. Writes the parsed state to the Pulsar store under the configured `key`.

**Returns**

`void`

**Notes**

- This method is automatically called on `popstate` and `hashchange` events while the instance is active.
- It may also be called manually to force synchronization after external URL changes that do not trigger these events.


### `destroy()`

Stops all event listeners and marks the instance as inert.

**Behavior**

- Removes the `popstate` and `hashchange` event listeners attached during instantiation.
- Does not modify the browser history or the Pulsar store.
- After `destroy` is called, all methods either no-op or throw.

**Returns**

`void`


## 5. URL Parsing and Serialization Contract

### 5.1 Default Implementations

The defaults are symmetric: `serialize(parse(url))` reproduces the input URL string.

**Default `parse`:**

```javascript
(url) => ({
  path: url.pathname,
  search: url.search,
  hash: url.hash
})
```

**Default `serialize`:**

```javascript
(state) => {
  const path = state.path || '/';
  const search = state.search || '';
  const hash = state.hash || '';
  return `${path}${search}${hash}`;
}
```

### 5.2 `parse(url)` Contract

**Signature:** `(url: URL) => object | null`

- Receives a `URL` object (the browser's built-in `URL` class), normalized according to `mode` (see §5.4).
- Returns a plain object representing the navigation state.
- If the URL does not correspond to a known route, returns `null`. Returning `null` prevents the store from being updated.
- Must be pure: given the same `URL` object, it must return the same state object.

### 5.3 `serialize(state)` Contract

**Signature:** `(state: object) => string | null`

- Receives a navigation state object.
- Returns a string representing a path (starting with `/`) that Voyajer will combine with `base` and `mode` to form the effective URL.
- The returned string should not include `base`; Voyajer prepends it in history mode.
- If the state cannot be serialized (e.g., missing required fields), returns `null`. Returning `null` prevents navigation.
- Must be pure: given the same state object, it must return the same string.

### 5.4 URL Normalization Before `parse`

Voyajer constructs a virtual URL before invoking `parse`, so that the same parse function works in both routing modes without knowing the configuration.

**In history mode.** The virtual URL is the real URL of the page, with `base` stripped from `pathname`. Example: with `base: '/admin/'` and current location `https://app.com/admin/projects/42?filter=active`, the virtual URL has pathname `/projects/42` and search `?filter=active`.

**In hash mode.** The virtual URL is constructed by promoting the hash fragment (minus the leading `#`) to the pathname of a synthetic URL, using the real origin. Example: current location `https://app.com/#/projects/42?filter=active`, virtual URL is `https://app.com/projects/42?filter=active` and `parse` sees `pathname = '/projects/42'`, `search = '?filter=active'`.

This normalization is the reason a single `parse`/`serialize` pair works in both modes: parsers can be written against `url.pathname` and `url.search` without branching on the mode.

### 5.5 Custom Parse/Serialize Example

For an application with structured routes:

```javascript
const voyajer = createVoyajer(store, {
  mode: 'history',
  parse: (url) => {
    const match = url.pathname.match(/^\/projects\/(\w+)$/);
    if (match) return { view: 'project', projectId: match[1] };
    if (url.pathname === '/') return { view: 'dashboard' };
    return null;
  },
  serialize: (state) => {
    if (state.view === 'project') return `/projects/${state.projectId}`;
    if (state.view === 'dashboard') return '/';
    return null;
  }
});
```

The same parse and serialize functions would work unchanged if `mode: 'hash'` were passed instead, because the URLs they see (via normalization) look identical.


## 6. Event Handling

### Popstate (history mode)

- When the user navigates via browser back/forward buttons, `popstate` is triggered.
- Voyajer listens for `popstate` and calls `sync()`.

### Hashchange (hash mode)

- When the hash fragment changes via anchor links, manual URL editing, or `window.location.hash = ...`, the `hashchange` event is triggered.
- Voyajer listens for `hashchange` and calls `sync()`.

### Programmatic Navigation

- `push` and `replace` update the URL via the appropriate API (`history` in history mode, `window.location.hash`/`window.location.replace` in hash mode).
- `pushState` and `replaceState` do not trigger `popstate`. Voyajer updates the store synchronously within the method call.
- In hash mode, assigning to `window.location.hash` does trigger `hashchange`, but Voyajer's synchronous update inside `push`/`replace` happens before the event fires, and the event handler's `_updateStoreFromURL` writes the same state — this is a redundant but harmless double write.


## 7. Behavioral Guarantees

| Guarantee | Description |
| :--- | :--- |
| **Synchronous store writes** | `push` and `replace` call `pulsarStore.setState` synchronously. The store is updated before the method returns. |
| **Idempotent navigation** | If `push` or `replace` is called with a state that serializes to the current URL, the operation is a no-op (no history entry, no store notification). |
| **No automatic store subscription** | Voyajer does not subscribe to Pulsar. It writes to the store but does not react to external changes to the same key. This prevents infinite update loops. |
| **Event listener cleanup** | `destroy()` removes all event listeners. No memory leaks. |
| **No DOM mutation** | Voyajer never reads from or writes to `document`. It works exclusively with `window.location` and `window.history`. |
| **Silent failure for null** | If `parse` returns `null` on a URL change, the store is not updated. If `serialize` returns `null` or an empty string on `push`/`replace`, the navigation is aborted with a warning. |
| **Symmetric defaults** | The default `parse` and `serialize` are round-trip compatible: `serialize(parse(url))` reproduces the input URL. |
| **Mode-agnostic parsing** | Custom parse/serialize functions written against pathname and search work identically in both `history` and `hash` modes, thanks to URL normalization before parse. |


## 8. Integration with ChunkletJS

Voyajer does not depend on Chunklet. However, Chunklet behaviors commonly read the navigation state from Pulsar to conditionally render or apply active states.

Example pattern within a Chunklet:

```javascript
Chunklet.define('nav-link', (element, ctx) => {
  const href = element.getAttribute('data-href');
  const store = window.__pulsar;
  const voyajer = window.__voyajer;

  ctx.subscribeSelector(store, 'route.path', (path) => {
    element.classList.toggle('active', path === href);
  }, { immediate: true });

  ctx.listen(element, 'click', (e) => {
    e.preventDefault();
    voyajer.push({ path: href });
  });
});
```


## 9. Export Contract

The module must expose a single named export:

```javascript
export { createVoyajer };
```

The module must be compatible with the following import semantics:

```html
<script type="module">
  import { createVoyajer } from 'https://cdn.jsdelivr.net/npm/@dfc/voyajer/voyajer.js';
</script>
```


## 10. Versioning and Backward Compatibility

- **Patch releases:** Bug fixes that do not alter the public API signature.
- **Minor releases:** Additive features (e.g., new methods, new options) that do not break existing consumers.
- **Major releases:** Breaking changes to the API, changes to the default `parse`/`serialize` behavior, or removal of event listeners.

The default `parse` and `serialize` symmetry is a first-class contract element. Breaking the round-trip property in a future default is a breaking change. The URL normalization performed before `parse` (§5.4) is also part of the contract: any change that requires parsers to know the mode is a breaking change.


*End of Specification.*
