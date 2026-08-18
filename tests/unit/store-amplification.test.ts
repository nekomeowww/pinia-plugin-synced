import type { DomainState } from '../../src/protocol'

import { createPinia, defineStore, MutationType, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, ref } from 'vue'

import { createSyncedPiniaPlugin } from '../../src'

const tabScenario = vi.hoisted(() => {
  type LeaderApi = Record<string, (command: unknown) => unknown>

  class MockTab extends EventTarget {
    static instances: MockTab[] = []

    readonly id = `amplification-participant-${MockTab.instances.length + 1}`
    readonly isLeader = true
    readonly name = 'amplification-test'
    setStateCount = 0
    private api: LeaderApi = {}
    private state: DomainState = { operations: [], revision: 0, storeRevisions: {}, stores: {} }

    constructor() {
      super()
      MockTab.instances.push(this)
    }

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
      this.setStateCount += 1
      this.state = state
      this.dispatchEvent(new MessageEvent('state', { data: state }))
    }

    waitForLeadership(onLeadership: () => LeaderApi) {
      this.api = onLeadership()
      return new Promise<boolean>(() => {})
    }
  }

  return { MockTab }
})

vi.mock('tab-election', () => ({ Tab: tabScenario.MockTab }))

interface ScenarioStats {
  actionBodies: number
  appliedStorePatches: number
  serializedStores: number
}

function createScenario(storeCount: number) {
  const stats: ScenarioStats = { actionBodies: 0, appliedStorePatches: 0, serializedStores: 0 }
  const synced = createSyncedPiniaPlugin({
    namespace: `unit:amplification:${storeCount}`,
    serialize(state) {
      stats.serializedStores += 1
      return JSON.parse(JSON.stringify(state)) as unknown
    },
  })
  const pinia = createPinia()
  pinia.use(synced.plugin)
  createApp({}).use(pinia)
  setActivePinia(pinia)

  const stores = Array.from({ length: storeCount }, (_value, storeIndex) => {
    const useStore = defineStore(`amplification-${storeCount}-${storeIndex}`, () => {
      const count = ref(0)

      async function increment() {
        stats.actionBodies += 1
        count.value += 1
        return count.value
      }

      async function noChange() {
        stats.actionBodies += 1
        return count.value
      }

      return { count, increment, noChange }
    }, {
      synced: {
        actions: ['increment', 'noChange'],
        state: true,
      },
    })
    const store = useStore()
    store.$subscribe((mutation) => {
      if (mutation.type === MutationType.patchFunction)
        stats.appliedStorePatches += 1
    }, { flush: 'sync' })
    return store
  })

  const tab = tabScenario.MockTab.instances.at(-1)!
  tab.setStateCount = 0
  stats.actionBodies = 0
  stats.appliedStorePatches = 0
  stats.serializedStores = 0

  return { stats, stores, synced, tab }
}

describe('multi-store action amplification', () => {
  beforeEach(() => {
    tabScenario.MockTab.instances.length = 0
  })

  it('does not patch stores after an action with no state change', async () => {
    const scenario = createScenario(10)

    try {
      await scenario.stores[0]!.noChange()

      expect(scenario.stats.actionBodies).toBe(1)
      expect(scenario.tab.setStateCount).toBe(1)
      expect(scenario.stats.appliedStorePatches).toBe(0)
      expect(scenario.stats.serializedStores).toBe(0)
    }
    finally {
      scenario.synced.dispose()
    }
  })

  it('does not replay a leader mutation back into its stores', async () => {
    const scenario = createScenario(10)

    try {
      await scenario.stores[0]!.increment()

      expect(scenario.stats.actionBodies).toBe(1)
      expect(scenario.tab.setStateCount).toBe(2)
      expect(scenario.stats.appliedStorePatches).toBe(0)
      expect(scenario.stats.serializedStores).toBe(1)
    }
    finally {
      scenario.synced.dispose()
    }
  })

  it('coalesces concurrent actions without replaying their stores', async () => {
    const scenario = createScenario(10)

    try {
      await Promise.all(scenario.stores.map(store => store.increment()))

      expect(scenario.stats.actionBodies).toBe(10)
      expect(scenario.tab.setStateCount).toBe(2)
      expect(scenario.stats.appliedStorePatches).toBe(0)
      expect(scenario.stats.serializedStores).toBe(10)
    }
    finally {
      scenario.synced.dispose()
    }
  })

  it('patches only the store whose revision changed', () => {
    const scenario = createScenario(10)

    try {
      const current = scenario.tab.getState()
      const storeRevisions = Object.fromEntries(scenario.stores.map(store => [store.$id, 1]))
      const changedStore = scenario.stores[4]!

      scenario.tab.setState({
        ...current,
        revision: current.revision + 1,
        storeRevisions: { ...storeRevisions, [changedStore.$id]: 2 },
        stores: { ...current.stores, [changedStore.$id]: { count: 42 } },
      })

      expect(changedStore.count).toBe(42)
      expect(scenario.stats.appliedStorePatches).toBe(1)

      scenario.stats.appliedStorePatches = 0
      const operationOnlyState = scenario.tab.getState()
      scenario.tab.setState({
        ...operationOnlyState,
        operations: [],
        revision: operationOnlyState.revision + 1,
      })

      expect(scenario.stats.appliedStorePatches).toBe(0)
    }
    finally {
      scenario.synced.dispose()
    }
  })
})
