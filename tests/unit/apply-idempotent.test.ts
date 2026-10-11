import type { DomainState } from '../../src/protocol'

import { createPinia, defineStore, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, ref } from 'vue'

import { createSyncedPiniaPlugin } from '../../src'

const tabScenario = vi.hoisted(() => {
  class MockTab extends EventTarget {
    static initialState: unknown = { operations: [], revision: 0, stores: {} }

    static instances: MockTab[] = []

    static isLeader = false

    readonly id = `unit-participant-${MockTab.instances.length + 1}`

    isLeader: boolean

    readonly name = 'unit-test'

    private state: unknown

    constructor() {
      super()
      this.isLeader = MockTab.isLeader
      this.state = MockTab.initialState
      MockTab.instances.push(this)
    }

    call<Result>() {
      return Promise.reject<Result>(new Error('The unit test does not exercise RPC calls.'))
    }

    close() {}

    getState() {
      return this.state
    }

    send() {}

    setState(state: unknown) {
      this.state = state
    }

    async waitForLeadership() {
      return new Promise<boolean>(() => {})
    }
  }

  return { MockTab }
})

vi.mock('tab-election', () => ({ Tab: tabScenario.MockTab }))

function createCounterStore() {
  return defineStore('counter', () => {
    const count = ref(0)
    return { count }
  }, {
    synced: { state: true },
  })
}

/** Delivers one leader snapshot the way tab-election does. */
function publish(tab: InstanceType<typeof tabScenario.MockTab>, count: number, revision: number) {
  const state: DomainState = {
    operations: [],
    revision,
    storeRevisions: { counter: revision },
    stores: { counter: { count } },
  }

  tab.dispatchEvent(new MessageEvent('state', { data: state }))
}

// ROOT CAUSE:
//
// A follower applies the leader's first snapshot after the election, and that
// snapshot can equal the state the follower already holds. The apply changes
// nothing, but pinia notifies subscribers on every `$patch`, so a subscriber
// counted a change that did not happen. The same thing happens for a repeated
// snapshot on a newer revision.
describe('applying a leader snapshot', () => {
  beforeEach(() => {
    tabScenario.MockTab.initialState = { operations: [], revision: 0, stores: {} }
    tabScenario.MockTab.instances.length = 0
    tabScenario.MockTab.isLeader = false
  })

  it('notifies a subscriber only when the snapshot changes the state', () => {
    const synced = createSyncedPiniaPlugin({ namespace: 'unit:apply-idempotent' })

    try {
      const pinia = createPinia()
      pinia.use(synced.plugin)
      createApp({}).use(pinia)
      setActivePinia(pinia)
      const store = createCounterStore()()
      const tab = tabScenario.MockTab.instances[0]!

      const notifications: number[] = []
      store.$subscribe((_mutation, state) => notifications.push(state.count), { flush: 'sync' })

      // The baseline, which holds the value the follower already has.
      publish(tab, 0, 1)
      expect(notifications).toEqual([])

      // A real change notifies once.
      publish(tab, 1, 2)
      expect(notifications).toEqual([1])

      // The same value again, on a newer revision, notifies nobody.
      publish(tab, 1, 3)
      expect(notifications).toEqual([1])

      expect(store.count).toBe(1)
    }
    finally {
      synced.dispose()
    }
  })

  it('applies a snapshot that differs in one key', () => {
    const synced = createSyncedPiniaPlugin({ namespace: 'unit:apply-differs' })

    try {
      const pinia = createPinia()
      pinia.use(synced.plugin)
      createApp({}).use(pinia)
      setActivePinia(pinia)
      const store = createCounterStore()()
      const tab = tabScenario.MockTab.instances[0]!

      publish(tab, 7, 1)

      expect(store.count).toBe(7)
    }
    finally {
      synced.dispose()
    }
  })
})
