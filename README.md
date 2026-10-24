# pinia-plugin-synced

Synchronize selected Pinia stores and actions across same-origin tabs, windows, and iframes. One context is elected as the leader: actions run there, and committed state is replicated to every participating Pinia.

[Playground](https://pinia-synced.ayaka.io)

## Install

```bash
pnpm add pinia-plugin-synced pinia vue
```

## Usage

Create one runtime for each Pinia. Use the same namespace in every context that should synchronize:

```ts
// main.ts
import { createPinia, defineStore } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { ref } from 'vue'

const pinia = createPinia()
const synced = createSyncedPiniaPlugin({
  // You can use leadership to control and specify the role / behavior of the runtime.
  // By default it's `follower-preferred`, which means no stealing, no takeover, if no leader is present, it will be leader
  // Or otherwise, `leader-only` to take leadership once when the runtime joins, or `follower-only` to never become leader.
  //
  // leadership: 'follower-preferred', <- if not specified, defaults to 'follower-preferred'
  namespace: 'my-app:messages',
})

pinia.use(synced.plugin)

// stores/messages.ts
export const useMessagesStore = defineStore('messages', () => {
  const messages = ref<string[]>([])

  async function send(message: string) {
    messages.value.push(message)
  }

  return { messages, send }
}, {
  synced: {
    actions: ['send'],
    state: true,
  },
})
```

Calling `send()` in any context returns a Promise and executes the action in the elected leader. Direct mutations and `$patch()` calls are sent to the leader as full-state proposals.

### Leadership modes

`leadership` option controls which role the runtime takes when joins.

| Mode | Behavior |
| --- | --- |
| `follower-preferred` | Default. If a leader is present, it follows. If no leader is present, it becomes the leader. |
| `follower-only` | Never becomes leader. If no leader would ever be present, this runtime remains a follower and does not take leadership. |
| `leader-only` | Becomes leader once when joins. If a leader is already present, it remains a follower and does not take leadership. |

> [!WARNING]
>
> `leader-only` takeover is a best-effort failover, not a transactional handoff: it does not cancel actions or external side effects already executing in the previous leader. If the current committed state cannot be received within `callTimeout`, the runtime reports the error through `onError`, remains a follower, and does not retry the forced takeover.

### Route actions by role

Some actions can only run in a context that has a resource, for example a page that plays audio or owns a canvas. Give such a context a role, and route the action to the role:

```ts
export const useChatStore = defineStore('chat', () => {
  // ...
}, {
  synced: {
    actions: {
      clear: {}, // runs in the leader
      send: { roles: ['speech-player'] }, // runs in a context that holds the role
    },
  },
})
```

```ts
// In the component that owns the resource
onMounted(() => {
  const release = synced.addRole('speech-player')
  onUnmounted(release)
})
```

- A context can hold several roles, and several contexts can hold the same role. Roles change at runtime.
- The leader routes each call. When the action lists roles, a live context that holds every listed role runs it.
  - The leader runs it when the leader holds the roles.
  - Otherwise, the caller runs it when the caller holds the roles.
  - Otherwise, the first other holder by participant ID runs it.
- When no context holds the roles, `fallback: 'leader'` (default) runs the action in the leader. `fallback: 'reject'` rejects the call.
- The leader still commits state. A routed action proposes its mutations to the leader, and its result is recorded after them. While a store has unacknowledged proposals, the executing context keeps its local state of that store.
- `addRole` returns a release function. The context holds a role until every claim of it is released.

> [!NOTE]
>
> When the context that runs a routed action leaves, the call rejects. The action is not retried in another context.

### Resource cleanup

Dispose the runtime when its owning page or window ends:

```ts
synced.dispose()
```

## Constraints

- Everything should be `async`: Synchronized actions are asynchronous.
- State changes and completed action records queued before the next commit task are committed together. Only the latest state of each dirty store is serialized. Per-store revisions prevent an unchanged store from being patched again when another store or only the action history changed.
- State snapshots use `structuredClone` by default, so values such as `Map`, `Set`, and `Date` keep their types across contexts. Custom `serialize` and `deserialize` functions can replace the default when an application needs another state format.
- Serialized state, action arguments, and action results must support `structuredClone` because the transport uses structured cloning.
- We do not offer CRDT merging: direct state proposals use last-arriving-wins semantics. This package does not provide CRDT merging.
- We do not guarantee application-level idempotency: action RPCs stay deduplicated for the full RPC timeout, but external side effects still need idempotency keys.
- We do not persist data: synced plugin is not [`pinia-plugin-persistedstate`], all states will be lost once every tabs/windows/iframes closes. If you need persistence, use it with another plugin.
- Keep Pinia single: synced plugin belongs to exactly one Pinia. Every context that may become leader must instantiate the synchronized stores it serves.

Use a backend, SharedWorker, or another durable owner when state must cross origins, synchronize across devices, or survive after every browser context closes.
If needed, consider linking them with the API [`linkChannel` offered by `eventa`](https://github.com/moeru-ai/eventa#channels)

## Runtime API

```ts
synced.participantId // unique ID of this runtime
synced.isLeader() // true if this runtime is the elected leader
synced.getLeaderId() // unique ID of the elected leader runtime
synced.getParticipantCount() // number of runtimes in the synchronization domain
synced.getParticipants() // live runtimes and their roles, sorted by ID
synced.addRole('speech-player') // adds a role, returns a release function
synced.getRoles() // roles of this runtime
```

## Use with `pinia-plugin-persistedstate`

```ts
// main.ts
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

import { createPinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'

const pinia = createPinia()

const synced = createSyncedPiniaPlugin({
  namespace: 'my-app:messages',
})

// Order matters
pinia.use(piniaPluginPersistedstate)
pinia.use(synced.plugin)

// stores/messages.ts
export const useMessagesStore = defineStore('messages', () => {
  const messages = ref<string[]>([])

  async function send(message: string) {
    messages.value.push(message)
  }

  return { messages, send }
}, {
  persist: true,
  synced: {
    actions: ['send'],
    state: true,
  },
})
```

## Development

```bash
pnpm install
pnpm test
pnpm build
pnpm --dir playground dev
```

## License

MIT
