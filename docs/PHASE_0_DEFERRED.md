# Phase 0 — Deferred Items

**Purpose:** Formal record of coverage items identified during Phase 0 that could not be closed in the current testing environment (browser-native harness + simple HTTP server) and that have been deferred with an explicit resolution path.

**Nature of the debt:** This is **not** debt of the code or of the contracts. All primitives (Pulsar, Graphlet, Voyajer, Chunklet) satisfy their contracts at the level verifiable in the current environment. The items below are properties of the contracts that the current test harnesses cannot exercise without either (a) infrastructure that Phase 0 explicitly did not build, or (b) test-suite reorganization that was out of scope.

**When to resolve:** No later than the establishment of the Playwright-based CI environment (roadmap Escena 3.3). Items that only require harness reorganization may be resolved earlier if the opportunity arises.

---

## Deferred Items

### V-T2 — VoyajerJS: history mode smoke test

**What it verifies.** That `createVoyajer` in `mode: 'history'` correctly writes to the Pulsar store on `push` and reads the URL on `sync`.

**Why deferred.** The test requires `push` to change `window.location.pathname` to values that a simple HTTP server (as used to serve the harness) cannot serve. If the test leaves the browser at a nonexistent path, any subsequent navigation (bfcache reload, F5, misclick) triggers a 404 or reload loop. Cleanup at the end of the test cannot be guaranteed to run before the browser uses the corrupted path — introducing a race condition that would make the test "almost always pass," which is not an acceptable contract (Article I).

**Resolution path.** Playwright with a test server that serves arbitrary routes; per-test isolation guaranteed by the runner.

---

### V-T3 — VoyajerJS: base with special regex characters

**What it verifies.** That the `_escapeRegex` fix (v0.2.1) correctly handles regex metacharacters in the `base` option (e.g., `/app.v2/` where `.` is a metacharacter). Both application (push produces the correct pathname) and removal (parse returns the correct virtual path).

**Why deferred.** Same infrastructure constraint as V-T2. Requires `mode: 'history'` because `base` only applies in history mode.

**Resolution path.** Same as V-T2. Test can be a direct copy of the intended TEST 10 in an earlier version of `voyajer.test.html`.

---

### C-T7 — ChunkletJS: enable/disable with configured `enabledPath`

**What it verifies.** That `Chunklet.enable(entity, name)` and `Chunklet.disable(entity, name)` correctly:
- Write to the map at `enabledPath` in Pulsar.
- Trigger reconciliation of mounted behaviors on affected elements.
- Query the DOM via `_getDeclaredBehaviorsForEntity` when no prior entry exists for the entity.

**Why deferred.** The current `chunklet.test.html` follows the "single `Chunklet.setup` for the entire harness" discipline. Including `enabledPath` in that shared setup would contaminate `state.ui.enabled` for every test that precedes the enable/disable tests — which is most of them. Introducing a second setup requires either a separate harness file or a testing infrastructure that allows per-test module isolation.

**Resolution path.** One of:
1. **Dedicated harness file** `chunklet-enable.test.html` with its own setup including `enabledPath`. Same browser-native environment, no new infrastructure. Cheapest option.
2. **Playwright with module isolation.** Each test gets a fresh module context. More work but resolves the deferred item alongside V-T2 and V-T3.

---

### C-2 symmetry — ChunkletJS: toggle predictability

**What it verifies.** That `Chunklet.enable(entity, name)` followed by `Chunklet.disable(entity, name)` produces an explicit map entry regardless of starting state, and that the map state after N toggles is deterministic with respect to intent rather than call order. See ChunkletJS_Contract_Specification v0.4.0 §7.3.

**Why deferred.** Same infrastructure constraint as C-T7 — this property is only observable when `enabledPath` is configured.

**Resolution path.** Same as C-T7. Test can be a natural extension of the C-T7 tests in the dedicated harness.

---

### BRIDGE-REACTIVE — Graphlet↔Pulsar Bridge: reactive per-entity version

**What it resolves.** The current bridge implementation (v0.1.0) is snapshot-based: every Graphlet mutation re-projects all entities into Pulsar, producing new object references for every entity regardless of whether it changed. Consumers using `subscribeSelector('entities.X', ...)` with default `Object.is` equality are notified on every graph mutation, not only when entity X changes. See `adapters/graphlet-pulsar-bridge.spec.md` §7.2.

The reactive version writes only the slice of the affected entity into Pulsar, preserving references for unaffected entities. Consumers then receive notifications only for entities that actually changed.

**Why deferred.** The snapshot version fulfills the external correctness contract (state visible to consumers is identical). The reactive noise becomes a concern only when multiple widgets are subscribed under `entities.*`. Phase 0 does not build the widget factory; deferring to Phase 1 respects evidence-first design.

**Empirical evidence (from `widget-bridge.html`, Phase 0 Punto 6).** With 8 entities in the projection and a single listener subscribed to one specific entity (`entities.user:watched`), **73% of the notifications received by that listener did not correspond to changes in the observed entity**. Concretely: 86 notifications observed, only 23 reflected a real change (JSON-serialized comparison). The measurement was made under manual interaction (individual button clicks); under sustained load (e.g., drag operations at 60Hz) the accumulated cost of ignored notifications would multiply.

The theoretical asymptote is `(N-1)/N`: for N=8, expected ratio is ~87% ignored (observed 73% is close; the discrepancy comes from the interaction pattern including some `watched`-modifying clicks). For N=100, expected ratio approaches 99%. This quantifies what "does not scale" means for the snapshot version and informs when the reactive version must be prioritized.

**Resolution path.** Three implementation paths identified in the mini-spec §7.4:
- **Camino 1:** Inverse index in the bridge. Adapter maintains `Map<targetId, Set<sourceId>>` updated on every link/unlink. Consulted on delete for cascade.
- **Camino 2 (recommended):** Full-scan in delete. All mutation methods except delete are O(1) (they know their affected entity by argument); delete performs one O(N) scan to discover incoming links. Aceptable because deletes are rare in target use cases.
- **Camino 3:** Opt-in observability API in Graphlet. Cleanest but requires reopening the Graphlet Definition, which currently prohibits reactive APIs. Not recommended unless a real application demonstrates Camino 2 is insufficient.

TEST 13 in `graphlet-pulsar-bridge.test.html` documents the current snapshot limitation with asserts that expect reactive noise. When the reactive version lands, those asserts should invert; passing the inverted version is empirical evidence of the fix.

---

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

---

---

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

---

### 12-CROSSTAB-SYNC — External Event Adapter: cross-tab reactive sync

**What it resolves.** The Persistence widget demonstrated empirically that localStorage already provides passive cross-tab persistence (a change persisted in one tab is visible to another tab on next load or reload). What it does **not** provide is reactive synchronization: two tabs open simultaneously do not see each other's changes until one of them reloads.

The External Event Adapter (Capa 12, being implemented in Phase 0 Punto 5) resolves this via `BroadcastChannel`, translating local mutations into events broadcast to peer tabs, and translating incoming events into local mutations with anti-echo protection to prevent feedback loops.

**Status.** This is not deferred debt — it is active work in Phase 0 Punto 5, listed here for cross-reference. Once Capa 12 lands with its widget, this line is removed from this document.



The following observations were closed during Phase 0 and are recorded here only to prevent them from being re-listed as deferred:

- **V-T1** (push/replace idempotence) — Covered by TESTS 8 and 9 of `voyajer.test.html`.
- **V-T4** (hashchange reactivates Voyajer without manual sync) — Covered implicitly by CP3 since V-T0 removed all manual sync() calls.
- **C-T1..C-T6, C-T8, C-T9** — Covered by TESTS 1-8, 12-13 of `chunklet.test.html`.
- **All Pulsar and Graphlet observations** — Covered fully in their respective harnesses.

---

## Summary

| ID | Primitive / Layer | What | Resolution |
|----|-------------------|------|------------|
| V-T2 | Voyajer | history mode smoke | Playwright (Escena 3.3) |
| V-T3 | Voyajer | base with regex metacharacters | Playwright (Escena 3.3) |
| C-T7 | Chunklet | enable/disable with `enabledPath` | Dedicated harness OR Playwright |
| C-2 sym | Chunklet | toggle predictability | Dedicated harness OR Playwright |
| BRIDGE-REACTIVE | Bridge adapter | reactive per-entity projection (73% noise quantified with N=8) | Phase 1 (Camino 2 recommended) |
| WIDGET-COMPOSITION | Chunklet ctx | helper for entity + related | Iterative during Punto 6 and Phase 1 |
| PERSISTENCE-INDEXEDDB | Persistence adapter | IndexedDB backend for large snapshots | v0.2.0 when evidence demands it |
| 12-CROSSTAB-SYNC | External Event adapter | (active work, not deferred) | Phase 0 Punto 5, Capa 12 |

**Total items deferred:** 7 (BRIDGE-REACTIVE, WIDGET-COMPOSITION, PERSISTENCE-INDEXEDDB plus the four testing-infrastructure items). 12-CROSSTAB-SYNC is listed for cross-reference but is not deferred debt.

**Breakdown by nature:**
- **Testing infrastructure (4):** V-T2, V-T3, C-T7, C-2 sym. All resolvable via dedicated harness reorganization or Playwright.
- **Implementation quality (2):** BRIDGE-REACTIVE (evidence quantified: 73% reactive noise with N=8, empirically confirms need before Phase 1), PERSISTENCE-INDEXEDDB (evidence pending; localStorage sufficient for current target scale).
- **Emerging capability (1):** WIDGET-COMPOSITION. Discovered while validating the bridge; form to be discovered by widget construction, not by advance specification.

**All identified in-scope observations from Phase 0 have been either closed or deferred with explicit resolution paths.** No item is in "unresolved" or "unknown" status.

---

*This document is complete as of the closing of Phase 0 Point 3. It should be updated (items removed as they are closed, new items added if any emerge) as the roadmap advances.*
