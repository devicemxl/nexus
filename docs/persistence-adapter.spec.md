# Adapter Mini-Spec: Persistence Adapter

**Version:** 0.1.0 (specification)
**Implementation status:** initial
**Scope:** Observes GraphletJS mutations and persists the entire graph to a storage backend, so that on the next application load a Hydration Adapter can restore state.

---

## 1. Purpose

Persistence is the write-side complement of Hydration. Hydration reads a snapshot at startup and populates Graphlet; Persistence observes Graphlet mutations and writes the graph back to storage. Together they close the loop `storage → Graphlet → mutations → storage`, letting an application recover its state across reloads without a backend.

The adapter serializes the graph in the **same canonical shape** the Hydration Adapter consumes (see `hydration-adapter.spec.md` §3.1). A snapshot written by Persistence and read back by Hydration on the next load reproduces the graph.

---

## 2. Factory Signature

```typescript
type PersistenceMode = 'eager' | 'debounced';

type PersistenceOptions = {
  key: string;                    // Required. Storage key under which the snapshot is written.
  mode?: PersistenceMode;         // Default: 'debounced'.
  debounceMs?: number;            // Default: 200. Only meaningful in 'debounced' mode.
  writeOnInit?: boolean;          // Default: false. If true, writes current Graphlet state immediately at instantiation.
  storage?: Storage;              // Default: window.localStorage. Any object satisfying the Web Storage API.
  onError?: (error: Error, phase: 'serialize' | 'write') => void;  // Default: console.warn. Invoked on failure.
};

function createPersistenceAdapter(
  context: { graphlet: GraphletInstance },
  options: PersistenceOptions
): {
  flush(): void;
  destroy(): void;
};
```

**Parameters:**

- `context.graphlet`: the Graphlet instance to observe.
- `options.key`: string under which the serialized snapshot is stored. Required — no default, because a silent default would risk key collisions across independent applications sharing a domain.
- `options.mode`:
  - `'eager'`: every Graphlet mutation triggers an immediate serialize+write. Simpler but more expensive under bursty loads.
  - `'debounced'` (default): mutations reset a timer; when the timer fires, one serialize+write happens with the accumulated result. Preferred for interactive applications where drag or rapid edits produce many mutations per second.
- `options.debounceMs`: milliseconds of quiet time before writing. Only meaningful in `'debounced'` mode. Values below ~50 ms defeat the purpose; values above ~1000 ms risk losing recent state on unexpected reload.
- `options.writeOnInit`: if `true`, serializes and writes the current state of Graphlet at adapter instantiation. Default `false` because the canonical flow (Hydration + Persistence) has the adapter mounted right after Hydration, and immediately re-persisting what was just read is redundant. Useful when Persistence is mounted on a pre-populated Graphlet that has no prior storage record.
- `options.storage`: any object exposing `getItem`, `setItem`, `removeItem` (the Web Storage API). Default is `window.localStorage`. Injecting a custom storage is the intended path for testing (in-memory mock) and for future IndexedDB/SessionStorage adapters.
- `options.onError`: invoked when serialization or writing fails. Receives the error and a phase label. Default logs to `console.warn`. Failure does not throw from the adapter — persistence is best-effort by nature.

**Returns:**

- `flush()`: forces an immediate serialize+write, canceling any pending debounced write. Useful before intentional shutdown (e.g., a `beforeunload` handler at the application level, or a manual "save now" button). Idempotent — calling flush with no pending writes is a no-op.
- `destroy()`: unwraps the Graphlet methods, cancels any pending timer, and marks the adapter inert. Idempotent. **Does not flush by default** — the application decides whether pending state should be persisted before shutdown (typically via `flush()` before `destroy()`).

---

## 3. Behavior

### 3.1 Observation

On instantiation, the adapter wraps the eight Graphlet mutation methods (`put`, `upsert`, `update`, `delete`, `link`, `unlink`, `unlinkAll`) using the same pattern as the Graphlet↔Pulsar Bridge (§3 of that mini-spec). Each wrapper calls through to the original and then schedules a write according to `mode`:

- In `'eager'` mode: the write is executed synchronously after the mutation returns.
- In `'debounced'` mode: a `setTimeout` for `debounceMs` is scheduled (or reset, if one is pending). When the timer fires, the write is executed. Additional mutations during the wait reset the timer.

The adapter uses set-idempotence awareness for `link`/`unlink`/`unlinkAll`: if the underlying method was a no-op (triple already existed or absent), the wrapper does not schedule a write. This is detected using the same pre/post snapshot comparison the Bridge uses (`_snapshotLinksOf`).

### 3.2 Serialization

The adapter iterates `graphlet.allIds()`, calls `graphlet.get(id)` for each, and builds the canonical shape:

```javascript
{
  "entities": {
    [id]: { properties, links }
  }
}
```

The result is serialized with `JSON.stringify`. Circular structures within `properties` will throw during serialize; the adapter catches this and reports through `onError`. The graph itself cannot be circular (links contain IDs, not object references), so the serialization failure surface is limited to malformed property values.

### 3.3 Writing

The serialized string is written to `storage.setItem(key, snapshot)`. Failure modes:

- **QuotaExceededError** (localStorage full): reported through `onError`. The snapshot is not written.
- **SecurityError** (private mode in some browsers rejecting localStorage): reported through `onError`. The snapshot is not written.
- **Any other exception**: reported through `onError` and swallowed.

No retry logic. Persistence is best-effort; the caller decides if a retry strategy applies at the application level.

### 3.4 Destroy

`destroy()` performs three actions:

1. Restore the eight original Graphlet methods (mirror of what wrapper installation did).
2. Cancel any pending debounce timer (if `mode: 'debounced'` and a timer was scheduled).
3. Mark the adapter as destroyed. Subsequent calls to `flush()` are no-ops.

`destroy()` does **not** call `flush()` automatically. The rationale: destruction happens for many reasons (test cleanup, controlled shutdown, teardown before switching graphs), and not all of them mean "save what's pending." An application that wants save-on-destroy can call `adapter.flush(); adapter.destroy();` — two lines, explicit, no surprise.

---

## 4. Composition Notes

- **With Hydration Adapter:** the shapes are compatible by design. A canonical startup sequence is:

```javascript
const graphlet = createGraphlet();

// Read what was saved from the previous session (if any).
const raw = localStorage.getItem('my-app-graph');
if (raw) {
  createHydrationAdapter(
    { graphlet },
    { snapshot: JSON.parse(raw) }
  );
}

// Now attach persistence for future mutations.
createPersistenceAdapter(
  { graphlet },
  { key: 'my-app-graph', mode: 'debounced', debounceMs: 300 }
);

// From here, all mutations to graphlet are persisted with 300ms trailing debounce.
```

- **With Graphlet↔Pulsar Bridge:** Persistence and Bridge both wrap the same eight Graphlet methods. Order of instantiation determines wrapping order: the last one instantiated becomes the outer wrapper. Recommended order is **Bridge first, Persistence second** — mutations flow to Pulsar (fast, in-memory, drives UI) and then to storage (slow, best-effort). Reversing the order still works but delays UI updates behind the persistence timer in `'eager'` mode.

- **With multiple graphs:** an application with multiple independent Graphlet instances instantiates one Persistence Adapter per graph, each with its own `key`. The adapter does not multiplex.

---

## 5. Behavioral Guarantees

| Guarantee | Description |
| :--- | :--- |
| **Idempotent destroy** | Second `destroy()` is safe no-op. |
| **Idempotent flush** | `flush()` with no pending write is safe no-op. |
| **Original API preserved on destroy** | After `destroy()`, `graphlet.link(...)` etc. behave exactly as before instantiation. |
| **Set semantics respected** | `link`/`unlink`/`unlinkAll` calls that are Graphlet no-ops do not schedule a write. |
| **Canonical shape** | Written snapshots match the shape consumed by Hydration Adapter without transformation. |
| **Best-effort writes** | Storage errors are reported through `onError` but never thrown from the adapter. |
| **No global handlers** | Adapter does not install `beforeunload` or any `window`-level listener. |
| **Explicit shutdown** | `destroy()` does not implicitly flush; callers wanting save-on-destroy call `flush()` first. |

---

## 6. What This Adapter Does NOT Do

- **Does not read from storage.** That is the Hydration Adapter's job. A snapshot written here can only be consumed by explicitly invoking Hydration on the next startup.
- **Does not persist Pulsar state.** Only Graphlet. If UI state (selection, viewport, active view) needs to survive reloads, that is a separate concern — either serialize a `ui.*` slice manually, or wait for a future Pulsar Persistence Adapter.
- **Does not persist incrementally.** Every write is a full snapshot. For large graphs this becomes expensive; a future adapter version may support append-only journals or diff-based persistence. Not planned for v0.1.0.
- **Does not compress.** Snapshots are stored as raw JSON. If storage size becomes a concern, the caller can pass a compressing wrapper around `storage`.
- **Does not encrypt.** Application concern; wrap `storage` if needed.
- **Does not handle cross-tab coordination.** If two tabs of the same application write to the same key, the last write wins. Cross-tab sync is a job for a future External Event Adapter using `BroadcastChannel` or the `storage` event.
- **Does not support IndexedDB in v0.1.0.** localStorage only (synchronous, ~5MB per origin, string-only). IndexedDB support is deferred — see §7.

---

## 7. Deferred: IndexedDB Support

IndexedDB is the natural next backend for this adapter because it removes the 5MB localStorage cap, avoids JSON serialization overhead for large graphs, and offers asynchronous non-blocking writes. It is not included in v0.1.0 for two reasons:

**Reason 1 — Async surface.** IndexedDB is inherently async. Adding it to the current adapter would either force the whole adapter async (breaking the current synchronous `flush()` guarantee that fits well with `beforeunload` patterns), or require a mode-selector that changes the return type of `flush()`. Either is a v0.2.0 decision, not a v0.1.0 add-on.

**Reason 2 — Not needed yet.** The current target application (browser-side diagram editor) has entity counts in the dozens to low hundreds. Serialized JSON for that scale fits comfortably in localStorage (a few dozen KB). Real evidence that localStorage is the bottleneck should precede the additional complexity of IndexedDB (Article I).

**Path to IndexedDB in v0.2.0:** either (a) a second factory `createIndexedDBPersistenceAdapter` with async surface, sharing the observation logic through internal helpers, or (b) a `storage` option that accepts an IndexedDB-flavored adapter with a wrapper making it look synchronous for `setItem`. Decision to be made when evidence demands it.

Documented as PERSISTENCE-INDEXEDDB in `PHASE_0_DEFERRED.md` when this mini-spec lands.

---

## 8. Versioning

- **Patch:** Bug fixes that do not change behavior.
- **Minor:** New options that do not break existing consumers (e.g., new modes, new `onError` phases).
- **Major:** Changes to the factory signature, changes to the canonical shape, or changes to `destroy()`'s no-flush guarantee.

---

*End of Mini-Spec.*
