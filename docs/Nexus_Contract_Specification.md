# Nexus Contract Specification

**Version:** 0.3.1
**Status:** Design Contract (aligned with implementations: Pulsar 0.2.1, Graphlet 0.3.0, Voyajer 0.2.1, Chunklet 0.4.0)
**Scope:** Defines the collaboration, boundaries, and integration rules for the Nexus ecosystem: GraphletJS, PulsarJS, VoyajerJS, and ChunkletJS.

**Changes from v0.3.0 (patch, non-breaking):**
- Header status updated from "pre-implementation" to reflect that all four primitives and two first-generation adapters exist and are testable (Article II — describe reality as it is).
- §4.4 (Supported Adapter Patterns) aligned with the authoritative catalog in `Nexus_Adapter_Contract_Specification.md` §5, replacing prior inconsistent enumeration ("Collection Sync" was listed here without appearing in the adapter catalog; "Logging" was in the catalog but missing here).
- §6.4 (Startup Hydration) cross-reference to Chunklet spec corrected from §3.1 to §3.3 to match the current Chunklet Contract structure.
- §7.1 (Chunklet Lifecycle) updated to include the optional `configure()` step introduced in Chunklet v0.4.0.
- §8 (Behavioral Guarantees) new row on set-idempotent relationships (G-0), documenting that adapters may rely on this property.

No semantic changes. No changes to dependency direction, primitive responsibilities, or namespacing conventions.

---

## 1. Purpose

The Nexus Contract establishes the rules of engagement between four independent primitives. The goal is to enable the construction of complete browser-side web applications through composition while preserving the independence, testability, and minimalism of each individual library.

The contract codifies:
- The distinct responsibility of each primitive.
- The strict direction of dependencies.
- The optional adapter layer that bridges non-reactive and reactive domains.
- The state-tree conventions that keep composition disciplined at scale.

---

## 2. Component Definitions

### 2.1 GraphletJS
**Role:** Semantic model and identity.
**Owns:** Entities, properties, relationships, and queries.
**Core Methods:** `put`, `upsert`, `get`, `update`, `delete`, `link`, `unlink`, `unlinkAll`, `query`, `allIds`.
**Constraint:** No reactive API (`subscribe`, `watch`, `effect`). No DOM references. No dependency on PulsarJS, VoyajerJS, or ChunkletJS.

### 2.2 PulsarJS
**Role:** Reactive application state.
**Owns:** Transient state, subscriptions, notifications, and state transitions.
**Core Methods:** `createStatePulsar`, `getState`, `setState`, `subscribe`, `subscribeSelector`.
**Constraint:** No DOM references. No knowledge of GraphletJS, VoyajerJS, or ChunkletJS. No knowledge of entity identity.

### 2.3 VoyajerJS
**Role:** URL synchronization.
**Owns:** Bidirectional synchronization between `window.location` and PulsarJS.
**Core Methods:** `createVoyajer`, `push`, `replace`, `back`, `forward`, `go`, `sync`, `getCurrent`, `destroy`.
**Constraint:** Writes only to PulsarJS. Does not read PulsarJS to update the URL automatically (navigation is explicit). Does not manipulate the DOM.

### 2.4 ChunkletJS
**Role:** DOM behavior orchestration over the Nexus stack.
**Owns:** DOM event listeners, resource acquisition, mount/destroy lifecycle, behavior discovery, and per-element behavior enablement.
**Core Methods:** `setup`, `configure`, `define`, `mount`, `unmount`, `observe`, `disconnect`, `enable`, `disable`, and the `ctx` resource registry and stack accessor.
**Constraint:** Depends on PulsarJS and GraphletJS. Optionally depends on VoyajerJS. Does not own or persist state; state lives in Pulsar, model in Graphlet, navigation in Voyajer. Does not generate DOM nodes.

---

## 3. Dependency Direction (The Law of Hierarchy)

The following dependency hierarchy is **mandatory**. It prevents architectural leaks and ensures each primitive remains replaceable at its level.

```text
LEVEL 0: GraphletJS
   - Depends on: Nothing.
   - Knows: Nothing about the DOM, Pulsar, Voyajer, or Chunklet.

LEVEL 1: PulsarJS
   - Depends on: Nothing (zero runtime dependencies).
   - Knows: Nothing about the DOM, Graphlet, Voyajer, or Chunklet.

LEVEL 2: VoyajerJS
   - Depends on: PulsarJS (to write navigation state).
   - Knows: The DOM (for reading window.location and window.history) and Pulsar.
   - Does NOT know: GraphletJS or ChunkletJS.

LEVEL 3: ChunkletJS
   - Depends on: PulsarJS and GraphletJS. Optionally on VoyajerJS.
   - Knows: The DOM (by definition), Pulsar, Graphlet, and Voyajer when configured.
   - Role: Orchestrates the stack for DOM decoration. Provides a lifecycle-managed
     context (ctx) that exposes the primitives to behavior factories.

LEVEL 4: Application
   - Depends on: All primitives, adapters, and Chunklet.
   - Contains: Behavior factories, domain-specific commands and helpers,
     adapters instantiated by the application, and any composition of the
     primitives that is not part of the primitives themselves.
```

**Note on levels 0 and 1.** GraphletJS and PulsarJS are both independent (neither depends on anything). They are numbered separately for exposition order, not because one is architecturally above the other. Either can be used without the other; the levels above are the ones with real ordering.

**Enforcement Rules:**
- GraphletJS core must never import or reference PulsarJS, VoyajerJS, or ChunkletJS.
- PulsarJS core must never import or reference the DOM, GraphletJS, VoyajerJS, or ChunkletJS.
- VoyajerJS must never import or reference GraphletJS or ChunkletJS.
- ChunkletJS is the only primitive permitted to import from lower levels. Its imports are limited to PulsarJS, GraphletJS, and VoyajerJS.

The dependencies of ChunkletJS on the lower primitives are not architectural leaks. They are the explicit basis on which Chunklet provides an orchestration surface. Applications that require Pulsar, Graphlet, or Voyajer without Chunklet can use them directly at their own level.

---

## 4. The Adapter Layer

Adapters are optional utility functions that automate the flow between GraphletJS and PulsarJS, or between the primitives and external systems.

### 4.1 Definition
An adapter is a function that observes or intercepts mutations in one primitive and translates them into updates for another, or that bridges the primitives with external systems (storage, network, external events).

### 4.2 Contract
```typescript
type Adapter = (context: object, options?: object) => { destroy: () => void };
```

### 4.3 Rules
- Adapters are **not** part of the core primitives. They are published or defined as separate utilities.
- Adapters must not modify the public API of the primitives they connect.
- Adapters must provide a `destroy` method to clean up internal observers or subscriptions.
- Adapters are optional. Applications may choose explicit orchestration inside behavior factories instead of adapters.

### 4.4 First-Generation Adapter Categories

The authoritative catalog of first-generation adapters (with concrete mini-specifications, dependencies, and implementation status) is maintained in **`Nexus_Adapter_Contract_Specification.md` §5**. This section summarizes the categories for orientation only; when in doubt, the adapter contract prevails.

- **Graphlet ↔ Pulsar Bridge.** Projects Graphlet entities into a Pulsar state slice (default: `entities.*`) so that Chunklet behaviors can subscribe reactively.
- **Hydration Adapter.** Populates Graphlet from a snapshot at application startup, before Chunklet mounts behaviors.
- **Persistence Adapter.** Observes Graphlet mutations and persists to a storage backend (localStorage, IndexedDB, or custom).
- **External Event Adapter.** Translates events from external sources (WebSocket, `postMessage`, SSE) into Graphlet and Pulsar updates.
- **Logging / Observability Adapter.** Observes primitive mutations and emits them to a sink (console, remote logger, DevTools) for debugging or production observability.

Concrete signatures, options, and behavioral guarantees are defined per adapter in the adapter contract and its associated mini-specifications.

---

## 5. State Tree Namespacing Convention

Because Pulsar acts as the shared hub for reactive state written by multiple producers (application, Voyajer, adapters, Chunklet behaviors), a namespacing convention prevents accidental collisions and makes state ownership traceable.

This convention is **documented guidance, not enforced by the core**. Applications may adopt or ignore it. Adherence is strongly recommended for any project involving more than one producer.

### 5.1 Reserved Top-Level Keys

| Key | Owner | Purpose |
| :--- | :--- | :--- |
| `route` | VoyajerJS | Current navigation state parsed from the URL. |
| `entities` | Graphlet-to-Pulsar adapters | Projections of Graphlet entities into reactive slices. |
| `ui` | Application code | Transient UI state: selection, active tool, viewport, panel visibility, toast messages, per-entity behavior enablement (see ChunkletJS `enabledPath`). |
| `net` | Application code | Network request states: pending, success, error, timestamps. |

### 5.2 Ownership Rule

A producer writes only under its reserved key. Reads from any key are permitted. Cross-writes are permitted only through application code that is explicit about which keys it is touching.

### 5.3 Rationale

Without namespacing, Pulsar's state tree accumulates keys from multiple producers at the root level. The first non-trivial refactor becomes "I moved this key and broke three subscriptions in unrelated modules." Namespacing localizes such changes.

---

## 6. Data Flow Patterns

### 6.1 User Interaction (UI → Model)

A Chunklet behavior receives a DOM event, updates the domain via Graphlet (through `ctx.updateEntity`, `ctx.upsertEntity`, or direct Graphlet access via `ctx.graphlet`), and optionally updates transient UI state through `ctx.setState`. If a Graphlet-to-Pulsar adapter is installed, entity mutations are projected into `entities.*` automatically; other Chunklet behaviors subscribed to that projection re-render.

```text
DOM Event → Chunklet behavior (ctx) → Graphlet [+ Pulsar via adapter]
         → Chunklet subscribers → DOM
```

Behaviors may inline the orchestration in the factory, or delegate to a named function passed the same primitives explicitly. The delegation is an application-level pattern for reuse and testability; it is not required by the contract.

### 6.2 External Event (System → UI)

External sources (WebSocket, `fetch`, timer, `postMessage`) update Graphlet and Pulsar through application code, typically wired through an External Event Adapter. As with user interaction, the projection through the Bridge adapter (if present) delivers changes to the DOM via subscribed Chunklet behaviors.

```text
External Event → External Event Adapter → Graphlet [+ Pulsar via Bridge]
              → Chunklet subscribers → DOM
```

### 6.3 Navigation (URL → UI)

The user clicks back/forward or changes the URL. VoyajerJS listens to `popstate` (history mode) or `hashchange` (hash mode), parses the URL, and writes to Pulsar under `route`. Chunklet behaviors subscribed to `route.*` re-render.

```text
URL Change → Voyajer → Pulsar (route) → Chunklet subscribers → DOM
```

### 6.4 Startup Hydration (Storage → Model)

The application invokes a Hydration Adapter that reads persisted data from IndexedDB or `localStorage`, inserts it into Graphlet via `put` or `upsert`, and establishes projections into Pulsar through the Bridge adapter. `Chunklet.mount(document.body)` is called last, so the first render sees a populated store.

```text
Storage → Hydration Adapter → Graphlet [+ Pulsar via Bridge]
       → Chunklet.mount → DOM
```

The canonical startup sequence is documented in the ChunkletJS Contract Specification §3.3.

---

## 7. Lifecycle and Resource Management

### 7.1 Chunklet Lifecycle
- **Setup:** `Chunklet.setup(options)` initializes the stack once per module load.
- **Configure (optional):** `Chunklet.configure(options)` may be invoked after Setup any number of times to refine `graphlet` or `voyajer` without discarding `pulsar` or the module singleton. See ChunkletJS Contract §3.2.
- **Mount:** Behaviors acquire resources (listeners, subscriptions, timers) via `ctx`.
- **Running:** Behaviors are active.
- **Destroy:** All resources registered in `ctx` are automatically released. Custom `destroy` functions returned by factories are invoked in LIFO order.

### 7.2 Adapter Lifecycle
- Adapters must return a `destroy` function.
- The application is responsible for calling `destroy` when the associated component or view is removed.
- Adapters must clean up all internal observers and event listeners.

### 7.3 Voyajer Lifecycle
- `createVoyajer` attaches event listeners to `window`.
- `destroy()` removes all event listeners.

### 7.4 Graphlet and Pulsar Lifecycle
- Both are in-memory objects with no external resources. They require no explicit destruction.

**Resource Ownership Rule:**
> The component that acquires a resource is responsible for releasing it. In practice, ChunkletJS owns DOM resources acquired through behavior contexts, Voyajer owns window events, and the application owns adapters and any handlers registered outside the primitives.

---

## 8. Behavioral Guarantees

| Guarantee | Description |
| :--- | :--- |
| **Primitive Independence at Levels 0-2** | Graphlet, Pulsar, and Voyajer can be used in isolation without the others (Voyajer requires Pulsar). Chunklet requires Pulsar and Graphlet by design; this is stated explicitly in §3. |
| **Synchronous Core** | Graphlet, Pulsar, and Chunklet core operations are synchronous. Asynchronous behavior is delegated to adapters or application code. |
| **No Implicit Reactivity** | Graphlet does not emit events by default. Reactivity must be added via adapters or explicit application code. |
| **Set-Idempotent Relationships (G-0)** | GraphletJS `link` is a silent no-op on already-existing triples; the `(source, relation)` target list is a set, not a multiset. Adapters may rely on this to skip re-projection or side effects on Graphlet no-ops. See Graphlet Contract §2.3 and the Bridge mini-spec §5. |
| **Single Source of Truth** | Graphlet is the sole source of truth for domain data (the document/model). Pulsar is the sole source of truth for transient UI state. The DOM is a representation, never a source of truth. |
| **Explicit Navigation** | Voyajer does not subscribe to Pulsar. Navigation must be triggered via `push` or `replace`. This prevents infinite loops. |
| **Deterministic Teardown** | All primitives that acquire resources provide a mechanism to release them (destroy, unmount). |
| **Zero Build Requirement** | All primitives are distributed as ES modules. They can be imported directly from CDN without bundlers, transpilers, or build steps. |
| **Client-Side Only Runtime** | Nexus is designed to run entirely in the browser. Server-side runtimes (Node, Deno) are supported as development/testing conveniences but are not required for any production use case. |

---

## 9. Versioning and Backward Compatibility

The Nexus Contract itself is versioned independently of the individual primitives.

- **Patch releases:** Clarifications, typo fixes, or non-breaking additions to the contract language.
- **Minor releases:** Additions to the contract (e.g., new primitive roles, new adapter patterns) that do not invalidate existing implementations.
- **Major releases:** Changes to the dependency direction, changes to the core responsibility of any primitive, or removal of established patterns.

**Primitive Versioning:**
- Each primitive follows its own semantic versioning.
- A major version bump in any primitive must be accompanied by a review of this contract. If the dependency direction or core responsibility changes, the contract must be bumped to the next major version.

---

## 10. On Invariants and Purpose

The rules in this contract — dependency direction, single sources of truth, namespacing conventions, resource ownership — are **invariants**, not ends. They exist to keep the architecture composable and evolvable as applications grow.

If an invariant obstructs the delivery of a real application requirement without providing a proportional benefit, the invariant is reviewed. This document is subordinate to the applications that use Nexus, not the other way around. Article XI (Responsibility to the User) and Article XII (Building with Purpose) prevail over any architectural rule that contradicts them.

The current invariants have been formulated in reference to a concrete application (a browser-side, backend-agnostic diagram/flow editor) and are expected to evolve as that application and others reveal new requirements.

---

## Change Summary (v0.3.0 → v0.3.1)

**Corrective (all non-breaking):**
- Header: `Status` updated from "pre-implementation" to a status line naming the four primitive versions with which this contract is aligned. Article II — the state of the system is what it is.
- §3: added a short note on the co-equal nature of levels 0 and 1 (Graphlet and Pulsar are peers, not stacked), to prevent misreading the exposition order as an ordering.
- §4.4: rewritten from a self-contained list to a summary aligned with the authoritative catalog in `Nexus_Adapter_Contract_Specification.md` §5. Adds Logging/Observability (was missing here), removes Collection Sync (was here but not in the adapter catalog), and renames patterns to match the adapter contract's vocabulary.
- §6.2: data flow updated to name the External Event Adapter explicitly rather than "application handler", reflecting that the adapter catalog now includes this pattern.
- §6.4: cross-reference to Chunklet spec corrected from §3.1 to §3.3, matching the current Chunklet Contract structure where §3.1 is Setup, §3.2 is Configure, and §3.3 is Canonical Startup Sequence.
- §7.1: added "Configure (optional)" lifecycle step reflecting Chunklet v0.4.0's `configure()` API.
- §8: new row "Set-Idempotent Relationships (G-0)" documenting the Graphlet v0.3.0 contract property that adapters may rely on.

**Not changed:**
- Section structure and section numbering.
- Dependency direction (§3), including all four levels and the enforcement rules.
- Component responsibilities (§2) beyond adding Chunklet's `configure` to §2.4's method list (already present in v0.3.0).
- Namespacing convention (§5).
- Versioning policy (§9).
- Philosophical framing (§10).

**Semantic impact:** None. All changes are alignments between the contract text and the current implementations or with sibling documents. Applications, adapters, and behaviors written against v0.3.0 remain valid under v0.3.1 without modification.

---

*End of Specification.*
