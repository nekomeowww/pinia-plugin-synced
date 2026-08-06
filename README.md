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

Dispose the runtime when its owning page or window ends:

```ts
synced.dispose()
```

## Constraints

- Everything should be `async`: Synchronized actions are asynchronous.
- Everything uses JSON by default, but custom `serialize` and `deserialize` functions can replace it.
- Everything returned should support `structuredClone`: Arguments and return values must support structured cloning.
- We do not offer CRDT merging: direct state proposals use last-arriving-wins semantics. This package does not provide CRDT merging.
- We do not guarantee application-level idempotency: action RPCs stay deduplicated for the full RPC timeout, but external side effects still need idempotency keys.
- We do not persist data: synced plugin is not [`pinia-plugin-persistedstate`], all states will be lost once every tabs/windows/iframes closes. If you need persistence, use it with another plugin.
- Keep Pinia single: synced plugin belongs to exactly one Pinia. Every context that may become leader must instantiate the synchronized stores it serves.

Use a backend, SharedWorker, or another durable owner when state must cross origins, synchronize across devices, or survive after every browser context closes.
If needed, consider linking them with the API [`linkChannel` offered by `eventa`](https://github.com/moeru-ai/eventa#channels)

## Runtime API

```ts
synced.instanceId // unique ID of this runtime
synced.isLeader() // true if this runtime is the elected leader
synced.getLeaderId() // unique ID of the elected leader runtime
synced.getCandidateCount() // number of runtimes that have joined the election
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
