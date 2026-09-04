# Phase 0 — Deferred Items

**Purpose:** Formal record of coverage items identified during Phase 0 that could not be closed in the current testing environment (browser-native harness + simple HTTP server) and that have been deferred with an explicit resolution path.

**Nature of the debt:** This is **not** debt of the code or of the contracts. All primitives (Pulsar, Graphlet, Voyajer, Chunklet) satisfy their contracts at the level verifiable in the current environment. The items below are properties of the contracts that the current test harnesses cannot exercise without either (a) infrastructure that Phase 0 explicitly did not build, or (b) test-suite reorganization that was out of scope.

**When to resolve:** No later than the establishment of the Playwright-based CI environment (roadmap Escena 3.3). Items that only require harness reorganization may be resolved earlier if the opportunity arises.


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


## Not Debt (Recorded for Clarity)

The following observations were closed during Phase 0 and are recorded here only to prevent them from being re-listed as deferred:

- **V-T1** (push/replace idempotence) — Covered by TESTS 8 and 9 of `voyajer.test.html`.
- **V-T4** (hashchange reactivates Voyajer without manual sync) — Covered implicitly by CP3 since V-T0 removed all manual sync() calls.
- **C-T1..C-T6, C-T8, C-T9** — Covered by TESTS 1-8, 12-13 of `chunklet.test.html`.
- **All Pulsar and Graphlet observations** — Covered fully in their respective harnesses.


## Summary

| ID | Primitive | What | Resolution |
|----|-----------|------|------------|
| V-T2 | Voyajer | history mode smoke | Playwright (Escena 3.3) |
| V-T3 | Voyajer | base with regex metacharacters | Playwright (Escena 3.3) |
| C-T7 | Chunklet | enable/disable with `enabledPath` | Dedicated harness OR Playwright |
| C-2 sym | Chunklet | toggle predictability | Dedicated harness OR Playwright |

**Total items deferred:** 4.
**All identified in-scope observations from Phase 0 have been either closed or deferred with explicit resolution paths.** No item is in "unresolved" or "unknown" status.


*This document is complete as of the closing of Phase 0 Point 3. It should be updated (items removed as they are closed, new items added if any emerge) as the roadmap advances.*
