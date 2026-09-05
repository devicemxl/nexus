# Adapter Mini-Spec: External Event Adapter (BroadcastChannel)

**Version:** 0.1.0 (specification)
**Implementation status:** initial
**Scope:** Bidirectional cross-tab synchronization of GraphletJS mutations via `BroadcastChannel`, with explicit anti-echo protection.


## 1. Purpose

Multiple browser tabs of the same application, running against the same Graphlet, currently do not see each other's mutations until one of them reloads and re-hydrates from persisted storage (see Persistence Adapter). This adapter closes that gap: when a Graphlet mutation happens in Tab A, it is broadcast to peer tabs; when a peer tab receives it, the same mutation is applied to its local Graphlet.

The adapter is **only** for cross-tab synchronization in v0.1.0. WebSocket, SSE, `postMessage` across frames, and other external event sources fit the same architectural pattern but are out of scope. The reason for restricting v0.1.0 to `BroadcastChannel` is evidence-first design (Article I): the target application requires cross-tab sync now; other transports are speculative until a real application demands them. When one does, the interface designed here will either generalize (via an injectable transport) or replicate (via sibling factories for each transport). The choice is deferred to that evidence.


## 2. Factory Signature

```typescript
type MutationOp = 'put' | 'upsert' | 'update' | 'delete' | 'link' | 'unlink' | 'unlinkAll';

type MutationEvent = {
  type: 'graphlet-mutation';   // Discriminator for coexistence with other channel messages.
  origin: string;              // UUID of the emitting tab. Enables anti-echo.
  op: MutationOp;              // Which Graphlet method was called.
  args: unknown[];             // The method arguments, JSON-serializable.
};

type ExternalEventOptions = {
  channelName: string;              // Required. Name of the BroadcastChannel.
  channel?: BroadcastChannel;       // Optional. Injectable channel (for tests).
  onRemoteError?: (error: Error, event: MutationEvent) => void;
                                    // Default: console.warn. Invoked when applying a remote event throws.
};

function createExternalEventAdapter(
  context: { graphlet: GraphletInstance },
  options: ExternalEventOptions
): {
  origin: string;                   // The UUID of this adapter's tab.
  destroy(): void;
};
```

**Parameters:**

- `context.graphlet`: the Graphlet instance whose mutations will be broadcast and against which incoming mutations will be applied.
- `options.channelName`: required string. Two adapters using the same name form a synchronization group; using different names isolates groups. There is no default because a silent default risks cross-application collisions on the same origin.
- `options.channel`: optional pre-created `BroadcastChannel` (or any object with the same shape: `postMessage`, `addEventListener('message', ...)`, `close`). Primary use is testing with a mock; also useful if the application wants to hold a channel reference externally. If omitted, the adapter creates one via `new BroadcastChannel(channelName)`.
- `options.onRemoteError`: invoked when applying a remote mutation to local Graphlet throws (e.g., `link` referencing an entity that does not exist locally). Default logs to `console.warn`. The error does not propagate out of the message handler.

**Returns:**

- `origin`: the UUID stamped on every event this adapter emits. Exposed for diagnostics and for tests that need to construct events with a matching or differing origin.
- `destroy()`: unwraps the Graphlet methods, closes the channel (if owned by the adapter), and marks the adapter inert. Idempotent.


## 3. Behavior

### 3.1 Outbound: local mutations become broadcast events

On instantiation, the adapter wraps the seven Graphlet mutation methods (`put`, `upsert`, `update`, `delete`, `link`, `unlink`, `unlinkAll`) using the same pattern as the Bridge and Persistence adapters. Each wrapper calls through to the original, then:

1. Constructs a `MutationEvent` with `type: 'graphlet-mutation'`, `origin: this.origin`, `op: <method name>`, and `args: [<the arguments the wrapper received>]`.
2. Calls `channel.postMessage(event)`.

For `link`, `unlink`, and `unlinkAll`, set-semantics awareness applies (same `_snapshotLinksOf` pattern as Bridge and Persistence): if the underlying method was a no-op, no event is broadcast. Emitting a no-op event would cause peer tabs to also apply a no-op, correct but wasteful.

### 3.2 Inbound: remote events become local mutations

On instantiation, the adapter registers a `message` listener on the channel. When a message arrives, the handler:

1. Validates the payload shape. If it does not look like a `MutationEvent` (missing `type`, wrong `type`, missing `op`, `args` not an array), the message is ignored. This tolerates the channel being used for other traffic by the application.
2. Checks the `origin`. If it equals the adapter's own `origin`, the event is discarded — this is the anti-echo. `BroadcastChannel` by convention does not deliver to the sending context, but the check is defensive: if the transport ever delivered back, or if the same channel is reused across nested contexts, anti-echo prevents the feedback loop from starting.
3. Uses the **original** Graphlet method (captured before wrapping) to apply the mutation. This is critical: applying via the wrapped method would re-broadcast the event, creating a loop. The original method mutates Graphlet but does not trigger the outbound wrapper.
4. If the original method throws, calls `onRemoteError(error, event)` and continues. The channel listener does not throw.

### 3.3 Anti-echo model

Anti-echo relies on the invariant: **the wrapped method emits; the original method does not**. Incoming events always call the original. Local calls always go through the wrapped. As long as this discipline is preserved, the adapter cannot loop.

The `origin` check is a second line of defense. If a future transport (e.g., WebSocket relay) does not have `BroadcastChannel`'s local-suppression behavior, the origin check remains sufficient to prevent echo.

### 3.4 Destroy

`destroy()` performs four actions:

1. Restore the seven original Graphlet methods.
2. Remove the `message` listener from the channel.
3. If the channel was created by the adapter (not injected), call `channel.close()`.
4. Mark the adapter destroyed. Subsequent inbound messages are ignored (defensive; the listener is already removed, but a race with a message already in the queue is handled).

`destroy()` is idempotent.


## 4. Composition Notes

### 4.1 With Persistence Adapter

Both wrap the same Graphlet methods. Order of instantiation matters:

- **Persistence outer, External inner (Persistence instantiated last):** local mutations first broadcast, then persist. Remote mutations arrive via the External wrapper (bypassed by the "original" trick), get applied to the raw Graphlet, and are not persisted by this tab — because they went through the original method that Persistence never saw. Consequence: remote mutations are visible in-memory but do not update this tab's `localStorage`. Since Persistence's key is per-tab-shared and any tab's mutation will persist from that tab's own outbound path, the network eventually reaches a consistent persisted state, but with a race.

- **External outer, Persistence inner (External instantiated last):** local mutations first persist, then broadcast. Remote mutations similarly bypass Persistence's wrapper because they use the original. Same effective behavior as above regarding remote persistence.

Neither order guarantees that a remote-arrived mutation gets persisted by the receiving tab. This is intentional for v0.1.0: the emitting tab persists, and if the receiving tab also mutates locally later, that later mutation captures the current state. If the emitting tab crashes before its Persistence debounce fires, the mutation is lost to storage even though other tabs saw it live. The tradeoff is documented; a future version could add "persist on remote-applied" as an option.

Recommended order for the current application: **Persistence first, External second (External is outer wrapper)**. This means broadcast happens after Persistence's `_scheduleWrite`, so a mutation is queued for persistence before peers even see it — the emitting tab has the strongest durability guarantee.

### 4.2 With Bridge Adapter

Bridge also wraps the same methods. Recommended order: **Bridge innermost, then Persistence, then External outermost**. This makes the wrapped call flow:

```
graphlet.put(...)  →  External wrapper (broadcast)
                  →  Persistence wrapper (schedule write)
                  →  Bridge wrapper (re-project to Pulsar)
                  →  original graphlet.put
```

Remote inbound: `original.put(...)` — Bridge does not re-project (the inbound event bypassed its wrapper). Consequence: **the receiving tab's Pulsar projection does not reflect remote mutations**. This is a real limitation of v0.1.0.

**Workaround (application-level):** subscribe to the channel independently and manually re-invoke `graphlet.put(...)` (the wrapped version) upon remote events. This re-broadcasts unnecessarily but works. **Proper resolution:** in v0.2.0, the External adapter itself invokes the wrapped Bridge method to update the projection, using an explicit "mark as remote" flag that Bridge respects to skip its own re-broadcast (via a hook or convention). This requires coordinated changes across adapters and is deferred.

Documented as `12-BRIDGE-INTEGRATION` deferred item once this mini-spec lands.

### 4.3 With Hydration Adapter

No interaction. Hydration runs once at startup and finishes before this adapter is typically instantiated. If Hydration runs while this adapter is active (e.g., a manual re-hydration), Hydration's `upsert`/`link` calls go through the wrapped methods and would broadcast — which is probably not desired. Applications performing mid-life re-hydration should temporarily `destroy()` this adapter, re-hydrate, and re-instantiate.


## 5. Behavioral Guarantees

| Guarantee | Description |
| :--- | :--- |
| **Anti-echo by origin** | Events with `origin === this.origin` are discarded. No feedback loop can start regardless of transport behavior. |
| **Anti-echo by original** | Inbound events apply via the original method, not the wrapped one. Applying does not re-emit. |
| **Set semantics respected** | `link`/`unlink`/`unlinkAll` that are Graphlet no-ops do not emit an event. |
| **Foreign message tolerance** | Messages that do not match the `MutationEvent` shape are ignored. Coexistence with other channel traffic is safe. |
| **Idempotent destroy** | Second `destroy()` is safe no-op. |
| **Original API preserved on destroy** | After `destroy()`, `graphlet.link(...)` etc. behave exactly as before instantiation. |
| **Remote errors do not break the listener** | If applying a remote event throws, `onRemoteError` is invoked and the listener continues to receive subsequent events. |
| **Channel ownership honored** | If the channel was injected via `options.channel`, `destroy()` does not close it. If the adapter created the channel, `destroy()` closes it. |


## 6. What This Adapter Does NOT Do

- **Does not synchronize Pulsar state.** Only Graphlet. If UI state (selection, viewport) needs to be shared across tabs, that is a separate concern.
- **Does not synchronize the receiving tab's Pulsar projection.** As documented in §4.2, remote-arrived mutations do not trigger the Bridge adapter's re-projection in the receiving tab. See workaround.
- **Does not persist on remote apply.** As documented in §4.1, remote-arrived mutations do not trigger the Persistence adapter's write in the receiving tab.
- **Does not order events.** BroadcastChannel does not provide total ordering across tabs. If two tabs mutate concurrently, both apply both mutations, but the final order in each tab's Graphlet depends on message delivery order (which is not guaranteed to be the same across tabs for concurrent sends). For applications requiring total order, a coordinator tab or a server-side timestamp is needed.
- **Does not resolve conflicts.** Concurrent mutations to the same entity produce last-write-wins semantics per tab. No CRDT, no operational transform. The target application (single user, multiple tabs) rarely produces conflicts; multi-user cases require different machinery.
- **Does not fall back if BroadcastChannel is unavailable.** `BroadcastChannel` is supported in all evergreen browsers as of 2024. The adapter throws at instantiation if it is not available and no channel was injected. Applications supporting older environments should feature-detect and skip the adapter.
- **Does not support WebSocket, SSE, or postMessage in v0.1.0.** BroadcastChannel only. Other transports are deferred (Article I).


## 7. Deferred

Documented for cross-reference; will be recorded in `PHASE_0_DEFERRED.md` when this mini-spec lands.

- **`12-BRIDGE-INTEGRATION`** — the receiving tab's Bridge projection is not updated by inbound remote mutations. Resolution requires coordinated behavior across External and Bridge (e.g., a "remote" flag that Bridge honors to update projection without re-emit). Waits for a real application to demonstrate the friction.
- **`12-PERSISTENCE-INTEGRATION`** — same shape as above for Persistence. Same resolution path.
- **`12-TRANSPORTS`** — generalization to WebSocket, SSE, `postMessage`. Waits for a real application requiring any of these.


## 8. Versioning

- **Patch:** Bug fixes that do not change behavior.
- **Minor:** New options that do not break existing consumers (e.g., transport-agnostic layer, `onRemoteError` phases).
- **Major:** Changes to the factory signature, changes to the wire event shape, changes to the anti-echo model, or changes to which Graphlet methods are wrapped.


*End of Mini-Spec.*
