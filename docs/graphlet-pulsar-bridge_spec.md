# Adapter Mini-Spec: nebula ↔ Pulsar Bridge

**Version:** 0.1.0 (specification)
**Implementation status:** reactive per-entity (Camino 2, since Bridge v0.3.0)
**Scope:** Projects nebula entity mutations into a Pulsar state slice so that reactive consumers (Chunklet behaviors, subscribers) can observe entity changes without polling nebula.


## 1. Purpose

nebula is deliberately non-reactive (nebula Definition, "Lo que nebula no es"). To make entity data available to Chunklet behaviors that render reactively, an external observer must project nebula mutations into Pulsar. This adapter is that observer, and it is the reason Chunklet can render entity-bound UI without introducing a new subscription primitive.


## 2. Factory Signature

```typescript
type nebulaPulsarBridgeOptions = {
  path?: string;            // Where in Pulsar to write. Default: 'entities'.
  skipInitialSync?: boolean; // If true, don't project existing entities at instantiation. Default: false.
};

function createNebulaPulsarBridge(
  context: { nebula: nebulaInstance, pulsar: PulsarInstance },
  options?: nebulaPulsarBridgeOptions
): { destroy(): void };
```


## 3. Behavior

The Bridge operates entity-by-entity.

**Cost note.** "Per entity" describes what is projected and what wakes up
subscribers, not total work. The spread `{...projection, [id]: entity}` still
copies N pointers, and `_deepFreeze` still walks N keys of the new map
(shorting on `Object.isFrozen` on each child, but walking them anyway). Both
are structural to Pulsar's immutability guarantee and cannot be removed
without changing the primitive. What per-entity projection buys, per
mutation, is: one `nebula.get` instead of N; one listener invocation on
entity subscribers instead of N; five `Object.freeze` operations instead of
3N+2. See `PHASE_0_DEFERRED.md` (*Closed After Phase 0*, BRIDGE-REACTIVE) for
the measurement and the wall-time impact.

The Bridge operates as follows:

1. **On instantiation:**
   - If `skipInitialSync` is `false` (default), iterate all current nebula entities and write them individually to `pulsar.state[path][id]`.
   - Wrap the eight nebula mutation methods (`put`, `upsert`, `update`, `delete`, `link`, `unlink`, `unlinkAll`) on the received instance. The wrappers call through to the original and then update **only the affected entity's slice** in Pulsar.

2. **On each mutation:**
   - `put(id, props)`, `upsert(id, props)`, `update(id, patch)`: recompute the projected shape for entity `id` from nebula's current state and write to `pulsar.state[path][id]`.
   - `delete(id)`: also delete the entry at `pulsar.state[path][id]`. Additionally, iterate other affected entries (those with incoming links to `id`) and update their projections, since nebula's cascade removed incoming references.
   - `link(source, rel, target)`, `unlink(source, rel, target)`, `unlinkAll(source, rel)`: recompute the projection for entity `source` only.
   - Set semantics (nebula §2.3) means the wrapper for `link` must **not** emit if the triple already existed. Detection: compare the source's projected links before and after the call; if unchanged, skip the Pulsar write.

3. **Projected shape** (per entity):
   ```javascript
   { id, properties, links }
   ```
   Identical to `nebula.get(id)`. Same clone-on-read guarantees (properties are shallow copies; links arrays are shallow copies).

4. **On `destroy`:**
   - Restore the eight original methods on the nebula instance.
   - Do not touch Pulsar state. The projected entries remain; the application decides whether to clear them.
   - Idempotent: second `destroy` is no-op.


## 4. Composition Notes

- **Multiple bridges on the same nebula:** The wrapping mechanism composes if each bridge captures the previous wrapper as the "original." Order of instantiation matters (outer bridges wrap inner ones). Simple case: one bridge per application, keyed to a specific Pulsar path.

- **Consumer patterns:** Chunklet behaviors subscribe with `ctx.subscribeSelector` to `${path}.${id}` for a single entity, or to `${path}` for the full map. The map is a plain object; iterating it works normally.

- **Write conflicts:** If application code writes directly to `pulsar.state[path][id]`, the next nebula mutation on that entity will overwrite. The bridge is authoritative for its path. Applications should not write under this path directly.


## 5. Behavioral Guarantees

| Guarantee | Description |
| :--- | :--- |
| **Original API preserved on destroy** | After `destroy`, calling `nebula.link(...)` etc. behaves exactly as before instantiation. |
| **Set semantics respected** | No Pulsar write on `link` calls that are nebula no-ops (target already in the relation). |
| **Delete cascade projected** | When nebula deletes an entity, incoming references are removed and the projections of affected entities are updated. |
| **Read shape matches `nebula.get()`** | The projected entity has the same shape and same defensive copying. |
| **Idempotent destroy** | Second call to `destroy` is safe no-op. |
| **No global handlers** | Bridge does not touch `window` or install `beforeunload`. |


## 6. What This Adapter Does NOT Do

- **Does not create nebula or Pulsar instances.** Both are passed in by the application.
- **Does not batch mutations.** Every nebula mutation produces one Pulsar `setState`. For high-frequency scenarios, wrap the bridge with a throttling/debouncing layer at the application level.
- **Does not persist state.** Combining projection with persistence is the job of the Persistence Adapter, which is composable with this one.
- **Does not emit typed change events.** Consumers subscribe to Pulsar; the reactive channel is Pulsar, not the bridge.
- **Does not validate consistency.** If the application also writes to the projection path, the bridge does not detect or prevent divergence.


## 7. Historical Note

Bridge v0.1.0 and v0.2.0 were **snapshot-based**: every nebula mutation
re-projected all entities into Pulsar. That version produced the reactive
noise recorded as `BRIDGE-REACTIVE` in `PHASE_0_DEFERRED.md`
(73 % of subscriber invocations were spurious with N=8). The item is closed
in *Closed After Phase 0* with the measurement and the correction to its
"O(1)" language.

The Bridge harness `graphlet-pulsar-bridge_test.html` (v0.1.0) contained a
TEST 13 with asserts inverted on purpose, plus a diagnostic note stating
verbatim which values would confirm the reactive fix. The arnés v0.2.0
(`graphlet-pulsar-bridge_test.v0.2.0.html`) applies that inversion. Its
50/50 is the empirical evidence.

Three implementation paths were identified when the item was open. The one
taken is **Camino 2**: full-scan in `delete`, per-entity projection
everywhere else. `_reprojectAll` is retained for initial synchronization
only; no mutation path calls it.

The `bridge.destroy()` + `createNebulaPulsarBridge` recipe with
`skipInitialSync: false` remains as the on-demand reconciliation mechanism.
Its awkwardness — recreating the Bridge places it as the outermost wrapper
of the chain, changing emission order relative to Persistence and Logging —
is recorded as `BRIDGE-SYNC` in `PHASE_1_DEFERRED.md`.


## 8. Versioning

- **Patch:** Bug fixes that do not change behavior.
- **Minor:** New options that do not break existing consumers.
- **Major:** Changes to the factory signature, changes to the projected shape, or changes to which methods are wrapped.


*End of Mini-Spec.*
