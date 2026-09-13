# Phase 0 — Deferred Items

**Purpose:** Formal record of coverage items identified during Phase 0 that could not be closed in the current testing environment (browser-native harness + simple HTTP server) and that have been deferred with an explicit resolution path.

**Nature of the debt:** This is **not** debt of the code or of the contracts. All primitives (Pulsar, nebula, Voyajer, Chunklet) satisfy their contracts at the level verifiable in the current environment. The items below are properties of the contracts that the current test harnesses cannot exercise without either (a) infrastructure that Phase 0 explicitly did not build, or (b) test-suite reorganization that was out of scope.

**When to resolve:** No later than the establishment of the Playwright-based CI environment (roadmap Fase 3a, Escena 3a.2). Items that only require harness reorganization may be resolved earlier if the opportunity arises.

**Revision of Fase 1 (adapter chain).** This document was updated after the work
that produced `adapter-chain.js` and `Nexus_Adapter_Contract_Specification.md`
v0.4.0. Changes:

- `12-BRIDGE-INTEGRATION` and `12-PERSISTENCE-INTEGRATION` are **closed**. Moved
  to *Closed After Phase 0* with their evidence.
- `V-T3` is **rewritten**. Its subject (`_escapeRegex`) no longer exists in
  `voyajer.js`; the coverage gap it named does, and is where a real defect was
  found.
- `ADAPTER-UTILS-DEDUP` keeps its status but loses its stated blocker. The
  decision is now open rather than waiting.
- `PULSAR-SELECTOR-REGISTRY-SNAPSHOT`, in *Not Debt*, is **updated**: the
  asymmetry it recorded no longer exists, on its own terms.
- One item added: `CHAIN-HARNESS-PORT`.

Net: 10 deferred items become 9.


## Deferred Items

### V-T2 — VoyajerJS: history mode smoke test

**What it verifies.** That `createVoyajer` in `mode: 'history'` correctly writes to the Pulsar store on `push` and reads the URL on `sync`.

**Why deferred.** The test requires `push` to change `window.location.pathname` to values that a simple HTTP server (as used to serve the harness) cannot serve. If the test leaves the browser at a nonexistent path, any subsequent navigation (bfcache reload, F5, misclick) triggers a 404 or reload loop. Cleanup at the end of the test cannot be guaranteed to run before the browser uses the corrupted path — introducing a race condition that would make the test "almost always pass," which is not an acceptable contract (Article I).

**Resolution path.** Playwright with a test server that serves arbitrary routes; per-test isolation guaranteed by the runner.


### V-T3 — VoyajerJS: `base` in history mode

**Rewritten during the Fase 1 adapter-chain revision.** The original item
verified the `_escapeRegex` fix of v0.2.1 against regex metacharacters in
`base` (e.g. `/app.v2/`). That function no longer exists: `voyajer.js` v0.2.2
normalizes `base` once to canonical form and subtracts it by path segment, so
metacharacters have no interpretation to escape and that failure surface is
gone structurally rather than guarded.

**What it verifies.** In `mode: 'history'`, for `base` values of `'/'`,
`'/admin'`, `'/admin/'` and `'/app.v2/'`:
- `push` produces the pathname the application expects, with no doubled
  separator.
- The URL virtual passed to `parse` carries the pathname with `base` removed
  and a leading slash.
- `push` to the route already displayed is a no-op, **including on the URL the
  server served**, not only after a previous in-app navigation.
- `base: '/admin'` does not match a pathname of `/administrator`.

**Why it still matters.** This is not a hypothetical. The trailing-slash form
— the one used as the example in `VoyajerJS_Contract_Specification.md` §2.5 —
produced `/admin//projects/42` on `push`, and the subtraction returned
`projects/42` without a leading slash, so the idempotence comparison against
the `serialize` output never matched on a server-served URL. Each `push` to the
current route pushed a history entry and renotified. The two defects cancelled
each other **only** after an in-app navigation, so behavior differed between
first load and the rest of the session.

The defect lived exactly in the region V-T2 and V-T3 left unexercised: `base`
only applies in history mode, and history mode is what both items defer. The
deferred coverage marked the spot where the defect was.

**Why deferred.** Same infrastructure constraint as V-T2: the test needs a
server that serves arbitrary routes, and leaving the browser at a nonexistent
path after the test is a race the harness cannot close.

**Interim coverage.** A Node validator exercising the real `voyajer.js` against
a fabricated window covers the URL arithmetic (`val-A1-voyajer.mjs`). Per D-5
this is an instrument, not the canonical record: it does not exercise
`pushState`, `popstate` or `hashchange`. It does cover what the substitute can
cover, which per D-5's counterweight is more than the browser harness can here
— the browser harness cannot lend its own window without changing the URL of
the page under test.

**Resolution path.** Same as V-T2. Playwright with a test server serving
arbitrary routes.


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


### CHAIN-HARNESS-PORT — browser-native record for the adapter chain

**What it verifies.** That the behavior fixed and refactored during the Fase 1
adapter-chain work holds in the target environment:
- Destroying adapters in an order other than reverse instantiation does not
  remove the surviving adapters from the chain.
- A remote mutation reinjected with `invokeSkipping` reaches Bridge, Persistence
  and Logging regardless of instantiation order, and produces no echo.
- Removing the last chain entry restores the same original function reference.
- Voyajer's `base` cases (V-T3) and the `route` replacement semantics.
- PulsarJS's selector registry after flattening, including the R-1 group.

**Why it is open.** The work was validated with Node validators
(`val-A1-voyajer.mjs`, `val-2-cadena.mjs`, `val-C-pulsar.mjs`,
`val-B-orden-external-event.mjs`). D-5 applies without exception: a green in
the substitute means the condition was not exercised, not that the code is
correct. The canonical record comes from the browser harness, and it does not
exist yet for the chain.

Additionally, the five adapter harnesses that produced the 241 green assertions
of Phase 0 have **not** been re-run against the chained versions of the
adapters. Until they are, the count in `PHASE_0_CLOSURE.md` §1.2 describes code
that no longer exists.

**Why it is debt and not just pending work.** It has the shape D-7 describes.
The chain changes no observable output for an application that tears down in
LIFO order, which is every application written so far. An assertion on the
result cannot tell the chained version from the previous one. Only an assertion
that does not look at the output — destroy in a deliberately wrong order, then
verify the survivor still observes — can.

**Resolution path.** Port the four validators to browser-native harnesses
following the established pattern, re-run the five adapter harnesses against
the chained adapters, and register the canonical green count. No new
infrastructure required. Must be done before the adapters are declared stable
at v0.2.0.

**Discovered.** Fase 1, during the work that produced `adapter-chain.js`.


### ADAPTER-UTILS-DEDUP — Shared helper for the wrapper pattern across adapters

**What it resolves.** Four of the five first-generation adapters (Bridge, Persistence, External Event, Logging) all wrap the seven mutation methods of nebula with the identical structural pattern: capture originals, install thin wrappers that call through and produce side effects, restore originals on destroy. Three of them additionally reimplement `_snapshotLinksOf` and `_sameShallowLinks` for set-semantics detection on `link`/`unlink`/`unlinkAll` (Logging also duplicates these). This is roughly 20-25 lines of near-identical code per adapter, totaling ~80 lines of pure duplication across the codebase.

**Empirical evidence.** Verified by direct inspection of the four adapters produced in Phase 0 Punto 5. The pattern is not incidental — it is structural to what "an adapter that observes nebula mutations" is. Any fifth or sixth adapter following this pattern will duplicate again.

**Why it was deferred, and what changed.** The stated blocker was that
deduplication required either (a) a new shared module that adapters import,
introducing a dependency chain adapters → utils, or (b) publishing the helpers
as part of nebula under an observability API that inverts its no-reactivity
constraint. Option (b) remains undesirable. **Option (a) is no longer a cost to
weigh: the module exists.** `adapter-chain.js` is imported by the four wrapper
adapters, and the dependency chain adapters → infrastructure is already
established and recorded in `Nexus_Adapter_Contract_Specification.md` §5.3.

What the chain did **not** absorb is the set-semantics no-op detection.
`_snapshotLinksOf` and `_sameShallowLinks` remain duplicated byte-for-byte in
Bridge, Persistence, External Event and Logging. The chain handles installation
and teardown; it knows nothing about what a wrapper does between `next()` and
its return, and that is where the duplication lives.

D-2 is satisfied with room to spare: four uses, identical, which is what the
discipline asks for before stabilizing a helper's shape.

**What remains undecided** is not whether to deduplicate but where the helper
belongs. Two candidates: extend `adapter-chain.js` with an opt-in no-op
detection hook, or a sibling `adapter-links.js` that only knows about the shape
of nebula's links. The first keeps one import; the second keeps the chain
ignorant of nebula, which is what lets it wrap `pulsar.setState` as well. The
second is favored for that reason, but the decision is open and no evidence
currently distinguishes them.

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

**Trigger condition for prioritization.** Unchanged in substance, but (a) is
now weaker than it was: the architectural objection was spent by the chain, so
the item no longer waits on a fifth adapter to justify the existence of a
shared module — only to choose between the two placements above. Any of: (a) a
fifth adapter would duplicate the pattern again; (b) a defect is found in the
duplicated logic and has to be fixed in four places; (c) the placement decision
resolves on its own merits.

**Discovered:** Phase 0 Punto 5, formalized in retrospective (SESSION_DOC.md §Lo malo #1). Blocker re-evaluated during the Fase 1 adapter-chain work.



## Closed During Phase 0

The following observations were closed during Phase 0 and are recorded here only to prevent them from being re-listed as deferred:

- **V-T1** (push/replace idempotence) — Covered by TESTS 8 and 9 of `voyajer.test.html`.
- **V-T4** (hashchange reactivates Voyajer without manual sync) — Covered implicitly by CP3 since V-T0 removed all manual sync() calls.
- **C-T1..C-T6, C-T8, C-T9** — Covered by TESTS 1-8, 12-13 of `chunklet.test.html`.
- **All Pulsar and nebula observations** — Covered fully in their respective harnesses.
- **12-CROSSTAB-SYNC** — Resolved by implementation of Capa 12 in Phase 0 Punto 5. Widget `widget-external-event.html` demonstrates working cross-tab bidirectional sync with anti-echo (evidence: 42/42 harness green, empirical widget test showed `out=N/in=0` on emitter, `out=0/in=N` on receiver as expected).


## Closed After Phase 0

### 12-BRIDGE-INTEGRATION and 12-PERSISTENCE-INTEGRATION — closed together

**What they recorded.** Mutations arriving from a peer tab were applied to the
local nebula through the **original** method captured at construction, which is
what made anti-echo work. The consequence was that the wrappers of Bridge and
Persistence were bypassed too: the receiving tab's graph reflected the remote
mutation but its Pulsar projection did not, and nothing was written to storage.

**How they were closed.** By `Nexus_Adapter_Contract_Specification.md` §3.5.3.
Reinjection now uses `invokeSkipping(handle, args)`, which traverses the whole
wrapper chain skipping only the caller's own entry. The mutation reaches every
other adapter; the caller does not observe itself, so no echo can start.

**Evidence.** Measured on the implemented adapters with an injected channel,
before and after. The `before` column is the reason both items existed:

| Instantiation order | applied to graph | projected | persisted | echo |
|---|---|---|---|---|
| External Event first — before | yes | no | no | no |
| External Event last — before | yes | **yes** | **yes** | no |
| Either order — after | yes | yes | yes | no |

**The measurement corrected the premise of both items.** They were written as
unconditional limitations of the adapter. They were not: with External Event
instantiated after Bridge and Persistence, the captured "original" *was* their
wrapper, and remote mutations already projected and persisted. The documented
behavior depended on montage order, which no document stated and no test
covered.

**Resolution taken, against the one predicted.** `12-BRIDGE-INTEGRATION`
listed three options. The two favored at the time — an `isRemote` flag, a
shared remote-context signal — both required each adapter to know something
about the others, which §2 of the Adapter Contract forbids. The one taken is
option (c), "restructuring wrappers into a single dispatcher chain instead of
independent monkey-patches", which needs no coordination at all because the
skip is by identity of the caller's entry rather than by a marker travelling
with the data.

**Note on how this register should be read.** Both items were deferred pending
"evidence of the pattern's cost in a real application". No such evidence
arrived. They were closed by work undertaken for a different reason: the same
root cause — each adapter holding its own captured original — also produced a
teardown-order defect, and fixing that dissolved these. A deferred item can be
closed by a neighbouring repair, so the register is not a queue in which each
item waits for its own predicted trigger.

**Verification pending.** Browser-native record, under `CHAIN-HARNESS-PORT`.
The measurement above comes from a Node validator, which per D-5 is an
instrument and not the canonical record.

**Closed.** Fase 1, during the adapter-chain work.


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

**Update — the asymmetry no longer exists (`pulsar.js` v0.2.3).** The entry
foresaw a refactor as the reason it might reopen. A refactor arrived, and it
closed the entry instead of reopening it: the selector registry was flattened
from `Map<selectorFn, Map<id, entry>>` to `Map<id, entry>`, and `_notify` now
snapshots that one registry the same way it snapshots the global listeners.
There is no longer an outer loop iterating live, so there is nothing asymmetric
to be unobservable.

The refactor did surface one observable difference, in adjacent territory and
in the direction the contract wants. If a selector listener unsubscribes
**another** selector listener during the same pass, the unsubscribed one is now
invoked in that pass; previously it was not. Measured: `A` before, `A,B` after.
§6 **Reentrancy safety** promises iteration over a snapshot, and R-1's own
comment declared that a listener present at the start of a pass is invoked. The
grouped structure honored that within a group but not between groups — deleting
a group while iterating the outer Map skipped it — so the guarantee held or not
depending on whether two listeners happened to share a selector function
reference, which a consumer neither controls nor can observe. It is now
uniform.

This entry stays in *Not Debt* rather than moving to a closed section: it never
was debt, and the investigation it records is still the reason nobody needs to
re-derive the conclusion from the v0.2.2 code.

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
| ADAPTER-UTILS-DEDUP | All wrapper-pattern adapters | shared helper for set-semantics no-op detection | Fase 1; blocker spent, placement undecided |
| CHAIN-HARNESS-PORT | Adapter chain, Voyajer, Pulsar | browser-native record for the chain work; 241 assertions not re-run | Port validators, before adapters v0.2.0 |

**Total items deferred:** 9.

**Breakdown by nature:**
- **Testing infrastructure (5):** V-T2, V-T3, C-T7, C-2 sym, CHAIN-HARNESS-PORT. The first four resolve via dedicated harness reorganization or Playwright; the fifth needs no new infrastructure, only the work.
- **Implementation quality (2):** BRIDGE-REACTIVE (evidence quantified: 73% reactive noise with N=8) and PERSISTENCE-INDEXEDDB (evidence pending; localStorage sufficient for current target scale).
- **Emerging capability (1):** WIDGET-COMPOSITION. Discovered while validating the bridge; form to be discovered by widget construction, not by advance specification.
- **Code consolidation (1):** ADAPTER-UTILS-DEDUP. ~80 lines were duplication across four adapters; the chain absorbed the installation and teardown half, leaving the set-semantics detection. No longer blocked, only undecided.

**Cross-adapter composition (0).** The two items in this category are closed. See *Closed After Phase 0*.

**All identified in-scope observations from Phase 0 have been either closed or deferred with explicit resolution paths.** No item is in "unresolved" or "unknown" status.


*This document was complete as of the closing of Phase 0 Point 3 and was revised
during Fase 1, in the work that produced `adapter-chain.js`. It should keep being
updated — items removed as they close, new items added as they emerge — as the
roadmap advances.*
