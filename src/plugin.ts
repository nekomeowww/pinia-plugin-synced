import type { Pinia, PiniaPlugin, StateTree, StoreGeneric } from 'pinia'

import type { ActionCommand as ActionCommand, CoordinationMessage as CoordinationMessage, DomainState as DomainState, OperationRecord as OperationRecord, StateCommand as StateCommand } from './protocol'
import type { SyncedOptions, SyncedStoreOptions } from './types'

import { merge, toError } from '@moeru/std'
import { noop } from 'es-toolkit'
import { Tab } from 'tab-election'
import { onScopeDispose, toRaw } from 'vue'

interface HotStoreBoundary {
  _hotUpdate?: (newStore: StoreGeneric) => void
}

interface LeaderApi {
  invokeAction: (command: ActionCommand) => Promise<unknown>
  publishInitialState: (command: StateCommand) => void
  replaceState: (command: StateCommand) => void
}

interface PendingCall {
  reject: (error: Error) => void
}

type ResolvedSyncedPiniaPluginOptions = Required<SyncedOptions>

type StoreAction = (...args: unknown[]) => unknown

interface StoreRegistration {
  actionWrappers: Map<string, StoreAction>
  active: boolean
  applyingState: number
  options: Required<SyncedStoreOptions>
  originalActions: Map<string, StoreAction>
  restoreHotUpdate?: () => void
  stopSubscription?: () => void
  store: StoreGeneric
}

/** Runtime defaults applied before validating and starting the synchronization domain. */
const defaultOptions: ResolvedSyncedPiniaPluginOptions = {
  callTimeout: 30_000,
  candidateHeartbeatInterval: 15_000,
  candidateTimeout: 120_000,
  commandHistoryLimit: 128,
  deserialize(state): StateTree {
    if (!state || typeof state !== 'object' || Array.isArray(state))
      throw new TypeError('A synchronized Pinia state must deserialize to an object.')

    return state as StateTree
  },
  namespace: 'pinia-plugin-synced',
  onError: noop,
  serialize: state => JSON.parse(JSON.stringify(state)) as unknown,
}

/** Coordination information observed by one synchronization runtime. */
export interface SyncedPiniaCoordination {
  /** Number of live election candidates, including the leader. */
  candidateCount: number
  /** Current leader's tab-election participant ID, or undefined while electing. */
  leaderId: string | undefined
}

/** Owns one Pinia plugin and the tab-election lifecycle for one synchronization domain. */
export interface SyncedPiniaRuntime {
  /**
   * Stops new routes, rejects locally pending RPC callers, and releases transport ownership.
   * An action already executing in another tab cannot be canceled generically.
   */
  dispose: () => void
  /** Returns the number of recently observed election candidates, including the leader. */
  getCandidateCount: () => number
  /** Returns the current leader's participant ID, or undefined while electing. */
  getLeaderId: () => string | undefined
  /** Current tab-election participant ID. */
  instanceId: string
  /** Reports whether this web context currently owns the synchronization domain. */
  isLeader: () => boolean
  /** Subscribes to leader identity and candidate-presence changes. */
  onCoordinationChange: (listener: (coordination: SyncedPiniaCoordination) => void) => () => void
  /** Subscribes to leader-role changes for diagnostics and UI. */
  onLeadershipChange: (listener: (isLeader: boolean) => void) => () => void
  /** Install this plugin on exactly one Pinia instance. */
  plugin: PiniaPlugin
}

/**
 * Creates a leader-authoritative Pinia synchronization runtime.
 *
 * Registered actions become asynchronous RPC calls and execute only in the
 * elected leader's Pinia. Direct mutations are full-state proposals that the
 * leader applies and republishes. Every tab that can become leader must create
 * each opted-in store before callers invoke its registered actions.
 */
export function createSyncedPiniaPlugin(
  options: SyncedOptions = {},
): SyncedPiniaRuntime {
  const resolvedOptions = merge(defaultOptions, options)
  if (!Number.isSafeInteger(resolvedOptions.commandHistoryLimit) || resolvedOptions.commandHistoryLimit < 1)
    throw new RangeError('commandHistoryLimit must be a positive safe integer.')
  if (!Number.isSafeInteger(resolvedOptions.candidateHeartbeatInterval) || resolvedOptions.candidateHeartbeatInterval < 1)
    throw new RangeError('candidateHeartbeatInterval must be a positive safe integer.')
  if (!Number.isSafeInteger(resolvedOptions.candidateTimeout) || resolvedOptions.candidateTimeout <= resolvedOptions.candidateHeartbeatInterval)
    throw new RangeError('candidateTimeout must be a safe integer greater than candidateHeartbeatInterval.')

  const tab = new Tab<DomainState>(resolvedOptions.namespace, { callTimeout: resolvedOptions.callTimeout })
  const registrations = new Map<string, StoreRegistration>()
  const inFlightActions = new Map<string, Promise<unknown>>()
  const coordinationListeners = new Set<(coordination: SyncedPiniaCoordination) => void>()
  const candidateLastSeen = new Map([[tab.id, Date.now()]])
  const leadershipListeners = new Set<(isLeader: boolean) => void>()
  const pendingCalls = new Set<PendingCall>()
  let disposed = false
  let leaderId: string | undefined
  let ownerPinia: Pinia | undefined

  function notifyCoordinationChange() {
    const coordination = { candidateCount: candidateLastSeen.size, leaderId }
    for (const listener of coordinationListeners)
      listener(coordination)
  }

  function snapshotRegisteredStores(base: DomainState['stores']) {
    const stores = { ...base }
    for (const registration of registrations.values()) {
      if (!registration.active || !registration.options.state)
        continue

      stores[registration.store.$id] = resolvedOptions.serialize(registration.store.$state)
    }

    return stores
  }

  function commitState(operation?: OperationRecord) {
    if (disposed || !tab.isLeader)
      return

    const current = normalizeDomainState(tab.getState())
    const operations = operation
      ? [
          ...current.operations.filter(item => item.id !== operation.id),
          operation,
        ].slice(-resolvedOptions.commandHistoryLimit)
      : current.operations

    tab.setState({
      operations,
      revision: current.revision + 1,
      stores: snapshotRegisteredStores(current.stores),
    })
  }

  function applyStoreState(registration: StoreRegistration, serializedState: unknown) {
    let state: StateTree
    try {
      state = resolvedOptions.deserialize(serializedState)
    }
    catch (error) {
      console.error(`[${resolvedOptions.namespace}]`, error)
      resolvedOptions.onError(error)

      return
    }

    registration.applyingState += 1
    try {
      registration.store.$patch((currentState) => {
        for (const key of Object.keys(currentState)) {
          if (!(key in state))
            delete currentState[key]
        }

        Object.assign(currentState, state)
      })
    }
    finally {
      registration.applyingState -= 1
    }
  }

  function applyDomainState(state: unknown) {
    const domainState = normalizeDomainState(state)
    for (const registration of registrations.values()) {
      if (!registration.options.state)
        continue

      if (registration.store.$id in domainState.stores)
        applyStoreState(registration, domainState.stores[registration.store.$id])
    }
  }

  async function executeAction(command: ActionCommand) {
    const recorded = normalizeDomainState(tab.getState()).operations.find(operation => operation.id === command.operationId)
    if (recorded) {
      if (recorded.outcome === 'rejected')
        throw toError(recorded.error)

      return recorded.result
    }

    const pending = inFlightActions.get(command.operationId)
    if (pending) {
      return pending
    }

    const registration = registrations.get(command.storeId)
    const action = registration?.originalActions.get(command.actionName)
    if (!registration?.active || !action) {
      throw new Error(`Store "${command.storeId}" does not expose synced action "${command.actionName}" in the leader.`)
    }

    const execution = Promise.resolve()
      .then(() => action.apply(registration.store, command.args))
      .then(
        (result) => {
          const clonedResult = structuredClone(result)
          commitState({ id: command.operationId, outcome: 'fulfilled', result: clonedResult })
          return clonedResult
        },
        (error: unknown) => {
          const operationError = toError(error)
          commitState({ error: { message: operationError.message, name: operationError.name }, id: command.operationId, outcome: 'rejected' })
          throw operationError
        },
      )
      .finally(() => {
        inFlightActions.delete(command.operationId)
      })

    inFlightActions.set(command.operationId, execution)
    return execution
  }

  function publishInitialState(command: StateCommand) {
    const current = normalizeDomainState(tab.getState())
    if (command.storeId in current.stores)
      return

    tab.setState({
      ...current,
      revision: current.revision + 1,
      stores: { ...current.stores, [command.storeId]: command.state },
    })
  }

  function replaceState(command: StateCommand) {
    const registration = registrations.get(command.storeId)
    if (registration?.active)
      applyStoreState(registration, command.state)

    const current = normalizeDomainState(tab.getState())
    tab.setState({
      ...current,
      revision: current.revision + 1,
      stores: { ...snapshotRegisteredStores(current.stores), [command.storeId]: command.state },
    })
  }

  const leaderApi: LeaderApi = {
    invokeAction: executeAction,
    publishInitialState,
    replaceState,
  }

  const handleState = (event: Event) => {
    if (!(event instanceof MessageEvent))
      return

    applyDomainState(event.data)
  }

  const handleCoordinationMessage = (event: Event) => {
    if (!(event instanceof MessageEvent) || !event.data || typeof event.data !== 'object')
      return

    const message = event.data as Partial<CoordinationMessage>
    if (message.type === 'leader-present' && typeof message.leaderId === 'string') {
      const countBefore = candidateLastSeen.size
      candidateLastSeen.set(message.leaderId, Date.now())
      const changed = leaderId !== message.leaderId || countBefore !== candidateLastSeen.size
      leaderId = message.leaderId
      if (changed)
        notifyCoordinationChange()
      return
    }

    if (!('candidateId' in message) || typeof message.candidateId !== 'string')
      return

    if (message.type === 'candidate-leave') {
      const changed = candidateLastSeen.delete(message.candidateId)
      if (leaderId === message.candidateId)
        leaderId = undefined
      if (changed)
        notifyCoordinationChange()
      return
    }

    if (message.type !== 'candidate-heartbeat' && message.type !== 'candidate-hello' && message.type !== 'candidate-present')
      return

    const countBefore = candidateLastSeen.size
    candidateLastSeen.set(message.candidateId, Date.now())
    if (countBefore !== candidateLastSeen.size)
      notifyCoordinationChange()

    if (message.type === 'candidate-hello') {
      tab.send({ candidateId: tab.id, type: 'candidate-present' } satisfies CoordinationMessage, message.candidateId)
      if (tab.isLeader)
        tab.send({ leaderId: tab.id, type: 'leader-present' } satisfies CoordinationMessage, message.candidateId)
    }
  }

  const handleLeadershipChange = () => {
    if (tab.isLeader) {
      leaderId = tab.id
      candidateLastSeen.set(tab.id, Date.now())
      tab.send({ leaderId: tab.id, type: 'leader-present' } satisfies CoordinationMessage)
    }
    else if (leaderId === tab.id) {
      leaderId = undefined
    }

    for (const listener of leadershipListeners)
      listener(tab.isLeader)
    notifyCoordinationChange()
  }

  tab.addEventListener('state', handleState)
  tab.addEventListener('message', handleCoordinationMessage)
  tab.addEventListener('leadershipchange', handleLeadershipChange)

  tab.waitForLeadership(() => {
    applyDomainState(tab.getState())
    return leaderApi
  }).catch((error) => {
    console.error(`[${resolvedOptions.namespace}]`, error)
    resolvedOptions.onError(error)
  })

  tab.send({ candidateId: tab.id, type: 'candidate-hello' } satisfies CoordinationMessage)
  const heartbeatTimer = setInterval(() => {
    const now = Date.now()
    let changed = false
    candidateLastSeen.set(tab.id, now)
    for (const [candidateId, lastSeen] of candidateLastSeen) {
      if (candidateId !== tab.id && now - lastSeen > resolvedOptions.candidateTimeout) {
        candidateLastSeen.delete(candidateId)
        if (leaderId === candidateId)
          leaderId = undefined
        changed = true
      }
    }
    if (changed)
      notifyCoordinationChange()

    tab.send({ candidateId: tab.id, type: 'candidate-heartbeat' } satisfies CoordinationMessage)
  }, resolvedOptions.candidateHeartbeatInterval)

  function invokeLeader<Result>(method: keyof LeaderApi, command: ActionCommand | StateCommand) {
    if (disposed)
      return Promise.reject(new Error('Pinia sync runtime is disposed.'))

    return new Promise<Result>((resolve, reject) => {
      const pending: PendingCall = { reject }
      pendingCalls.add(pending)

      const settle = (callback: () => void) => {
        if (!pendingCalls.delete(pending))
          return
        callback()
      }

      tab.call<Result>(method, command).then(
        result => settle(() => resolve(result)),
        error => settle(() => reject(error)),
      )
    })
  }

  function installActionWrappers(registration: StoreRegistration) {
    for (const actionName of registration.options.actions) {
      const value: unknown = registration.store[actionName]
      if (typeof value !== 'function')
        throw new TypeError(`Store "${registration.store.$id}" does not expose action "${actionName}".`)

      const original = value as StoreAction
      const wrapper: StoreAction = (...args) => {
        if (!registration.active || disposed)
          return original.apply(registration.store, args)

        return invokeLeader('invokeAction', {
          actionName,
          args,
          operationId: crypto.randomUUID(),
          storeId: registration.store.$id,
        })
      }

      registration.originalActions.set(actionName, original)
      registration.actionWrappers.set(actionName, wrapper)
      registration.store[actionName] = wrapper
    }
  }

  function installHotUpdateBoundary(registration: StoreRegistration) {
    const rawStore = toRaw(registration.store) as HotStoreBoundary & StoreGeneric
    const originalHotUpdate = rawStore._hotUpdate
    if (!originalHotUpdate)
      return

    const wrappedHotUpdate = function (this: StoreGeneric, newStore: StoreGeneric) {
      originalHotUpdate.call(this, newStore)
      installActionWrappers(registration)
    }

    rawStore._hotUpdate = wrappedHotUpdate

    registration.restoreHotUpdate = () => {
      if (rawStore._hotUpdate === wrappedHotUpdate)
        rawStore._hotUpdate = originalHotUpdate
    }
  }

  function registerStore(store: StoreGeneric, storeOptions: Required<SyncedStoreOptions>) {
    const registration: StoreRegistration = {
      actionWrappers: new Map(),
      active: true,
      applyingState: 0,
      options: storeOptions,
      originalActions: new Map(),
      store,
    }

    registrations.set(store.$id, registration)
    installActionWrappers(registration)
    installHotUpdateBoundary(registration)

    const domainState = normalizeDomainState(tab.getState())
    if (store.$id in domainState.stores) {
      applyStoreState(registration, domainState.stores[store.$id])
    }
    else if (tab.isLeader) {
      commitState()
    }
    else {
      try {
        invokeLeader('publishInitialState', {
          state: resolvedOptions.serialize(store.$state),
          storeId: store.$id,
        }).catch((error) => {
          console.error(`[${resolvedOptions.namespace}]`, error)
          resolvedOptions.onError(error)
        })
      }
      catch (error) {
        console.error(`[${resolvedOptions.namespace}]`, error)
        resolvedOptions.onError(error)
      }
    }

    if (storeOptions.state) {
      registration.stopSubscription = store.$subscribe((_mutation, state) => {
        if (!registration.active || registration.applyingState > 0)
          return

        let serializedState: unknown
        try {
          serializedState = resolvedOptions.serialize(state)
        }
        catch (error) {
          console.error(`[${resolvedOptions.namespace}]`, error)
          resolvedOptions.onError(error)
          return
        }

        if (tab.isLeader) {
          commitState()
          return
        }

        invokeLeader('replaceState', {
          state: serializedState,
          storeId: store.$id,
        }).catch((error) => {
          console.error(`[${resolvedOptions.namespace}]`, error)
          resolvedOptions.onError(error)
          applyDomainState(tab.getState())
        })
      }, { flush: 'sync' })
    }

    onScopeDispose(() => unregisterStore(registration))
  }

  function unregisterStore(registration: StoreRegistration) {
    if (!registration.active)
      return

    registration.active = false

    if (registrations.get(registration.store.$id) === registration)
      registrations.delete(registration.store.$id)

    registration.stopSubscription?.()
    registration.restoreHotUpdate?.()

    for (const [actionName, wrapper] of registration.actionWrappers) {
      if (registration.store[actionName] === wrapper)
        registration.store[actionName] = registration.originalActions.get(actionName)
    }
  }

  const plugin: PiniaPlugin = ({ options: storeDefinition, pinia, store }) => {
    if (disposed)
      throw new Error('Cannot register a store on a disposed Pinia sync runtime.')

    if (ownerPinia && ownerPinia !== pinia)
      throw new Error('A Pinia sync runtime can only be installed on one Pinia instance.')

    ownerPinia = pinia
    if (store.$id.startsWith('__hot:') || !storeDefinition.synced)
      return

    const configured = storeDefinition.synced === true ? {} : storeDefinition.synced

    registerStore(store, {
      actions: configured.actions ?? [],
      state: configured.state ?? true,
    })
  }

  return {
    dispose() {
      if (disposed)
        return

      disposed = true

      tab.send({ candidateId: tab.id, type: 'candidate-leave' } satisfies CoordinationMessage)
      clearInterval(heartbeatTimer)

      tab.removeEventListener('state', handleState)
      tab.removeEventListener('message', handleCoordinationMessage)
      tab.removeEventListener('leadershipchange', handleLeadershipChange)

      for (const registration of [...registrations.values()])
        unregisterStore(registration)

      coordinationListeners.clear()
      leadershipListeners.clear()
      inFlightActions.clear()

      const disposalError = new Error('Pinia sync runtime was disposed before the RPC completed.')

      for (const pending of pendingCalls)
        pending.reject(disposalError)

      pendingCalls.clear()
      tab.close()
    },
    getCandidateCount: () => candidateLastSeen.size,
    getLeaderId: () => leaderId,
    instanceId: tab.id,
    isLeader: () => tab.isLeader,
    onCoordinationChange(listener) {
      if (disposed)
        return noop

      coordinationListeners.add(listener)
      listener({ candidateCount: candidateLastSeen.size, leaderId })

      return () => coordinationListeners.delete(listener)
    },
    onLeadershipChange(listener) {
      if (disposed)
        return noop

      leadershipListeners.add(listener)
      listener(tab.isLeader)

      return () => leadershipListeners.delete(listener)
    },
    plugin,
  }
}

function normalizeDomainState(state: unknown): DomainState {
  if (!state || typeof state !== 'object' || Array.isArray(state))
    return { operations: [], revision: 0, stores: {} }

  const candidate = state as Partial<DomainState>
  return {
    operations: Array.isArray(candidate.operations) ? candidate.operations : [],
    revision: Number.isSafeInteger(candidate.revision) && (candidate.revision ?? 0) >= 0
      ? candidate.revision ?? 0
      : 0,
    stores: candidate.stores && typeof candidate.stores === 'object' && !Array.isArray(candidate.stores)
      ? candidate.stores
      : {},
  }
}
