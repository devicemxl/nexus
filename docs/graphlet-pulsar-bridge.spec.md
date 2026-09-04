# Adapter Mini-Spec: Graphlet ↔ Pulsar Bridge

**Version:** 0.1.0 (specification)
**Implementation status:** initial (snapshot-based, see §7)
**Scope:** Projects Graphlet entity mutations into a Pulsar state slice so that reactive consumers (Chunklet behaviors, subscribers) can observe entity changes without polling Graphlet.


## 1. Purpose

Graphlet is deliberately non-reactive (Graphlet Definition, "Lo que Graphlet no es"). To make entity data available to Chunklet behaviors that render reactively, an external observer must project Graphlet mutations into Pulsar. This adapter is that observer, and it is the reason Chunklet can render entity-bound UI without introducing a new subscription primitive.


## 2. Factory Signature

```typescript
type GraphletPulsarBridgeOptions = {
  path?: string;            // Where in Pulsar to write. Default: 'entities'.
  skipInitialSync?: boolean; // If true, don't project existing entities at instantiation. Default: false.
};

function createGraphletPulsarBridge(
  context: { graphlet: GraphletInstance, pulsar: PulsarInstance },
  options?: GraphletPulsarBridgeOptions
): { destroy(): void };
```


## 3. Behavior (Correct, Reactive Version)

The correct version of this adapter operates entity-by-entity:

1. **On instantiation:**
   - If `skipInitialSync` is `false` (default), iterate all current Graphlet entities and write them individually to `pulsar.state[path][id]`.
   - Wrap the eight Graphlet mutation methods (`put`, `upsert`, `update`, `delete`, `link`, `unlink`, `unlinkAll`) on the received instance. The wrappers call through to the original and then update **only the affected entity's slice** in Pulsar.

2. **On each mutation:**
   - `put(id, props)`, `upsert(id, props)`, `update(id, patch)`: recompute the projected shape for entity `id` from Graphlet's current state and write to `pulsar.state[path][id]`.
   - `delete(id)`: also delete the entry at `pulsar.state[path][id]`. Additionally, iterate other affected entries (those with incoming links to `id`) and update their projections, since Graphlet's cascade removed incoming references.
   - `link(source, rel, target)`, `unlink(source, rel, target)`, `unlinkAll(source, rel)`: recompute the projection for entity `source` only.
   - Set semantics (Graphlet §2.3) means the wrapper for `link` must **not** emit if the triple already existed. Detection: compare the source's projected links before and after the call; if unchanged, skip the Pulsar write.

3. **Projected shape** (per entity):
   ```javascript
   { id, properties, links }
   ```
   Identical to `graphlet.get(id)`. Same clone-on-read guarantees (properties are shallow copies; links arrays are shallow copies).

4. **On `destroy`:**
   - Restore the eight original methods on the Graphlet instance.
   - Do not touch Pulsar state. The projected entries remain; the application decides whether to clear them.
   - Idempotent: second `destroy` is no-op.


## 4. Composition Notes

- **Multiple bridges on the same Graphlet:** The wrapping mechanism composes if each bridge captures the previous wrapper as the "original." Order of instantiation matters (outer bridges wrap inner ones). Simple case: one bridge per application, keyed to a specific Pulsar path.

- **Consumer patterns:** Chunklet behaviors subscribe with `ctx.subscribeSelector` to `${path}.${id}` for a single entity, or to `${path}` for the full map. The map is a plain object; iterating it works normally.

- **Write conflicts:** If application code writes directly to `pulsar.state[path][id]`, the next Graphlet mutation on that entity will overwrite. The bridge is authoritative for its path. Applications should not write under this path directly.


## 5. Behavioral Guarantees

| Guarantee | Description |
| :--- | :--- |
| **Original API preserved on destroy** | After `destroy`, calling `graphlet.link(...)` etc. behaves exactly as before instantiation. |
| **Set semantics respected** | No Pulsar write on `link` calls that are Graphlet no-ops (target already in the relation). |
| **Delete cascade projected** | When Graphlet deletes an entity, incoming references are removed and the projections of affected entities are updated. |
| **Read shape matches `graphlet.get()`** | The projected entity has the same shape and same defensive copying. |
| **Idempotent destroy** | Second call to `destroy` is safe no-op. |
| **No global handlers** | Bridge does not touch `window` or install `beforeunload`. |


## 6. What This Adapter Does NOT Do

- **Does not create Graphlet or Pulsar instances.** Both are passed in by the application.
- **Does not batch mutations.** Every Graphlet mutation produces one Pulsar `setState`. For high-frequency scenarios, wrap the bridge with a throttling/debouncing layer at the application level.
- **Does not persist state.** Combining projection with persistence is the job of the Persistence Adapter, which is composable with this one.
- **Does not emit typed change events.** Consumers subscribe to Pulsar; the reactive channel is Pulsar, not the bridge.
- **Does not validate consistency.** If the application also writes to the projection path, the bridge does not detect or prevent divergence.


## 7. Note on Initial Implementation (Snapshot-Based)

The **initial implementation** produced in Phase 0 Punto 5 is **not** the reactive version described in §3. It is a simpler snapshot-based projection that satisfies the same external contract but with different internal behavior:

- On any Graphlet mutation, the initial implementation **re-projects all Graphlet entities** into `pulsar.state[path]`, replacing the entire projection.
- This is O(N) per mutation instead of O(1), which is acceptable for early applications with small entity sets (dozens to low hundreds) but does not scale to thousands.
- The initial implementation still respects set semantics (no re-projection on `link` no-ops).
- The initial implementation still fulfills the observable behavior described in §3 (the state Chunklet sees is identical); only the cost profile differs.

The correct reactive version (§3) will be implemented when:
- A real application demonstrates that the snapshot cost is a bottleneck, or
- Graphlet gains an opt-in change notification API that makes per-entity reactivity natural without wrapper archaeology.

Both are anticipated but neither is a Phase 0 deliverable.


## 8. Versioning

- **Patch:** Bug fixes that do not change behavior.
- **Minor:** New options that do not break existing consumers.
- **Major:** Changes to the factory signature, changes to the projected shape, or changes to which methods are wrapped.


*End of Mini-Spec.*
