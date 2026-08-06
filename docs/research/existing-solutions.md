# Existing solutions for same-origin store synchronization

Date: 2026-08-06

## Question

This note reviews packages that can synchronize state between same-origin browser tabs. The target integration uses Pinia and Eventa.

The desired contract has two separate concerns:

1. Replicate selected Pinia state between tabs.
2. Route selected actions without duplicate execution, lost updates, or unordered commits.

No reviewed package provides that complete Pinia contract. `tab-election` provides the closest command and state coordination model.

## Decision: `tab-election` over `tabcoord`

Choose `tab-election` if these two packages are the only candidates. It has one elected authority and routes RPC calls to that authority.

Do not add either package if Eventa must remain the protocol boundary. `tab-election` creates a second BroadcastChannel and an untyped string RPC layer.

In that case, use its single-leader architecture as a reference. Implement the typed command and commit envelopes in Eventa.

This model matches Pinia action synchronization. Each tab calls the same asynchronous proxy, but only the leader executes the action.

The leader then publishes the committed Pinia snapshot through `setState`. Followers apply that snapshot with a suppressed `$patch`.

`tabcoord` has a richer feature list. However, its state store and event bus do not provide safe action execution.

Its distributed lock also has a correctness defect. Each tab grants itself the lock before it receives another tab's request.

Two tabs can therefore enter the protected callback at the same time. The source keeps the holder map inside each tab.

The following table shows the important differences.

| Topic | `tab-election` | `tabcoord` |
| --- | --- | --- |
| Core model | One leader with RPC, messages, and leader-owned state | Independent LWW stores, event bus, election, and message-based locks |
| State | Only the leader calls `setState`, and all tabs receive the full value | Every tab can call `set`, and a logical clock selects one full snapshot |
| Action or command | `call()` executes against the leader API and returns a result or error | Event bus only, so the application must execute and correlate commands |
| Normal command execution | One leader executes the command | An event handler can execute in every tab |
| Failover delivery | At least once, so handlers must be idempotent | No command acknowledgement or result protocol |
| Mutual exclusion | The leader holds a native Web Lock | `lockManager` uses distributed messages and is not safe |
| Browser fallback | Requires Web Locks and BroadcastChannel | BroadcastChannel falls back to storage events, and election falls back to heartbeats |
| Pinia integration | Wrap actions as leader RPC and publish committed state | Adapt `createSharedStore`, then design a separate action protocol |
| Eventa integration | Replaces most Eventa RPC and transport work | Duplicates Eventa transport, state, events, and locks |
| Maturity signal | 54 npm versions and about 13,700 weekly downloads | 9 npm versions and about 26 weekly downloads |
| Current package | 4.6.2, MIT, about 261 KB unpacked | 1.3.0, MIT, about 357 KB unpacked |

### `tab-election` source evidence

The [`Tab` implementation](https://github.com/dabblewriter/tab-election/blob/2897eb1fc876fcbcd9fea81d621f619eace7f8cf/src/tab.ts) requests one exclusive Web Lock per namespace. It keeps the lock until leadership ends.

`call()` adds a caller identifier and call number. The leader invokes the named API method and returns its result or error.

The leader acknowledges a call before it finishes execution. A caller sends the call again when leadership changes.

The source explicitly describes this behavior as at-least-once delivery. A handler can run twice if the old leader commits before it fails.

The package does not keep completed operation identifiers. The Pinia plugin must add `operationId` deduplication for non-idempotent actions.

`setState()` is leader-only and uses structured clone. The state is transient and has no revision or durable storage.

The [official package README](https://github.com/dabblewriter/tab-election) documents queued RPC calls, state synchronization, and Hub/Spoke services.

The basic `Tab.call()` API uses a string method path and `any` arguments. The newer Hub/Spoke API adds service-level TypeScript proxies.

### `tabcoord` source evidence

The shared store assigns each write a counter and tab identifier. Its [clock source](https://github.com/ihssmaheel-dev/tabcoord/blob/6f5fbaa4e6e04a72051f2cf11d54182edd89d89f/packages/core/src/clock.ts) uses the tab identifier as a tie-breaker.

The [store source](https://github.com/ihssmaheel-dev/tabcoord/blob/6f5fbaa4e6e04a72051f2cf11d54182edd89d89f/packages/core/src/internal-store.ts) sends the full state for each write. Concurrent updates therefore use deterministic last-writer-wins replacement.

This behavior can converge state, but it can discard one concurrent action result. It does not serialize the actions that produced those states.

The [event bus source](https://github.com/ihssmaheel-dev/tabcoord/blob/6f5fbaa4e6e04a72051f2cf11d54182edd89d89f/packages/core/src/event-bus.ts) broadcasts events without acknowledgements or remote result correlation.

Its incoming ordering code looks for `_meta.sequence`. The emitted event metadata does not include that field, so this ordering check is inactive.

The [lock source](https://github.com/ihssmaheel-dev/tabcoord/blob/6f5fbaa4e6e04a72051f2cf11d54182edd89d89f/packages/core/src/lock-manager.ts) stores `holders` in local memory.

After a tab broadcasts its request, lines 200-208 grant the lock locally when that local map is empty. Every new tab starts with an empty map.

The grant message also discards the request identifier. This design has no single grant authority and cannot guarantee mutual exclusion.

The separate leader-election module does use Web Locks. The lock manager does not use that module or `navigator.locks`.

### Required layer above `tab-election`

`tab-election` solves single-writer routing, but it does not provide exactly-once actions. The Pinia integration still needs these rules:

1. Give each action call a stable `operationId`.
2. Keep a bounded set of committed identifiers in the leader state or durable storage.
3. Execute the action only on the leader.
4. Wait for the action to settle.
5. Publish one committed snapshot and revision.
6. Return the action result or error to the caller.
7. On failover, reject or deduplicate an uncertain action. Never replay an external effect without a policy.

Direct follower mutations need the same authority. The plugin must route them as patch commands or reject them.

This integration changes all synchronized action return types to promises. That API change must be explicit.

## Summary

| Project | Direct Pinia support | Replicated unit | Same-origin tabs | Concurrent writes | Leader or lock | Offline persistence | Fit for this package |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [`tab-election`](https://github.com/dabblewriter/tab-election) | No | Leader RPC and leader-owned state | Yes | One native-lock leader | Web Locks | No | Best action-routing base |
| [`tabcoord`](https://github.com/ihssmaheel-dev/tabcoord) | No | LWW state and events | Yes | LWW state, unsafe lock | Election plus message lock | Local storage option | Do not use for actions |
| [`pinia-shared-state`](https://github.com/wobsoriano/pinia-shared-state) | Yes | Full selected store snapshot | Yes | Timestamp-based last writer wins | No | Depends on channel backend | Closest API, but weaker protocol |
| [`broadcast-channel`](https://github.com/pubkey/broadcast-channel) | No | Messages | Yes | Transport ordering only | Leader election, with Web Locks when available | Messages work offline between active contexts | Good transport or leader layer |
| [`useBroadcastChannel`](https://vueuse.org/core/useBroadcastChannel/) | No | Messages in Vue refs | Yes | Transport ordering only | No | No | Convenience wrapper only |
| [TinyBase](https://tinybase.org/guides/synchronization/) | No | Mergeable tables and key-value data | Yes | Deterministic CRDT merge | No lock required for data merge | Optional persisters | Best small data-engine alternative |
| [Dexie](https://dexie.org/docs/liveQuery%28%29) | No | IndexedDB records and transactions | Yes | IndexedDB transactions | No leader required for local writes | Yes | Good authoritative message database |
| [Yjs](https://github.com/yjs/yjs) | No | CRDT shared types and updates | Yes, through a provider | Conflict-free CRDT merge | No lock required for data merge | With `y-indexeddb` | Best for collaborative structures |
| [Automerge Repo](https://automerge.org/docs/tutorial/local-sync/) | No | CRDT documents and changes | Yes, with an official adapter | Conflict-free CRDT merge | No lock required for data merge | Official IndexedDB adapter | Complete local-first alternative, heavier model |
| [RxDB](https://rxdb.info/transactions-conflicts-revisions.html) | No | Validated documents and revisions | Yes | Revisions and conflict handlers | Built-in leader election for replication | Yes | Complete database alternative, high complexity |
| [Replicache](https://doc.replicache.dev/) | No | Database mutators and server sync | Not while offline in current model | Server reconciliation and optimistic rollback | Internal coordination | Partial local acceleration | Poor fit and commercial license |

The table uses “action” narrowly. A CRDT change, database transaction, or Replicache mutator is not an arbitrary Pinia action.

An arbitrary action can perform network requests, write files, or show notifications. A state engine cannot safely replay these effects on every tab.

## Direct Pinia options

### `pinia-shared-state`

This package is the closest existing implementation. It is a Pinia plugin and supports per-store opt-in and omitted keys.

The implementation creates one `broadcast-channel` instance for each Pinia store. It publishes a serialized state snapshot from `$subscribe`.

The receiver accepts a snapshot when its timestamp is newer than the local timestamp. Initialization sends `undefined`, which asks active peers for snapshots.

These details are visible in the [plugin source](https://github.com/wobsoriano/pinia-shared-state/blob/main/src/index.ts). The README documents native, IndexedDB, local-storage, and Node channel backends.

The package does not synchronize actions. It also does not provide a transaction, operation identifier, deduplication, or a total order.

`Date.now()` is the conflict clock. Two writes can share one millisecond, and clocks can differ between browser environments.

The package is useful as an API reference. It is not a protocol foundation for safe action routing.

Current package data from npm:

- Version `2.0.1`
- MIT license
- Pinia `^3.0.0` peer dependency
- Approximately 21 KB unpacked package size
- Direct dependency on `broadcast-channel`

The [package manifest](https://github.com/wobsoriano/pinia-shared-state/blob/main/package.json) and [npm package page](https://www.npmjs.com/package/pinia-shared-state) are the primary package sources.

### `pinia-plugin-persistedstate`

This package persists and hydrates Pinia state. It does not subscribe to storage events as a live replication protocol.

Its public storage contract only requires synchronous `getItem` and `setItem` methods. The source also exposes explicit `$hydrate` and `$persist` methods.

See the [official guide](https://prazdevs.github.io/pinia-plugin-persistedstate/guide/) and [storage type](https://github.com/prazdevs/pinia-plugin-persistedstate/blob/main/src/types.ts).

The GitHub repository was archived in August 2025. Persistence and cross-tab convergence are different contracts.

This package does not solve the target problem.

## Transport and coordination options

### `broadcast-channel`

This package supplies a cross-tab message transport and leader election. It selects native BroadcastChannel, IndexedDB, local storage, sockets, or a simulation backend.

Its leader election uses the Web Locks API when available. It uses a message-based election algorithm as a fallback.

See the official [transport and leader-election documentation](https://github.com/pubkey/broadcast-channel#using-the-leaderelection).

This package does not define state versions, commits, retries, action results, or conflict resolution. Leader election also differs from an operation mutex.

A leader can own all commands. A lock can instead serialize each command without a permanent leader.

Current npm data shows version `7.4.0`, an MIT license, and approximately 540 KB unpacked size. The browser bundle is smaller than this distribution size.

For the current project, Eventa already supplies the BroadcastChannel adapter. Adding this package only makes sense for its fallback transports or leader election.

### VueUse `useBroadcastChannel`

VueUse exposes native BroadcastChannel data as reactive Vue refs. It also closes the channel during component cleanup.

The [official API](https://vueuse.org/core/useBroadcastChannel/) provides `post`, `close`, `data`, `error`, and support state. It does not add ordering or conflict rules.

This composable is useful in a Vue component. A package-level Eventa context already owns the required lifecycle and transport boundary.

### Native Web Locks

Web Locks can serialize work across tabs and workers of one origin. A lock is released when its asynchronous callback completes.

Queued requests for the same exclusive lock wait for the current holder. The API requires a secure context.

See the [Web Locks API documentation](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API).

Web Locks do not store the latest state. They also do not deliver a commit to another tab.

The lock must cover a read-modify-commit sequence against an authoritative value. IndexedDB can store that value and its revision.

## Local data engines

### TinyBase

TinyBase has a `MergeableStore` with deterministic merge metadata. Its official synchronizer sends this data through browser BroadcastChannel.

The [synchronization guide](https://tinybase.org/guides/synchronization/) recommends combining synchronization with persistence. The [BroadcastChannel synchronizer](https://tinybase.org/api/synchronizer-broadcast-channel/) is a supported module.

TinyBase is framework-neutral. It has official React, Solid, and Svelte bindings, but no Pinia or Vue binding.

The full runtime has no dependencies. The project reports 7.2 KB gzip for its minimal store and 15.6 KB gzip for the complete main package.

TinyBase is a strong option when the shared state fits tables and scalar values. Pinia can become a projection of a TinyBase store.

It does not synchronize arbitrary actions. Application commands must change the `MergeableStore`, then Pinia must observe the result.

The current npm package is active, MIT licensed, and at version `9.3.0`.

### Dexie and `liveQuery`

Dexie provides an IndexedDB API and reactive queries. Its mutated ranges are broadcast to other browsing contexts.

As a result, a `liveQuery` in one tab reacts to Dexie writes from another tab or worker. See the [official `liveQuery` documentation](https://dexie.org/docs/liveQuery%28%29).

Dexie is not a replication algorithm. IndexedDB becomes the single same-origin database, and transactions protect database updates.

This model fits a messages store well. Messages can use stable identifiers, and the UI can derive state from a live query.

An action that contains non-database asynchronous work cannot remain inside one IndexedDB transaction. Such an action needs a shorter commit transaction.

Dexie is Apache-2.0 licensed. The current npm package is version `4.4.4` and approximately 3.2 MB unpacked.

Dexie Cloud adds remote synchronization, authentication, and conflict handling. It is a managed service, not a local Pinia plugin.

### Yjs

Yjs provides CRDT maps, arrays, text, and other shared types. Concurrent updates merge without a central lock.

The core is transport-neutral. Network and persistence providers are separate. The [Yjs repository](https://github.com/yjs/yjs) documents `y-indexeddb` for local persistence.

The stable [`y-websocket` provider](https://github.com/yjs/y-websocket) exchanges updates between same-browser tabs. It uses BroadcastChannel with local storage as a fallback.

There is no official `y-broadcastchannel` npm package. A local-only integration needs a suitable provider or a small custom Yjs provider.

Yjs is a good fit for collaborative text and collections with true concurrent editing. It requires the shared data to move into Yjs types.

Pinia can expose a view of the Yjs document. Pinia must not remain a second authoritative copy.

Yjs and its related projects use the MIT license. The current `yjs` package is version `13.6.32` and approximately 2.3 MB unpacked.

### Automerge Repo

Automerge Repo combines a CRDT document with storage and network adapters. It has official adapters for IndexedDB and BroadcastChannel.

The official [local storage and sync tutorial](https://automerge.org/docs/tutorial/local-sync/) demonstrates two same-origin tabs. Concurrent changes merge through Automerge rules.

The IndexedDB adapter supports concurrent repository instances. The [storage documentation](https://automerge.org/docs/reference/repositories/storage/) states that live updates still need a network adapter.

This option solves more of the protocol than a Pinia plugin. It also changes the authoritative data model to Automerge documents.

Automerge uses the MIT license. Current package versions are `3.4.0` for the core and `2.5.6` for stable Repo packages.

The core npm tarball is approximately 50 MB unpacked because it includes WASM and distribution artifacts. This number is not the final browser transfer size.

### RxDB

RxDB provides reactive documents, local persistence, multi-tab operation, replication, revisions, and conflict handlers.

Each document includes a revision similar to a Lamport clock. A stale write produces a conflict, while incremental operations reapply their mutation function.

See the official [transactions, conflicts, and revisions guide](https://rxdb.info/transactions-conflicts-revisions.html).

RxDB can elect one tab to run remote replication. The [replication guide](https://rxdb.info/replication.html) documents this multi-instance behavior.

RxDB is suitable when messages are already a durable local database with remote sync requirements. It is excessive for a small ephemeral Pinia store.

The core uses the Apache-2.0 license. Some storage and feature plugins require premium access.

The current `rxdb` package is version `17.4.0` and approximately 11.2 MB unpacked.

## Commercial or mismatched options

### Replicache

Replicache provides optimistic mutations, rollback, server synchronization, and reactive subscriptions. Its tutorial demonstrates a counter across browsers.

The current model does not synchronize offline tabs with each other. Each tab proceeds independently until network access returns.

The project also requires a license key and uses commercial terms. The [release history](https://github.com/rocicorp/replicache/releases) documents both constraints.

Replicache is not a suitable dependency for local, open-source, same-origin-only synchronization.

### Legend-State sync

Legend-State is a separate state system with persistence and remote synchronization plugins. It has no Pinia integration.

Using it under Pinia creates two reactive authorities. This design adds more risk than a direct Eventa adapter.

It was not reviewed further because TinyBase, Dexie, Yjs, and Automerge cover the relevant data-engine choices.

## Package size and maintenance snapshot

The following values came from `npm view` on 2026-08-06. “Unpacked” measures the published files, not the production browser bundle.

| Package | Version | Unpacked | License | Maintenance signal |
| --- | ---: | ---: | --- | --- |
| `tab-election` | 4.6.2 | 261 KB | MIT | Published in July 2026 |
| `tabcoord` | 1.3.0 | 357 KB | MIT | Published in June 2026 |
| `pinia-shared-state` | 2.0.1 | 21 KB | MIT | Published in 2026 |
| `broadcast-channel` | 7.4.0 | 540 KB | MIT | Published in August 2026 |
| `@vueuse/core` | 14.4.0 | 904 KB | MIT | Published in July 2026 |
| `tinybase` | 9.3.0 | 14.8 MB | MIT | Published in July 2026 |
| `dexie` | 4.4.4 | 3.2 MB | Apache-2.0 | Published in June 2026 |
| `yjs` | 13.6.32 | 2.3 MB | MIT | Published in August 2026 |
| `@automerge/automerge` | 3.4.0 | 50.2 MB | MIT | Published in July 2026 |
| `@automerge/automerge-repo` | 2.5.6 | 948 KB | MIT | Published in July 2026 |
| `rxdb` | 17.4.0 | 11.2 MB | Apache-2.0 | Published in July 2026 |
| `replicache` | 15.3.0 | 198 KB | Commercial terms | npm metadata changed in May 2026 |

Use each project npm page to verify current package data before adoption:

- [`pinia-shared-state`](https://www.npmjs.com/package/pinia-shared-state)
- [`tab-election`](https://www.npmjs.com/package/tab-election)
- [`tabcoord`](https://www.npmjs.com/package/tabcoord)
- [`broadcast-channel`](https://www.npmjs.com/package/broadcast-channel)
- [TinyBase](https://www.npmjs.com/package/tinybase)
- [Dexie](https://www.npmjs.com/package/dexie)
- [Yjs](https://www.npmjs.com/package/yjs)
- [Automerge](https://www.npmjs.com/package/@automerge/automerge)
- [RxDB](https://www.npmjs.com/package/rxdb)
- [Replicache](https://www.npmjs.com/package/replicache)

## Recommendation

There are three sensible paths.

### 1. Keep Pinia authoritative

Use `tab-election` when one leader must execute all actions and Eventa is optional. Add operation deduplication above its RPC protocol.

Use Eventa when it must remain the typed protocol boundary. Add Web Locks and the single-leader command model without `tab-election` transport.

Store the committed snapshot and revision in IndexedDB. A new lock holder must read that value before it executes a command.

Execute an effectful action in one tab only. Broadcast the committed state and action result, not a request to replay the effect.

This path keeps the package small and preserves the proposed explicit Pinia API. `pinia-shared-state` is useful only as an implementation reference.

### 2. Make a local database authoritative

Use Dexie when messages are durable records. Subscribe through `liveQuery`, and project query results into Pinia.

This path supplies transactions, persistence, stable record identifiers, and late-tab hydration. It does not require a CRDT for ordinary message append and update operations.

### 3. Make a mergeable store authoritative

Use TinyBase for a small general data model. Use Yjs or Automerge when users can edit the same structured data concurrently.

Pinia becomes a view and command facade in this design. The CRDT store owns conflict resolution and synchronization.

## Final conclusion

`tab-election` is the best reviewed package for state plus action routing. It matches a single-writer Pinia architecture.

Its calls have at-least-once failover semantics. The plugin must add operation identifiers and deduplication for effectful actions.

Do not use `tabcoord` as the action lock. Its message-based lock can grant concurrent holders.

`pinia-shared-state` is the closest direct Pinia package, but it only performs last-writer-wins snapshot copying. It does not solve action ordering.

`broadcast-channel` is the closest coordination package. Its Web-Locks-backed leader election can help, but Eventa already covers transport.

TinyBase is the strongest compact replacement when deterministic concurrent merge is required. Dexie is the strongest choice for a durable messages store.

For the current experiment, a custom Pinia plugin remains justified. The safest first release uses serialized commits and never replays arbitrary effectful actions.
