# Phase 0 — Deferred Items

**Purpose:** Formal record of coverage items identified during Phase 0 that could not be closed in the current testing environment (browser-native harness + simple HTTP server) and that have been deferred with an explicit resolution path.

**Nature of the debt:** This is **not** debt of the code or of the contracts. All primitives (Pulsar, nebula, Voyajer, Chunklet) satisfy their contracts at the level verifiable in the current environment. The items below are properties of the contracts that the current test harnesses cannot exercise without either (a) infrastructure that Phase 0 explicitly did not build, or (b) test-suite reorganization that was out of scope.

**When to resolve:** No later than the establishment of the Playwright-based CI environment (roadmap Fase 3a, Escena 3a.2). Items that only require harness reorganization may be resolved earlier if the opportunity arises.


## Deferred Items

### V-T2 — VoyajerJS: history mode smoke test

**What it verifies.** That `createVoyajer` in `mode: 'history'` correctly writes to the Pulsar store on `push` and reads the URL on `sync`.

**Why deferred.** The test requires `push` to change `window.location.pathname` to values that a simple HTTP server (as used to serve the harness) cannot serve. If the test leaves the browser at a nonexistent path, any subsequent navigation (bfcache reload, F5, misclick) triggers a 404 or reload loop. Cleanup at the end of the test cannot be guaranteed to run before the browser uses the corrupted path — introducing a race condition that would make the test "almost always pass," which is not an acceptable contract (Article I).

**Resolution path.** Playwright with a test server that serves arbitrary routes; per-test isolation guaranteed by the runner.


### V-T3 — VoyajerJS: base with special regex characters

**What it verifies.** That the `_escapeRegex` fix (v0.2.1) correctly handles regex metacharacters in the `base` option (e.g., `/app.v2/` where `.` is a metacharacter). Both application (push produces the correct pathname) and removal (parse returns the correct virtual path).

**Why deferred.** Same infrastructure constraint as V-T2. Requires `mode: 'history'` because `base` only applies in history mode.

**Resolution path.** Same as V-T2. Test can be a direct copy of the intended TEST 10 in an earlier version of `voyajer.test.html`.


### C-T7 — ChunkletJS: enable/disable with configured `enabledPath`

**What it verifies.** That `Chunklet.enable(entity, name)` and `Chunklet.disable(entity, name)` correctly:
- Write to the map at `enabledPath` in Pulsar.
- Trigger reconciliation of mounted behaviors on affected elements.
- Query the DOM via `_getDeclaredBehaviorsForEntity` when no prior entry exists for the entity.

**Why deferred.** The current `chunklet.test.html` follows the "single `Chunklet.setup` for the entire harness" discipline. Including `enabledPath` in that shared setup would contaminate `state.ui.enabled` for every test that precedes the enable/disable tests — which is most of them. Introducing a second setup requires either a separate harness file or a testing infrastructure that allows per-test module isolation.

**Resolution path.** One of:
1. **Dedicated harness file** `chunklet-enable.test.html` with its own setup including `enabledPath`. Same browser-native environment, no new infrastructure. Cheapest option.
2. **Playwright with module isolation.** Each test gets a fresh module context. More work but resolves the deferred item alongside V-T2 and V-T3.


### C-2 symmetry — ChunkletJS: toggle predictability

**What it verifies.** That `Chunklet.enable(entity, name)` followed by `Chunklet.disable(entity, name)` produces an explicit map entry regardless of starting state, and that the map state after N toggles is deterministic with respect to intent rather than call order. See ChunkletJS_Contract_Specification v0.4.0 §7.3.

**Why deferred.** Same infrastructure constraint as C-T7 — this property is only observable when `enabledPath` is configured.

**Resolution path.** Same as C-T7. Test can be a natural extension of the C-T7 tests in the dedicated harness.


### BRIDGE-REACTIVE — nebula↔Pulsar Bridge: reactive per-entity version

**What it resolves.** The current bridge implementation (v0.1.0) is snapshot-based: every nebula mutation re-projects all entities into Pulsar, producing new object references for every entity regardless of whether it changed. Consumers using `subscribeSelector('entities.X', ...)` with default `Object.is` equality are notified on every graph mutation, not only when entity X changes. See `adapters/nebula-pulsar-bridge.spec.md` §7.2.

The reactive version writes only the slice of the affected entity into Pulsar, preserving references for unaffected entities. Consumers then receive notifications only for entities that actually changed.

**Why deferred.** The snapshot version fulfills the external correctness contract (state visible to consumers is identical). The reactive noise becomes a concern only when multiple widgets are subscribed under `entities.*`. Phase 0 does not build the widget factory; deferring to Phase 1 respects evidence-first design.

**Empirical evidence (from `widget-bridge.html`, Phase 0 Punto 6).** With 8 entities in the projection and a single listener subscribed to one specific entity (`entities.user:watched`), **73% of the notifications received by that listener did not correspond to changes in the observed entity**. Concretely: 86 notifications observed, only 23 reflected a real change (JSON-serialized comparison). The measurement was made under manual interaction (individual button clicks); under sustained load (e.g., drag operations at 60Hz) the accumulated cost of ignored notifications would multiply.

The theoretical asymptote is `(N-1)/N`: for N=8, expected ratio is ~87% ignored (observed 73% is close; the discrepancy comes from the interaction pattern including some `watched`-modifying clicks). For N=100, expected ratio approaches 99%. This quantifies what "does not scale" means for the snapshot version and informs when the reactive version must be prioritized.

**Resolution path.** Three implementation paths identified in the mini-spec §7.4:
- **Camino 1:** Inverse index in the bridge. Adapter maintains `Map<targetId, Set<sourceId>>` updated on every link/unlink. Consulted on delete for cascade.
- **Camino 2 (recommended):** Full-scan in delete. All mutation methods except delete are O(1) (they know their affected entity by argument); delete performs one O(N) scan to discover incoming links. Aceptable because deletes are rare in target use cases.
- **Camino 3:** Opt-in observability API in nebula. Cleanest but requires reopening the nebula Definition, which currently prohibits reactive APIs. Not recommended unless a real application demonstrates Camino 2 is insufficient.

TEST 13 in `nebula-pulsar-bridge.test.html` documents the current snapshot limitation with asserts that expect reactive noise. When the reactive version lands, those asserts should invert; passing the inverted version is empirical evidence of the fix.


### WIDGET-COMPOSITION — Chunklet ctx: helper for "entity + related entities"

**What it resolves.** A common widget pattern is rendering an entity plus the entities it references through relations (e.g., a dropdown showing its options, a card showing its children). With the bridge projecting entities in normalized form (properties + links as IDs, no expansion), a widget needs to subscribe to the entity it renders **and** to each of the referenced entities. Coordinating these subscriptions (adding/removing subscriptions when the reference set changes, cleanup on unmount) is boilerplate that will repeat in every widget.

The helper resolves this by exposing a Chunklet `ctx` method that watches an entity together with its related entities and re-invokes the callback when any of them change. Exact API to be determined by iteration.

**Location decided.** In the `ctx` of Chunklet, as a natural extension of the existing subscription primitives with lifecycle management (`ctx.subscribeSelector`, `ctx.observe`, `ctx.listen`). Chunklet is where the DOM meets the stack; a helper that coordinates state subscriptions for a widget belongs at that boundary.

Alternatives considered and rejected:
- Adapter-based helper: forces widgets to import two things (Chunklet + adapter), fragmenting the surface.
- Separate composition library: same fragmentation problem, plus creates a new layer with its own lifecycle discipline that must mirror Chunklet's.

**Why deferred.** The exact API shape depends on the patterns that emerge from real widget construction. Producing a helper before building widgets risks specifying capabilities that turn out to be wrong or insufficient (Article I). The helper will be discovered iteratively during Phase 0 Punto 6 (validation exercise with canonical widgets: toolbar, tabs, drag-and-drop, popup form, carousel) and Phase 1.

**Resolution path.** Iterative:
- First widget with this need (during Punto 6): implement a minimal helper that resolves that specific case.
- Subsequent widgets: reuse if fits, extend or refactor if not.
- After 3-4 real widgets have shaped the API, the helper's form stabilizes and can be documented as a first-class capability of Chunklet's `ctx`.


### PERSISTENCE-INDEXEDDB — Persistence Adapter: IndexedDB backend

**What it resolves.** The current Persistence Adapter (v0.1.0) writes only to `localStorage`. This works for the target application scale (browser-side diagram editor with tens to low hundreds of entities, snapshots of a few dozen KB) but does not scale in three dimensions:

- **Capacity:** localStorage caps at ~5MB per origin. Larger snapshots (hundreds of entities with rich properties, or embedded binary-ish content) exceed the limit and trigger `QuotaExceededError`.
- **Blocking:** localStorage writes are synchronous. Large JSON serializations block the main thread; for a snapshot of several MB this is perceptible.
- **Structure:** IndexedDB supports structured cloning natively, avoiding the JSON serialization overhead altogether for large objects, and permits indexed queries against persisted data.

**Why deferred (from persistence-adapter.spec.md §7).** Two reasons:

1. **Async surface.** IndexedDB is inherently asynchronous. Adding it would either force the whole adapter async (breaking the current synchronous `flush()` guarantee that composes cleanly with `beforeunload` patterns at the application level), or introduce a mode-selector that changes the return type of `flush()`. Either is a v0.2.0 decision, not a v0.1.0 add-on.
2. **Not needed yet.** No evidence that the current localStorage-only version is the bottleneck. Article I: real evidence should precede the additional complexity.

**Resolution path.** Two implementation options identified in the mini-spec:
- **Option A:** Separate factory `createIndexedDBPersistenceAdapter` with an async surface, sharing the observation logic (method wrapping, set-semantics detection, debouncing) with the current adapter through internal helpers.
- **Option B:** Extend the current adapter's `storage` option to accept an adapter that translates an IndexedDB-flavored async interface into the Web Storage API synchronous surface. Simpler public surface but hides async failure modes behind sync method signatures.

Decision between A and B to be made when evidence demands it. Option A is currently favored because it makes the async nature visible to the consumer.

**Trigger condition for prioritization.** Any of: (a) a real application produces snapshots >2MB with observable UI stutter on save, (b) a real application requires storing structures that JSON serialization mangles (e.g., large Maps, Sets, ArrayBuffers), (c) a real application requires querying persisted data without a full load.


### 12-BRIDGE-INTEGRATION — External Event Adapter: remote mutations don't re-project via Bridge

**What it resolves.** In v0.1.0 of the External Event Adapter, remote mutations arriving from a peer tab are applied to the local nebula via the **original** method (bypassing all wrappers). This is what makes anti-echo work by construction (see external-event-adapter.spec.md §3.3). But it has a consequence: if a nebula↔Pulsar Bridge is also mounted in the receiving tab, the Bridge wrapper is bypassed too. The result: nebula in the receiving tab reflects the remote mutation, **but Pulsar's `entities.*` projection does not**. Chunklet behaviors subscribed to `entities.*` in the receiving tab will not re-render until a local mutation triggers Bridge's wrapper.

**Empirical evidence.** The widget `widget-external-event.html` (Phase 0 Punto 6, Capa 12) sidesteps this by renderizing from nebula directly and listening to the BroadcastChannel with a second consumer to trigger re-renders. This works for the widget but is a workaround, not the intended composition pattern for real applications that use Bridge + External Event together.

**Why deferred.** Resolving it requires coordinated behavior across two adapters. Options include: (a) an "apply remote via wrapped" flag in the External Event Adapter that lets Bridge re-project without re-emitting; (b) a shared `isRemoteContext` signal that Bridge honors to skip re-broadcast; (c) restructuring wrappers into a single dispatcher chain instead of independent monkey-patches. All three are v0.2.0 territory that requires more evidence of the pattern's cost in a real application.

**Resolution path.** Wait for Fase 1 or Fase 2 evidence. When an application couples External Event + Bridge and the manual re-render workaround becomes friction, pick between the three options based on which is least invasive at that point.


### 12-PERSISTENCE-INTEGRATION — External Event Adapter: remote mutations don't persist in receiver

**What it resolves.** Same shape as 12-BRIDGE-INTEGRATION but for Persistence. Remote mutations applied via the original method bypass Persistence's wrapper too, so the receiving tab's `localStorage` is not updated by remote events. Practical consequence: if the emitting tab crashes before its own debounce fires, the mutation is lost to storage even though other tabs saw it live.

**Empirical evidence.** Not directly demonstrated in Phase 0 (the External Event widget does not use Persistence), but derivable from the same construction. The Persistence widget alone demonstrates that localStorage is updated correctly for local mutations; combining both adapters would expose the asymmetry.

**Why deferred.** Same reasons as 12-BRIDGE-INTEGRATION: requires coordinated behavior. Same resolution options apply.

**Resolution path.** Same as 12-BRIDGE-INTEGRATION. Both items can be resolved together, since they share the same underlying architectural question: "how does an adapter that observes local mutations distinguish local from remote-applied, and choose to act or not act accordingly?"



### ADAPTER-UTILS-DEDUP — Shared helper for the wrapper pattern across adapters

**What it resolves.** Four of the five first-generation adapters (Bridge, Persistence, External Event, Logging) all wrap the seven mutation methods of nebula with the identical structural pattern: capture originals, install thin wrappers that call through and produce side effects, restore originals on destroy. Three of them additionally reimplement `_snapshotLinksOf` and `_sameShallowLinks` for set-semantics detection on `link`/`unlink`/`unlinkAll` (Logging also duplicates these). This is roughly 20-25 lines of near-identical code per adapter, totaling ~80 lines of pure duplication across the codebase.

**Empirical evidence.** Verified by direct inspection of the four adapters produced in Phase 0 Punto 5. The pattern is not incidental — it is structural to what "an adapter that observes nebula mutations" is. Any fifth or sixth adapter following this pattern will duplicate again.

**Why deferred.** Deduplication requires either (a) a new shared module (`src/adapter-utils.js` or similar) that adapters import, introducing a dependency chain adapters → utils, or (b) publishing the helpers as part of nebula itself under a stable "observability API" that inverts the current no-reactivity constraint of nebula. Both options are architectural decisions that benefit from a fifth or sixth adapter's evidence to inform the exact shape of the helper. Deduplicating with only four instances risks generalizing on incomplete evidence (Article I).

**Resolution path.** When Fase 1 introduces additional adapters (or refactors existing ones for a v0.2.0), extract the pattern into a helper module. Recommended shape (subject to refinement by that evidence):

```javascript
// Proposed shape, not committed
import { wrapnebulaMutations } from './adapter-utils.js';

export function createSomeAdapter(context, options) {
  const state = { /* adapter-specific */ };
  const unwrap = wrapnebulaMutations(context.nebula, {
    onMutation: (op, args, wasNoOp) => {
      if (wasNoOp) return;
      // adapter-specific reaction here
    },
    detectSetSemanticNoOp: true,  // opt-in
  });
  return { destroy: () => unwrap() };
}
```

The helper handles the seven-method wrap, the snapshot-based no-op detection, and the destroy-time restoration. The adapter is left with only its own logic.

**Trigger condition for prioritization.** Any of: (a) a fifth adapter is designed and would duplicate the pattern again; (b) a bug is found in the duplicated logic and needs to be fixed in four places; (c) evidence-first justification for the exact API shape arrives.

**Discovered:** Phase 0 Punto 5, formalized in retrospective (SESSION_DOC.md §Lo malo #1).



The following observations were closed during Phase 0 and are recorded here only to prevent them from being re-listed as deferred:

- **V-T1** (push/replace idempotence) — Covered by TESTS 8 and 9 of `voyajer.test.html`.
- **V-T4** (hashchange reactivates Voyajer without manual sync) — Covered implicitly by CP3 since V-T0 removed all manual sync() calls.
- **C-T1..C-T6, C-T8, C-T9** — Covered by TESTS 1-8, 12-13 of `chunklet.test.html`.
- **All Pulsar and nebula observations** — Covered fully in their respective harnesses.
- **12-CROSSTAB-SYNC** — Resolved by implementation of Capa 12 in Phase 0 Punto 5. Widget `widget-external-event.html` demonstrates working cross-tab bidirectional sync with anti-echo (evidence: 42/42 harness green, empirical widget test showed `out=N/in=0` on emitter, `out=0/in=N` on receiver as expected).


## Not Debt (Recorded for Clarity)

The following observations were investigated but are **not** deferred debt.
They are recorded here to prevent future readers from re-discovering the same
question and re-litigating the conclusion. Each entry names the observation,
the investigation performed, and the reason for closing without action.

### PULSAR-SELECTOR-REGISTRY-SNAPSHOT — investigated during R-1, not observable

**Observation.** In `Pulsar._notify`, the outer loop iterates
`this._selectorListeners` live (no snapshot), while the inner loop over each
selector's listener map does snapshot. The global-listener branch snapshots.
On its face this looks like it contradicts §6 **Reentrancy safety**: a
`subscribeSelector` call made during `_notify` could, in principle, be reached
by the same pass and invoked before its "next `setState`" arrives.

**Investigation.** Three reproductions were attempted while producing the R-1
fix (see `PULSAR_R1_FIX.md`):
- Subscribe a new selector inside a listener, then trigger a reentrant
  `setState` in the same handler.
- Trigger the reentrant `setState` first, then subscribe.
- Subscribe from a global listener (which runs before the selector loop).

None produced an in-pass invocation of the newly registered selector listener.
The reason is structural: `subscribeSelector` fixes each listener's baseline
`previousValue` against the state at the moment of subscription, and the
equality check at the top of the notification loop acts as a natural guard —
when the outer loop reaches the freshly added entry, the derived value has not
moved and the listener is skipped.

**Conclusion.** The asymmetry between the global-listener snapshot and the
selector-listener live iteration is not observable through the public API. No
change is warranted. Recorded so the next reader of `_notify` does not spend
the same time re-verifying the same conclusion, and to signal that if a future
refactor removes the baseline-fixing behavior of `subscribeSelector`, this
observation ceases to be closed.

**Discovered.** During R-1 fix work, post-Phase 0. Documented in
`PULSAR_R1_FIX.md` §7.

---

## Summary

| ID | Primitive / Layer | What | Resolution |
|----|-------------------|------|------------|
| V-T2 | Voyajer | history mode smoke | Playwright (Escena 3a.2) |
| V-T3 | Voyajer | base with regex metacharacters | Playwright (Escena 3a.2) |
| C-T7 | Chunklet | enable/disable with `enabledPath` | Dedicated harness OR Playwright |
| C-2 sym | Chunklet | toggle predictability | Dedicated harness OR Playwright |
| BRIDGE-REACTIVE | Bridge adapter | reactive per-entity projection (73% noise quantified with N=8) | Phase 1 (Camino 2 recommended) |
| WIDGET-COMPOSITION | Chunklet ctx | helper for entity + related | Iterative during Punto 6 and Phase 1 |
| PERSISTENCE-INDEXEDDB | Persistence adapter | IndexedDB backend for large snapshots | v0.2.0 when evidence demands it |
| 12-BRIDGE-INTEGRATION | External Event × Bridge | remote mutations don't re-project via Bridge in receiver | v0.2.0 coordinated fix |
| 12-PERSISTENCE-INTEGRATION | External Event × Persistence | remote mutations don't persist in receiver | v0.2.0 coordinated fix |
| ADAPTER-UTILS-DEDUP | All wrapper-pattern adapters | shared helper for 7-method wrap + set-semantics no-op detection | Fase 1 with 5th/6th adapter |

**Total items deferred:** 10.

**Breakdown by nature:**
- **Testing infrastructure (4):** V-T2, V-T3, C-T7, C-2 sym. All resolvable via dedicated harness reorganization or Playwright.
- **Implementation quality (3):** BRIDGE-REACTIVE (evidence quantified: 73% reactive noise with N=8, empirically confirms need before Phase 1), PERSISTENCE-INDEXEDDB (evidence pending; localStorage sufficient for current target scale), and the pair 12-BRIDGE-INTEGRATION + 12-PERSISTENCE-INTEGRATION (same underlying question of local-vs-remote-applied distinction, resolved together).
- **Emerging capability (1):** WIDGET-COMPOSITION. Discovered while validating the bridge; form to be discovered by widget construction, not by advance specification.
- **Cross-adapter composition (2, counted above):** 12-BRIDGE-INTEGRATION and 12-PERSISTENCE-INTEGRATION share the same architectural question and are expected to be resolved as a pair.
- **Code consolidation (1):** ADAPTER-UTILS-DEDUP. ~80 lines of duplication across four adapters. Waits for a fifth adapter's evidence to inform the exact helper shape.

**All identified in-scope observations from Phase 0 have been either closed or deferred with explicit resolution paths.** No item is in "unresolved" or "unknown" status.


*This document is complete as of the closing of Phase 0 Point 3. It should be updated (items removed as they are closed, new items added if any emerge) as the roadmap advances.*
