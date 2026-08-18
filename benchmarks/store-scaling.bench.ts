import type { DomainState } from '../src/protocol'

import { createPinia, defineStore, setActivePinia } from 'pinia'
import { afterAll, bench, describe, vi } from 'vitest'
import { createApp, ref } from 'vue'

import { createSyncedPiniaPlugin } from '../src'

const tabScenario = vi.hoisted(() => {
  type LeaderApi = Record<string, (command: unknown) => unknown>

  class MockTab extends EventTarget {
    static instanceCount = 0

    readonly id = `benchmark-participant-${++MockTab.instanceCount}`
    readonly isLeader = true
    readonly name = 'store-scaling-benchmark'
    private api: LeaderApi = {}
    private state: DomainState = { operations: [], revision: 0, storeRevisions: {}, stores: {} }

    call<Result>(method: string, command: unknown) {
      const handler = this.api[method]
      if (!handler)
        return Promise.reject(new Error(`Unknown mocked leader method: ${method}`))

      return Promise.resolve(handler(command) as Result)
    }

    close() {}

    getState() {
      return this.state
    }

    hasLeader() {
      return Promise.resolve(false)
    }

    send() {}

    setState(state: DomainState) {
      const deliveredState = structuredClone(state)
      this.state = deliveredState
      this.dispatchEvent(new MessageEvent('state', { data: deliveredState }))
    }

    waitForLeadership(onLeadership: () => LeaderApi) {
      this.api = onLeadership()
      return new Promise<boolean>(() => {})
    }
  }

  return { MockTab }
})

vi.mock('tab-election', () => ({ Tab: tabScenario.MockTab }))

const disposals: Array<() => void> = []

function createScenario(storeCount: number, recordsPerStore: number) {
  const synced = createSyncedPiniaPlugin({
    commandHistoryLimit: 128,
    namespace: `benchmark:${storeCount}:${recordsPerStore}`,
  })
  disposals.push(synced.dispose)

  const pinia = createPinia()
  pinia.use(synced.plugin)
  createApp({}).use(pinia)
  setActivePinia(pinia)

  const stores = Array.from({ length: storeCount }, (_value, storeIndex) => {
    const useStore = defineStore(`benchmark-${storeCount}-${recordsPerStore}-${storeIndex}`, () => {
      const count = ref(0)
      const records = ref(
        Array.from({ length: recordsPerStore }, (_entry, recordIndex) => ({
          enabled: recordIndex % 2 === 0,
          id: `${storeIndex}:${recordIndex}`,
          label: `benchmark record ${recordIndex}`,
        })),
      )

      async function increment() {
        count.value += 1
        return count.value
      }

      async function incrementMany(times: number) {
        for (let index = 0; index < times; index += 1)
          count.value += 1
        return count.value
      }

      async function noChange() {
        return count.value
      }

      return { count, increment, incrementMany, noChange, records }
    }, {
      synced: {
        actions: ['increment', 'incrementMany', 'noChange'],
        state: true,
      },
    })

    return useStore()
  })

  return stores
}

afterAll(() => {
  for (const dispose of disposals)
    dispose()
})

describe('routed action scaling (100 records per store, one cloned delivery)', () => {
  for (const storeCount of [1, 10, 50]) {
    const stores = createScenario(storeCount, 100)
    const store = stores[0]!

    bench(`${storeCount} stores: action without mutation`, async () => {
      await store.noChange()
    }, { time: 750, warmupTime: 100 })

    bench(`${storeCount} stores: action with one mutation`, async () => {
      await store.increment()
    }, { time: 750, warmupTime: 100 })

    if (storeCount === 10) {
      bench('10 stores: action with 100 mutations in one store', async () => {
        await store.incrementMany(100)
      }, { time: 750, warmupTime: 100 })

      bench('10 stores: concurrent mutating action in every store', async () => {
        await Promise.all(stores.map(item => item.increment()))
      }, { time: 1500, warmupTime: 100 })
    }
  }
})
