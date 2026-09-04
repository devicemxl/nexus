# Nexus Adapter Contract Specification

**Version:** 0.3.0
**Status:** Design Contract (pre-implementation)
**Scope:** Generic contract for adapters that bridge the Nexus primitives with each other or with external systems.

**Changes from v0.2.0 (breaking):**
- Rewritten as a **generic contract plus enumerated catalog**. Adapter-specific specifications (signatures, options, behavior) are no longer part of this document; each concrete adapter gets its own mini-spec at implementation time.
- All references to the Command Layer removed (archived in Phase 0 Commit 2).
- Aligned with Nexus Contract v0.3.0 and ChunkletJS v0.4.0.


## 1. Purpose

Adapters are optional utilities that connect Nexus primitives to each other or to external systems (storage, network, external event sources). They exist because the primitives themselves are deliberately unaware of each other beyond their strict dependency direction (Nexus Contract §3), and applications frequently need coordinated behavior across them.

This document defines the **generic contract** that every adapter must satisfy. Individual adapters have their own mini-specifications produced at implementation time, following the principle of evidence-first design.


## 2. Definition

An adapter is a function that observes, intercepts, or translates mutations in one primitive and produces effects in another primitive or in an external system. Adapters are always instantiated by the application, never by the primitives themselves.

Adapters are:
- **External to the primitives.** No primitive imports or references an adapter.
- **Composable.** Multiple adapters may operate on the same primitive without interfering with each other.
- **Lifecycle-owned by the application.** The application is responsible for creating, retaining, and destroying adapters at appropriate times.


## 3. Generic Contract

### 3.1 Factory Signature

Every adapter is created by a factory function with the following shape:

```typescript
type AdapterFactory<Options> = (
  context: AdapterContext,
  options?: Options
) => AdapterInstance;

interface AdapterContext {
  // The primitives the adapter needs. Which ones depends on the adapter.
  // Example fields: pulsar, graphlet, voyajer, storage, socket.
  [key: string]: unknown;
}

interface AdapterInstance {
  destroy(): void;
  // Adapters may expose additional methods specific to their purpose,
  // but destroy() is mandatory.
}
```

The `context` object is passed by the application at instantiation. It contains references to the primitives (and optionally external systems) that the adapter operates on. The adapter does not create primitives; it consumes existing instances.

### 3.2 Lifecycle States

An adapter is in one of three states:

- **Instantiated.** The factory has returned; internal observers and subscriptions are registered.
- **Running.** The adapter is actively translating mutations. This is the state immediately after instantiation and lasts until `destroy` is called.
- **Destroyed.** The adapter has released all internal resources. Further calls to any adapter method are no-op or throw (implementation-defined per adapter, but destroy is always idempotent).

There is no explicit "initialize" step separate from instantiation, and no explicit "start" step. If an adapter requires deferred setup, the mini-specification documents that explicitly.

### 3.3 Mandatory Behaviors

Every adapter must:

- **Return `destroy()`.** No exceptions. The application must always be able to release the adapter's resources.
- **Release all resources on `destroy`.** Event listeners, subscriptions, timers, observers, network connections — everything acquired must be released.
- **Be safe against double-destroy.** Calling `destroy()` twice must not throw and must not attempt to release resources a second time.
- **Not modify the public API of consumed primitives.** An adapter that wraps `Graphlet.link` internally does so on a captured reference, not by mutating the exported method.
- **Not create primitives.** All primitives passed via `context` must be pre-existing instances created by the application.

### 3.4 Forbidden Behaviors

Adapters must not:

- Install global handlers on `window` unless the adapter's explicit purpose is to bridge with a browser global (e.g., a WebSocket adapter listens on a Socket instance, not on `window`).
- Register `beforeunload` or `unload` listeners. These disable browser optimizations (bfcache) and are hostile to application-level lifecycle management.
- Throw during `destroy` under normal conditions. Cleanup errors should be caught and logged internally.
- Depend on other adapters implicitly. If adapter A requires adapter B to have run first, the mini-specification of A must document this dependency and the application is responsible for the ordering.


## 4. Composition Rules

### 4.1 With PulsarJS

Adapters that write to Pulsar must respect the state tree namespacing convention (Nexus Contract §5). The reserved top-level keys are `route`, `entities`, `ui`, `net`. Adapters should default to writing under `entities` (for domain projections) or `net` (for external system state), and expose configuration to override this only when justified.

Adapters that read from Pulsar should use `subscribeSelector` with the narrowest possible selector to avoid re-notifying on unrelated state changes.

### 4.2 With GraphletJS

Adapters that observe Graphlet mutations do so by wrapping the eight mutation methods (`put`, `upsert`, `update`, `delete`, `link`, `unlink`, `unlinkAll`, and additionally `query` if the adapter needs to react to reads). Wrapping is done in the adapter's factory by capturing the original methods and installing wrappers that call through and then produce side effects.

Adapters must respect set semantics for links (Graphlet Contract §2.3) — an adapter that emits change events on `link` must emit on the first insertion of a triple, not on subsequent no-op calls.

### 4.3 With VoyajerJS

Adapters generally do not interact with Voyajer directly. Voyajer already writes to Pulsar under `route.*`; adapters that react to navigation subscribe to `route.*` in Pulsar, not to Voyajer itself.

### 4.4 With ChunkletJS

Adapters and Chunklet behaviors overlap in scope: both can react to state changes and produce effects. The distinction is:

- **Adapters** operate outside the DOM lifecycle. They live from application startup to shutdown, independent of any element being mounted.
- **Chunklet behaviors** operate inside the DOM lifecycle. They are created and destroyed with their elements.

When both approaches would work for a given task, prefer the one whose lifecycle matches the task. Global data synchronization is adapter work; per-element event handling and rendering is Chunklet work.


## 5. Catalog of First-Generation Adapters

The following adapters are identified as necessary for the first real application (browser-side diagram editor). Each will receive its own mini-specification when implemented in Phase 0 Point 5. They are listed here in order of dependency (earlier ones are prerequisites for later ones in some scenarios).

**1. Graphlet ↔ Pulsar Bridge**
Projects Graphlet entities into a Pulsar state slice (default: `entities.*`) so that Chunklet behaviors can subscribe reactively. This is the core adapter — the reason Chunklet can render entities without polling Graphlet.

**2. Hydration Adapter**
Reads persisted data from a storage backend (localStorage, IndexedDB, or a URL-encoded snapshot) and populates Graphlet at application startup, before Chunklet mounts behaviors. Ensures the first render sees populated state.

**3. Persistence Adapter**
The complementary write-side of Hydration. Observes Graphlet mutations and persists to a storage backend, either eagerly (on every mutation), throttled (batched), or on explicit save.

**4. External Event Adapter**
Translates events from external sources (WebSocket, `postMessage`, SSE) into Graphlet mutations and Pulsar state updates. Enables real-time synchronization with servers or cross-tab coordination.

**5. Logging / Observability Adapter**
Observes primitive mutations and emits them to a sink (console, remote logger, DevTools) for debugging or production observability. Read-only with respect to the primitives.

### 5.1 Note on Concrete Specifications

Each adapter in the catalog will have its own mini-specification produced at the time of implementation (roadmap Punto 5). The mini-specs will follow this template:
- Purpose (one paragraph).
- Factory signature and options.
- Behavior (numbered steps).
- Lifecycle notes if they differ from the generic contract in §3.
- Trade-offs and known limitations.

Producing the mini-specs alongside the implementations, rather than in advance, respects the principle of evidence-first design (Article I). A pre-emptive specification of an adapter that has not been built is likely to specify something that turns out to be wrong.

### 5.2 Note on the Graphlet ↔ Pulsar Bridge

The generic bridge described in item 1 above will initially be implemented as a **snapshot-based projection**: any Graphlet mutation triggers a full re-projection of the affected entity type into Pulsar. This is the version that will be produced in Punto 5.

The **correct long-term implementation** projects reactively per entity: only the specific entity's slice in Pulsar is updated when its Graphlet record changes. This requires either additional observability primitives in Graphlet (an opt-in change notification API) or an intermediate change-detection layer built into the bridge itself.

The initial snapshot-based version is sufficient for early applications where the entity set is small, but it does not scale. The mini-specification of the bridge will describe the correct behavior; the first implementation will document its own limitations and the path to the reactive version.


## 6. Behavioral Guarantees

| Guarantee | Description |
| :--- | :--- |
| **Mandatory destroy** | Every adapter returns `destroy()`. No exceptions. |
| **Idempotent destroy** | Calling destroy twice is safe. |
| **Resource ownership** | Adapters release all resources they acquire, on destroy. |
| **No primitive mutation** | Adapters do not modify the public API of consumed primitives. |
| **No primitive creation** | Adapters do not create primitives; they receive existing instances. |
| **No global handlers** | Adapters do not install window-level handlers except when their purpose is browser bridging (documented per adapter). |
| **No implicit dependencies** | An adapter that depends on another adapter documents this explicitly. |
| **Composable** | Multiple adapters may operate on the same primitive without interfering. |


## 7. Versioning

This contract is versioned independently of the individual adapter mini-specifications.

- **Patch releases:** Clarifications and non-breaking additions to the generic contract.
- **Minor releases:** New categories of adapter (e.g., a new class of composition rule) that do not invalidate existing adapters.
- **Major releases:** Changes to the mandatory factory signature, changes to lifecycle states, or changes to composition rules.

Individual adapter mini-specifications have their own versions. A patch release of an adapter does not require a change to this document.


*End of Specification.*
