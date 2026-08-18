import type { DomainState } from '../../src/protocol'

import { createPinia, defineStore, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, isReactive, reactive, ref, shallowRef } from 'vue'

import { createSyncedPiniaPlugin } from '../../src'

const tabScenario = vi.hoisted(() => {
  class MockTab extends EventTarget {
    static initialState: unknown = {
      operations: [],
      revision: 0,
      stores: {},
    }

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
      if (!this.isLeader)
        throw new Error('Only the mocked leader can set state.')

      this.state = state
    }

    async waitForLeadership() {
      return new Promise<boolean>(() => {})
    }
  }

  return { MockTab }
})

vi.mock('tab-election', () => ({ Tab: tabScenario.MockTab }))

function createCardsStore() {
  return defineStore('cards', () => {
    const cards = shallowRef(new Map([['default', 'Default card']]))
    return { cards }
  }, {
    synced: { state: true },
  })
}

function createProviderRuntimeStore() {
  return defineStore('provider-state', () => {
    const runtime = ref<Record<string, { models: Array<{ id: string }> }>>({})
    runtime.value['official-provider'] = reactive({
      models: reactive([{ id: 'default-model' }]),
    })

    return { runtime }
  }, {
    synced: { state: true },
  })
}

function emptyDomainState(): DomainState {
  return {
    operations: [],
    revision: 0,
    storeRevisions: {},
    stores: {},
  }
}

// ROOT CAUSE:
//
// JSON serialization turns a Map into an empty object before tab-election
// transports the snapshot. These tests exercise the plugin boundary directly:
// the leader must publish a Map, and a follower must hydrate one.
describe('pinia state snapshots', () => {
  beforeEach(() => {
    tabScenario.MockTab.initialState = emptyDomainState()
    tabScenario.MockTab.instances.length = 0
    tabScenario.MockTab.isLeader = false
  })

  it('serializes a Map in the leader snapshot without reducing it to an object', () => {
    tabScenario.MockTab.isLeader = true
    const synced = createSyncedPiniaPlugin({ namespace: 'unit:serialize-map' })

    try {
      const pinia = createPinia()
      pinia.use(synced.plugin)
      createApp({}).use(pinia)
      setActivePinia(pinia)
      createCardsStore()()

      const tab = tabScenario.MockTab.instances[0]!
      const state = tab.getState() as DomainState
      const snapshot = state.stores.cards as { cards: Map<string, string> }

      expect(snapshot.cards).toBeInstanceOf(Map)
      expect(snapshot.cards.size).toBe(1)
      expect(snapshot.cards.get('default')).toBe('Default card')
    }
    finally {
      synced.dispose()
    }
  })

  it('serializes nested Vue reactive values in the leader snapshot', () => {
    tabScenario.MockTab.isLeader = true
    const synced = createSyncedPiniaPlugin({ namespace: 'unit:serialize-nested-reactive' })

    try {
      const pinia = createPinia()
      pinia.use(synced.plugin)
      createApp({}).use(pinia)
      setActivePinia(pinia)
      createProviderRuntimeStore()()

      const tab = tabScenario.MockTab.instances[0]!
      const state = tab.getState() as DomainState
      const snapshot = state.stores['provider-state'] as {
        runtime: Record<string, { models: Array<{ id: string }> }>
      }

      expect(snapshot.runtime['official-provider']?.models).toEqual([{ id: 'default-model' }])
      expect(isReactive(snapshot.runtime['official-provider'])).toBe(false)
      expect(isReactive(snapshot.runtime['official-provider']?.models)).toBe(false)
    }
    finally {
      synced.dispose()
    }
  })

  it('hydrates a received Map snapshot back into the Pinia store', () => {
    tabScenario.MockTab.initialState = {
      ...emptyDomainState(),
      stores: {
        cards: {
          cards: new Map([['remote', 'Remote card']]),
        },
      },
    }
    const synced = createSyncedPiniaPlugin({ namespace: 'unit:deserialize-map' })

    try {
      const pinia = createPinia()
      pinia.use(synced.plugin)
      createApp({}).use(pinia)
      setActivePinia(pinia)
      const store = createCardsStore()()

      expect(store.cards).toBeInstanceOf(Map)
      expect(store.cards.size).toBe(1)
      expect(store.cards.get('remote')).toBe('Remote card')
    }
    finally {
      synced.dispose()
    }
  })

  it('hydrates a legacy snapshot without per-store revisions', () => {
    tabScenario.MockTab.initialState = {
      operations: [],
      revision: 7,
      stores: {
        cards: {
          cards: new Map([['legacy', 'Legacy card']]),
        },
      },
    }
    const synced = createSyncedPiniaPlugin({ namespace: 'unit:deserialize-legacy-snapshot' })

    try {
      const pinia = createPinia()
      pinia.use(synced.plugin)
      createApp({}).use(pinia)
      setActivePinia(pinia)
      const store = createCardsStore()()

      expect(store.cards.get('legacy')).toBe('Legacy card')
    }
    finally {
      synced.dispose()
    }
  })
})
