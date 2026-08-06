# pinia-plugin-synced

An experimental Pinia plugin that synchronizes explicitly opted-in stores and actions across same-origin tabs. It uses `tab-election` to elect one authoritative Pinia, route actions to it, and replicate committed state to every participating tab.

## Install

```bash
pnpm add pinia-plugin-synced pinia vue
```

`tab-election` is installed as a runtime dependency.

## Create one synchronization domain

Each web context creates its own Pinia and runtime with the same namespace:

```ts
import { createPinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'

const pinia = createPinia()
const synced = createSyncedPiniaPlugin({
  namespace: 'my-app:messages',
})

pinia.use(synced.plugin)
```

The runtime owns its `tab-election` participant, Web Lock, and BroadcastChannel. Install it on exactly one Pinia and call `synced.dispose()` at the application lifecycle boundary.

## Opt a store in

Registered actions must be asynchronous because follower tabs call them through RPC:

```ts
export const useMessagesStore = defineStore('messages', () => {
  const messages = shallowRef<Message[]>([])

  async function appendMessage(message: Message) {
    messages.value = [...messages.value, message]
    return messages.value.length
  }

  return { appendMessage, messages }
}, {
  synced: {
    actions: ['appendMessage'],
    state: true,
  },
})
```

An action called in any tab executes against the elected leader's store. Its result or error returns to the caller, while leader snapshots update every Pinia. Direct mutations and `$patch()` calls are sent to the leader as full-state proposals. Multi-step actions publish intermediate mutations; action execution is not an atomic state transaction.

## When to use it

Use this package when:

- every same-origin tab must display one logical Pinia state;
- selected state-changing actions may be routed asynchronously to one tab;
- last-arriving direct state proposals are an acceptable conflict policy;
- every participating tab instantiates the opted-in stores it may need as leader.

## When not to use it

Do not use it when:

- actions must remain synchronous;
- concurrent field-level edits require CRDT merging;
- state must synchronize across devices or origins;
- external side effects require a universal exactly-once guarantee;
- background authority must survive after every tab closes—a SharedWorker or durable backend is a better owner.

## Delivery and failure semantics

- `tab-election` may redeliver an RPC during acknowledgement loss or leader handoff. The plugin assigns an operation ID and retains the latest 128 completed outcomes for deduplication. Configure `commandHistoryLimit` to change that bound.
- A leader crash after an external side effect but before publishing the completed operation cannot be resolved generically. Pass an application idempotency key to such a backend.
- `dispose()` immediately rejects RPC calls made by that runtime. An action that already started in the leader cannot be canceled generically and may still finish; treat disposal during an action like an uncertain leader failure.
- State uses JSON serialization by default. Provide `serialize` and `deserialize` for other structured-clone-compatible values.
- Action arguments and return values must support the structured clone algorithm.
- Mutations made before an action rejects remain committed and are replicated, matching ordinary Pinia behavior.
- State remains in participating tabs' memory. This prototype does not persist state after every tab closes.
- HMR replaces implementations of actions already in the allowlist. Changing `synced.actions` itself currently requires a full page reload.

## Runtime diagnostics

```ts
synced.instanceId
synced.isLeader()
synced.getLeaderId()
synced.getCandidateCount()

const stop = synced.onLeadershipChange((isLeader) => {
  console.info({ isLeader })
})

const stopCoordination = synced.onCoordinationChange(({ candidateCount, leaderId }) => {
  console.info({ candidateCount, leaderId })
})
```

A candidate is a live runtime in the same namespace that can become leader; the count includes the leader. Join and graceful disposal update presence immediately. Abruptly closed or crashed contexts expire after `candidateTimeout` (120 seconds by default), so candidate presence is eventually consistent. `candidateHeartbeatInterval` defaults to 15 seconds.

## Playground

```bash
pnpm install
pnpm dev
```

Open the printed URL to run a top-level Pinia beside another Pinia loaded from the playground's `iframe.html` Vite entry. Add more iframe candidates from the animated connection grid. Each compact peer shows its ID, role, action/state controls, and synchronized history indicators with source/executor tooltips. Open more tabs to add more candidates to the same synchronization domain.

## Browser integration tests

```bash
pnpm exec playwright install chromium
pnpm test
```

The tests open multiple real pages and same-origin sibling iframes in one browser context. They exercise `tab-election`, Web Locks, BroadcastChannel, leader-only action execution, direct state proposals, late-context hydration, and tab leader failover without mocking the transport library.

## Deploy the playground to Cloudflare Workers

The repository includes production and pull request preview workflows for the static playground. Configure these repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Create `Preview` and `Production` GitHub environments. Configure required reviewers on `Preview`: after approval, that job checks out and executes the pull request source with access to the Cloudflare secrets. Pushes to `main` deploy the playground to production, while pull requests receive a stable `pr-<number>` Workers preview alias and an updated PR comment.

The Worker name and static asset routing live in `playground/wrangler.toml`. Change its `name` if `pinia-plugin-synced` is unavailable in the target Cloudflare account.
