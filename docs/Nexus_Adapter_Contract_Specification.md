# Nexus Adapter Contract Specification

**Version:** 0.4.0
**Status:** Design Contract (aligned with implementations: Bridge 0.2.0, Hydration 0.2.0, Persistence 0.2.0, External Event 0.2.0, Logging 0.2.0)
**Scope:** Generic contract for adapters that bridge the Nexus primitives with each other or with external systems.

**Changes from v0.3.0 (breaking for adapter authors, non-breaking for applications):**
- New §3.5 (**Wrapper Installation and Teardown**) makes the wrapper mechanism
  part of the generic contract instead of a convention repeated in each
  mini-spec. Adapters install wrappers through `adapter-chain.js`; direct
  assignment to a primitive's method and direct restoration on destroy are now
  forbidden. The change removes an unwritten global invariant — that adapters
  had to be destroyed in reverse instantiation order — that produced silent
  loss of observation when violated.
- §3.3 corrects a bullet that described the wrapper mechanism inaccurately. The
  previous text claimed adapters wrap "on a captured reference, not by mutating
  the exported method", which no implemented adapter satisfied: all four wrapper
  adapters assign to `nebula.put` and the rest on the received instance.
  Article II governs the correction — the contract now describes what adapters
  actually do and constrains it, rather than forbidding in words what it
  permitted in practice.
- §4.2 corrects the method count. The text said adapters wrap "the eight nebula
  mutation methods" and then listed seven. The same error is present in
  `nebula-pulsar-bridge.spec.md` §3.1 and `persistence-adapter.spec.md` §3.1;
  `external-event-adapter.spec.md` §3.1 says seven and is correct. `query` is a
  read, not a mutation, and no adapter wraps it.
- §5.3 records `adapter-chain.js` as shared adapter infrastructure and states
  its position with respect to the Nexus Contract dependency hierarchy.
- §6 gains three guarantee rows: order-independent teardown, chain
  reachability, and self-skipping reinjection.
- Consequence outside this document: the deferred items
  `12-BRIDGE-INTEGRATION` and `12-PERSISTENCE-INTEGRATION` are **resolved** by
  §3.5. See §5.4.

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
  // Example fields: pulsar, nebula, voyajer, storage, socket.
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
- **Not change the observable semantics of the methods it wraps.** An adapter installs wrappers on the instance it received (see §3.5), which is how observation works at all. What it must not do is alter the signature, the return value, the thrown errors, or the effect of the wrapped method. A wrapper observes and produces side effects; it does not transform the call. A wrapper that deliberately blocks a mutation is possible but is a different kind of component, and its mini-spec must declare it.
- **Not create primitives.** All primitives passed via `context` must be pre-existing instances created by the application.

### 3.4 Forbidden Behaviors

Adapters must not:

- Install global handlers on `window` unless the adapter's explicit purpose is to bridge with a browser global (e.g., a WebSocket adapter listens on a Socket instance, not on `window`).
- Register `beforeunload` or `unload` listeners. These disable browser optimizations (bfcache) and are hostile to application-level lifecycle management.
- Throw during `destroy` under normal conditions. Cleanup errors should be caught and logged internally.
- Depend on other adapters implicitly. If adapter A requires adapter B to have run first, the mini-specification of A must document this dependency and the application is responsible for the ordering.
- Assign directly to a method of a consumed primitive, or restore one directly on destroy. Both go through the chain (§3.5). Direct assignment is what made teardown order load-bearing.
- Require a particular destroy order relative to other adapters. If an adapter cannot be destroyed at an arbitrary point in the lifetime of its peers, that is a defect, not a documented constraint.


### 3.5 Wrapper Installation and Teardown

Adapters that observe a primitive's mutations do so by wrapping methods on the
instance they received. This section defines how, and is mandatory.

#### 3.5.1 The problem it solves

The natural implementation — capture the current method, assign a wrapper,
restore the captured method on destroy — composes correctly only if adapters
are destroyed in reverse instantiation order:

```text
original
A installs → A_put  (delegates to original)
B installs → B_put  (delegates to A_put)
```

If `A.destroy()` runs first, it assigns `original` back and **B silently leaves
the chain**: its projection, persistence or broadcast stops happening, with no
error and no warning. When `B.destroy()` runs afterwards it reinstalls `A_put`,
a wrapper belonging to a destroyed adapter, permanently.

The `if (destroyed) return original(...)` guard that adapters carried prevents
the call from breaking. It does not prevent the wrapper from not running.

This was an unwritten global invariant. An application that happened to tear
down in LIFO order was correct by accident; a test releasing in creation order,
a hot reload, or a consumer destroying "for convenience" broke observation
without any symptom.

#### 3.5.2 The mechanism

`adapter-chain.js` maintains one dispatcher per `(instance, method)` pair. The
dispatcher consults the list of live entries on every invocation, so removing
an entry is a splice in that list rather than a restoration of a captured
reference. **Teardown order stops being observable.**

```javascript
import { wrap, unwrap, invokeSkipping } from './adapter-chain.js';

const handle = wrap(nebula, 'put', function (next, id, properties) {
  const result = next(id, properties);      // rest of the chain, then original
  doSomething();
  return result;
});

// on destroy:
unwrap(handle);
```

Rules:

1. **`next` is the rest of the chain.** A wrapper that does not call `next`
   cuts the mutation. Legitimate, but it must be deliberate and declared in the
   mini-spec (§3.3).
2. **Execution order is last-registered-first.** The most recently installed
   adapter is the outermost wrapper, preserving the semantics of the manual
   nesting this replaces.
3. **Every `wrap` returns a handle, and every handle is released on destroy.**
   `unwrap` is idempotent and order-independent.
4. **The original method is restored only when the last entry leaves**, and only
   if the dispatcher is still the installed method. If something replaced it
   outside the chain, the chain warns and does not restore, so as not to
   overwrite whoever wrote on top.

#### 3.5.3 Reinjection without self-observation

An adapter that must apply a mutation without observing it itself — the case of
an External Event adapter applying a mutation received from a peer without
rebroadcasting it — uses:

```javascript
invokeSkipping(handle, args);
```

This traverses the whole chain skipping only the caller's entry.

The pattern it replaces was to capture the original method at construction time
and call it directly. That skipped not only the caller's wrapper but every
wrapper installed **after** it, which made a documented behavior depend on
instantiation order. Measured on the implemented adapters, with a remote
mutation delivered through an injected channel:

| Instantiation order | applied to graph | projected to Pulsar | persisted |
|---|---|---|---|
| External Event first | yes | no | no |
| External Event last | yes | yes | yes |

Both rows were produced by the same code. The "known limitation" was an
artifact of montage order. `invokeSkipping` removes the dependency: the
reinjected mutation always reaches the rest of the chain.

#### 3.5.4 Scope

The chain applies to any instance method an adapter wraps, not only nebula's.
The Logging adapter wraps `pulsar.setState` through the same mechanism.

Bulk loading is a separate concern and is **not** solved by the chain. The
invariant established in `ESCENA_1_1_ARRANQUE.md` §6 — mass data loading
happens before any adapter wraps the graph, or with the adapters explicitly
destroyed — remains in force for the reason stated there: the cost is
structural (2N `setState` calls, each O(N)), not a teardown-order artifact.


## 4. Composition Rules

### 4.1 With PulsarJS

Adapters that write to Pulsar must respect the state tree namespacing convention (Nexus Contract §5). The reserved top-level keys are `route`, `entities`, `ui`, `net`. Adapters should default to writing under `entities` (for domain projections) or `net` (for external system state), and expose configuration to override this only when justified.

Adapters that read from Pulsar should use `subscribeSelector` with the narrowest possible selector to avoid re-notifying on unrelated state changes.

### 4.2 With nebulaJS

Adapters that observe nebula mutations do so by wrapping the **seven** mutation methods (`put`, `upsert`, `update`, `delete`, `link`, `unlink`, `unlinkAll`) through the chain described in §3.5. `query` is a read and is not wrapped by any first-generation adapter; an adapter that needed to react to reads would wrap it through the same mechanism and say so in its mini-spec.

Adapters must respect set semantics for links (nebula Contract §2.3) — an adapter that emits change events on `link` must emit on the first insertion of a triple, not on subsequent no-op calls.

### 4.3 With VoyajerJS

Adapters generally do not interact with Voyajer directly. Voyajer already writes to Pulsar under `route.*`; adapters that react to navigation subscribe to `route.*` in Pulsar, not to Voyajer itself.

### 4.4 With ChunkletJS

Adapters and Chunklet behaviors overlap in scope: both can react to state changes and produce effects. The distinction is:

- **Adapters** operate outside the DOM lifecycle. They live from application startup to shutdown, independent of any element being mounted.
- **Chunklet behaviors** operate inside the DOM lifecycle. They are created and destroyed with their elements.

When both approaches would work for a given task, prefer the one whose lifecycle matches the task. Global data synchronization is adapter work; per-element event handling and rendering is Chunklet work.


## 5. Catalog of First-Generation Adapters

The following adapters are identified as necessary for the first real application (browser-side diagram editor). Each will receive its own mini-specification when implemented in Phase 0 Point 5. They are listed here in order of dependency (earlier ones are prerequisites for later ones in some scenarios).

**1. nebula ↔ Pulsar Bridge**
Projects nebula entities into a Pulsar state slice (default: `entities.*`) so that Chunklet behaviors can subscribe reactively. This is the core adapter — the reason Chunklet can render entities without polling nebula.

**2. Hydration Adapter**
Reads persisted data from a storage backend (localStorage, IndexedDB, or a URL-encoded snapshot) and populates nebula at application startup, before Chunklet mounts behaviors. Ensures the first render sees populated state.

**3. Persistence Adapter**
The complementary write-side of Hydration. Observes nebula mutations and persists to a storage backend, either eagerly (on every mutation), throttled (batched), or on explicit save.

**4. External Event Adapter**
Translates events from external sources (WebSocket, `postMessage`, SSE) into nebula mutations and Pulsar state updates. Enables real-time synchronization with servers or cross-tab coordination.

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

### 5.2 Note on the nebula ↔ Pulsar Bridge

The generic bridge described in item 1 above will initially be implemented as a **snapshot-based projection**: any nebula mutation triggers a full re-projection of the affected entity type into Pulsar. This is the version that will be produced in Punto 5.

The **correct long-term implementation** projects reactively per entity: only the specific entity's slice in Pulsar is updated when its nebula record changes. This requires either additional observability primitives in nebula (an opt-in change notification API) or an intermediate change-detection layer built into the bridge itself.

The initial snapshot-based version is sufficient for early applications where the entity set is small, but it does not scale. The mini-specification of the bridge will describe the correct behavior; the first implementation will document its own limitations and the path to the reactive version.


### 5.3 Shared Adapter Infrastructure

`adapter-chain.js` is **not** an adapter and does not appear in the catalog. It
is shared infrastructure: a module with no dependencies, imported by adapters
only, that exposes `wrap`, `unwrap`, `invokeSkipping` and `depth`. It has no
`destroy`, holds no application state, and never references a primitive by
import — it receives instances as arguments like any adapter does.

Its position with respect to the Nexus Contract §3 hierarchy requires no change
to that document. The Law of Hierarchy governs the four primitives; adapters
and their infrastructure already live at Level 4, instantiated and composed by
the application. The chain sits below the adapters and above nothing:

```text
primitives (Levels 0-3)
     ▲
     │ receives instances as arguments, never imports them
adapter-chain.js        ← shared infrastructure, zero dependencies
     ▲
adapters                ← import the chain
     ▲
application (Level 4)   ← instantiates adapters
```

No primitive imports the chain. No primitive knows it exists. The enforcement
rules of Nexus Contract §3 are unaffected.

### 5.4 Effect on Previously Deferred Items

`PHASE_0_DEFERRED.md` carried two items, `12-BRIDGE-INTEGRATION` and
`12-PERSISTENCE-INTEGRATION`, recording that mutations arriving from a peer tab
did not re-project through the Bridge nor persist in the receiving tab. Both
are **resolved** by §3.5.3, and resolved together, as that document predicted
they would be.

Worth recording, because it bears on how the remaining deferred items are
read: the resolution is option (c) of the three that
`12-BRIDGE-INTEGRATION` listed — "restructuring wrappers into a single
dispatcher chain instead of independent monkey-patches". The two options
favored at the time, an `isRemote` flag and a shared remote-context signal,
both required each adapter to learn something about the others. The chain needs
none of that: skipping is by identity of the caller's own entry, and the
adapters remain mutually ignorant, which §2 requires of them.

The item was deferred waiting for "evidence of the pattern's cost in a real
application". The evidence that arrived was of a different kind — the same root
cause surfaced as a teardown-order defect, and fixing that dissolved this one.
That is worth noting for its own sake: an item deferred pending evidence can be
closed by work undertaken for another reason, and the register should be read
with that possibility in mind rather than as a queue awaiting its predicted
trigger.


## 6. Behavioral Guarantees

| Guarantee | Description |
| :--- | :--- |
| **Mandatory destroy** | Every adapter returns `destroy()`. No exceptions. |
| **Idempotent destroy** | Calling destroy twice is safe. |
| **Resource ownership** | Adapters release all resources they acquire, on destroy. |
| **Semantics preserved** | Adapters wrap methods but do not change their signature, return value, thrown errors, or effect. |
| **Order-independent teardown** | Destroying an adapter never removes another adapter from the chain, regardless of the order relative to instantiation. |
| **Chain reachability** | A mutation invoked on a wrapped method traverses every live wrapper installed on it. |
| **Self-skipping reinjection** | An adapter may reapply a mutation through the chain skipping only its own entry, without any coordination with the other adapters. |
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
