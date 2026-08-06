## Getting started

Create one synchronization runtime for each Pinia instance. Every browser context that uses the same `namespace` joins the same synchronization domain.

```ts
import { createPinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { createApp } from 'vue'

import App from './App.vue'

const app = createApp(App)
const pinia = createPinia()
const synced = createSyncedPiniaPlugin({
  namespace: 'my-app:messages',
})

pinia.use(synced.plugin)
app.use(pinia)
```

Opt each shared store in through its Pinia options. State synchronization is enabled by default; list the asynchronous actions that must execute in the leader.

```ts
import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

export const useMessagesStore = defineStore('messages', () => {
  const messages = shallowRef<string[]>([])

  async function send(message: string) {
    messages.value = [...messages.value, message]
    return messages.value.length
  }

  return { messages, send }
}, {
  synced: {
    actions: ['send'],
    state: true,
  },
})
```

Dispose the runtime when its page lifecycle ends. This releases its election participant and rejects pending calls owned by that context.

```ts
window.addEventListener('pagehide', () => {
  synced.dispose()
}, { once: true })
```

This example treats `pagehide` as the end of the synchronization runtime, including when the page enters the back/forward cache. An application that restores pages from that cache must create a new runtime and Pinia instance as part of its own restore lifecycle.
