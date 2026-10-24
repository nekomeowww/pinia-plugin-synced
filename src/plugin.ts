import type { Pinia, PiniaPlugin, StateTree, StoreGeneric } from 'pinia'

import type { ActionCommand as ActionCommand, CoordinationMessage as CoordinationMessage, DomainState as DomainState, OperationRecord as OperationRecord, RoutedOutcome, StateCommand as StateCommand } from './protocol'
import type { SyncedActionOptions, SyncedOptions, SyncedStoreOptions } from './types'

import { merge, toError } from '@moeru/std'
import { isEqual, noop } from 'es-toolkit'
import { Tab } from 'tab-election'
import { nextTick, onScopeDispose, toRaw } from 'vue'

import { leadershipModes } from './types'

interface HotStoreBoundary {
  _hotUpdate?: (newStore: StoreGeneric) => void
}

interface LeaderApi {
  invokeAction: (command: ActionCommand) => Promise<unknown>
  publishInitialState: (command: StateCommand) => Promise<void>
  replaceState: (command: StateCommand) => Promise<void>
}

interface PendingCall {
  reject: (error: Error) => void
}

interface PendingCommit {
  promise: Promise<void>
  reject: (error: unknown) => void
  resolve: () => void
}

/** An action that this leader routed to another participant and still waits for. */
interface PendingRoute {
  reject: (error: Error) => void
  resolve: (outcome: RoutedOutcome) => void
  targetId: string
  timeout: ReturnType<typeof setTimeout>
}

type ResolvedActionOptions = Required<SyncedActionOptions>

interface ResolvedStoreOptions {
  actions: Map<string, ResolvedActionOptions>
  state: boolean
}

type ResolvedSyncedPiniaPluginOptions = Required<SyncedOptions>

/** An action that this participant runs, or ran, for a leader. Kept so a re-routed request replays its outcome. */
interface RoutedExecution {
  expiresAt?: number
  outcome: Promise<RoutedOutcome>
}

type StoreAction = (...args: unknown[]) => unknown

interface StoreRegistration {
  actionWrappers: Map<string, StoreAction>
  active: boolean
  appliedRevision?: number
  applyingState: number
  /** State proposals of this store that the leader has not acknowledged yet. */
  localProposals: number
  options: ResolvedStoreOptions
  originalActions: Map<string, StoreAction>
  restoreHotUpdate?: () => void
  stopSubscription?: () => void
  store: StoreGeneric
}

function canBeStructuredCloned(value: object) {
  return value instanceof Date
    || value instanceof RegExp
    || value instanceof ArrayBuffer
    || ArrayBuffer.isView(value)
}

function deserializeState(state: unknown): StateTree {
  if (!state || typeof state !== 'object' || Array.isArray(state))
    throw new TypeError('A synchronized Pinia state must deserialize to an object.')

  return structuredClone(state) as StateTree
}

/**
 * Creates a transport snapshot without losing structured values such as Map,
 * Set, and Date. Vue reactive proxies must be unwrapped recursively before
 * cloning because a raw parent can still contain proxy-valued properties.
 */
function serializeState(state: StateTree): StateTree {
  const stateEntries = Object.keys(state).map(key => [key, unwrapReactiveValue(state[key])] as const)
  return structuredClone(Object.fromEntries(stateEntries))
}

function unwrapReactiveValue<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  const rawValue = toRaw(value)
  if (rawValue === null || typeof rawValue !== 'object')
    return rawValue

  if (seen.has(rawValue))
    return seen.get(rawValue) as T

  if (canBeStructuredCloned(rawValue))
    return rawValue

  if (rawValue instanceof Map) {
    const clone = new Map<unknown, unknown>()
    seen.set(rawValue, clone)

    for (const [key, entry] of rawValue)
      clone.set(unwrapReactiveValue(key, seen), unwrapReactiveValue(entry, seen))

    return clone as T
  }

  if (rawValue instanceof Set) {
    const clone = new Set<unknown>()
    seen.set(rawValue, clone)

    for (const entry of rawValue)
      clone.add(unwrapReactiveValue(entry, seen))

    return clone as T
  }

  if (Array.isArray(rawValue)) {
    const clone = new Array<unknown>(rawValue.length) as Record<string, unknown> & unknown[]
    seen.set(rawValue, clone)

    const source = rawValue as Record<string, unknown>
    for (const key of Object.keys(source))
      clone[key] = unwrapReactiveValue(source[key], seen)

    return clone as T
  }

  const clone = Object.create(Object.getPrototypeOf(rawValue)) as Record<string, unknown>
  seen.set(rawValue, clone)

  const source = rawValue as Record<string, unknown>
  for (const key of Object.keys(source))
    clone[key] = unwrapReactiveValue(source[key], seen)

  return clone as T
}

/** Runtime defaults applied before validating and starting the synchronization domain. */
const defaultOptions: ResolvedSyncedPiniaPluginOptions = {
  callTimeout: 30_000,
  commandHistoryLimit: 128,
  deserialize: deserializeState,
  leadership: 'follower-preferred',
  namespace: 'pinia-plugin-synced',
  onError: noop,
  participantHeartbeatInterval: 15_000,
  participantTimeout: 120_000,
  serialize: serializeState,
}

/** One live synchronization participant and the roles that it holds. */
export interface SyncedParticipant {
  id: string
  roles: string[]
}

/** Coordination information observed by one synchronization runtime. */
export interface SyncedPiniaCoordination {
  /** Current leader's tab-election participant ID, or undefined while electing. */
  leaderId: string | undefined
  /** Number of live synchronization participants, including the leader. */
  participantCount: number
  /** Live synchronization participants, including this one, sorted by ID. */
  participants: SyncedParticipant[]
}

/** Owns one Pinia plugin and the tab-election lifecycle for one synchronization domain. */
export interface SyncedPiniaRuntime {
  /**
   * Adds a role to this participant, for example while a component that can run an action is mounted.
   * Actions that require the role can then run here. Call the returned function to release this claim.
   * The participant holds the role until every claim of it is released.
   */
  addRole: (role: string) => () => void
  /**
   * Stops new routes, rejects locally pending RPC callers, and releases transport ownership.
   * An action already executing in another tab cannot be canceled generically.
   */
  dispose: () => void
  /** Returns the current leader's participant ID, or undefined while electing. */
  getLeaderId: () => string | undefined
  /** Returns the number of recently observed synchronization participants. */
  getParticipantCount: () => number
  /** Returns the recently observed synchronization participants and their roles. */
  getParticipants: () => SyncedParticipant[]
  /** Returns the roles that this participant holds, sorted. */
  getRoles: () => string[]
  /** Reports whether this web context currently owns the synchronization domain. */
  isLeader: () => boolean
  /** Subscribes to leader identity and participant-presence changes. */
  onCoordinationChange: (listener: (coordination: SyncedPiniaCoordination) => void) => () => void
  /** Subscribes to leader-role changes for diagnostics and UI. */
  onLeadershipChange: (listener: (isLeader: boolean) => void) => () => void
  /** Current synchronization participant ID. */
  participantId: string
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
  if (!leadershipModes.includes(resolvedOptions.leadership))
    throw new TypeError('leadership must be "follower-preferred", "follower-only", or "leader-only".')
  if (!Number.isSafeInteger(resolvedOptions.commandHistoryLimit) || resolvedOptions.commandHistoryLimit < 1)
    throw new RangeError('commandHistoryLimit must be a positive safe integer.')
  if (!Number.isSafeInteger(resolvedOptions.participantHeartbeatInterval) || resolvedOptions.participantHeartbeatInterval < 1)
    throw new RangeError('participantHeartbeatInterval must be a positive safe integer.')
  if (!Number.isSafeInteger(resolvedOptions.participantTimeout) || resolvedOptions.participantTimeout <= resolvedOptions.participantHeartbeatInterval)
    throw new RangeError('participantTimeout must be a safe integer greater than participantHeartbeatInterval.')

  const tab = new Tab<DomainState>(resolvedOptions.namespace, { callTimeout: resolvedOptions.callTimeout })
  const commitChannel = new MessageChannel()
  const registrations = new Map<string, StoreRegistration>()
  const inFlightActions = new Map<string, Promise<unknown>>()
  const pendingDirtyStoreIds = new Set<string>()
  const pendingOperations = new Map<string, OperationRecord>()
  const pendingStoreStates = new Map<string, unknown>()
  const coordinationListeners = new Set<(coordination: SyncedPiniaCoordination) => void>()
  const participantLastSeen = new Map([[tab.id, Date.now()]])
  const participantRoles = new Map<string, string[]>()
  const roleClaims = new Map<string, number>()
  const leadershipListeners = new Set<(isLeader: boolean) => void>()
  const pendingCalls = new Set<PendingCall>()
  const pendingRoutes = new Map<string, PendingRoute>()
  const routedExecutions = new Map<string, RoutedExecution>()
  const unsettledCommits = new Set<Promise<void>>()
  let disposed = false
  let hasReceivedCommittedState = false
  let leaderId: string | undefined
  let ownerPinia: Pinia | undefined
  let pendingCommit: PendingCommit | undefined
  let stopWaitingForCommittedState = noop

  function localRoles() {
    return [...roleClaims.keys()].sort()
  }

  function rolesOf(participantId: string) {
    return participantId === tab.id ? localRoles() : participantRoles.get(participantId) ?? []
  }

  function listParticipants(): SyncedParticipant[] {
    return [...participantLastSeen.keys()]
      .sort()
      .map(id => ({ id, roles: rolesOf(id) }))
  }

  function coordinationSnapshot(): SyncedPiniaCoordination {
    return { leaderId, participantCount: participantLastSeen.size, participants: listParticipants() }
  }

  function notifyCoordinationChange() {
    const coordination = coordinationSnapshot()
    for (const listener of coordinationListeners)
      listener(coordination)
  }

  /** Forgets a participant and fails the actions that this leader routed to it. */
  function forgetParticipant(participantId: string) {
    const removed = participantLastSeen.delete(participantId)
    participantRoles.delete(participantId)
    if (leaderId === participantId)
      leaderId = undefined

    for (const [operationId, route] of pendingRoutes) {
      if (route.targetId === participantId) {
        settleRoute(operationId, () => route.reject(new Error(`Participant "${participantId}" left before its routed action settled.`)))
      }
    }

    return removed
  }

  function settleRoute(operationId: string, callback: () => void) {
    const route = pendingRoutes.get(operationId)
    if (!route)
      return

    pendingRoutes.delete(operationId)
    clearTimeout(route.timeout)
    callback()
  }

  /**
   * Chooses the participant that runs an action.
   * The leader runs it when it holds the roles. Otherwise the caller runs it, and then the first other holder by ID.
   */
  function selectExecutor(actionOptions: ResolvedActionOptions, callerId: string) {
    if (actionOptions.roles.length === 0)
      return tab.id

    const holds = (participantId: string) => {
      const roles = rolesOf(participantId)
      return actionOptions.roles.every(role => roles.includes(role))
    }

    if (holds(tab.id))
      return tab.id
    if (participantLastSeen.has(callerId) && holds(callerId))
      return callerId

    const holder = [...participantLastSeen.keys()].sort().find(holds)
    if (holder)
      return holder
    if (actionOptions.fallback === 'leader')
      return tab.id

    throw new Error(`No live participant holds the roles ${actionOptions.roles.map(role => `"${role}"`).join(', ')}.`)
  }

  /** Sends an action to the participant that holds its roles, and waits for its outcome. */
  function routeAction(targetId: string, command: ActionCommand) {
    return new Promise<RoutedOutcome>((resolve, reject) => {
      const timeout = setTimeout(() => {
        settleRoute(command.operationId, () => reject(new Error(`Participant "${targetId}" did not settle the routed action in time.`)))
      }, resolvedOptions.callTimeout)

      pendingRoutes.set(command.operationId, { reject, resolve, targetId, timeout })
      tab.send({ command, leaderId: tab.id, type: 'action-request' } satisfies CoordinationMessage, targetId)
    })
  }

  /**
   * Runs an action that a leader routed to this participant, then reports its outcome to that leader.
   *
   * Triggering workflow:
   *
   * {@link routeAction}
   *   -> `action-request`
   *     -> {@link handleCoordinationMessage}
   *       -> {@link runRoutedAction}
   *
   * Upstream:
   * - {@link handleCoordinationMessage}
   *
   * Downstream:
   * - {@link flushLocalProposals}
   */
  function runRoutedAction(command: ActionCommand, requesterId: string) {
    pruneRoutedExecutions()

    let execution = routedExecutions.get(command.operationId)
    if (!execution) {
      const created: RoutedExecution = {
        outcome: Promise.resolve()
          .then(() => {
            const registration = registrations.get(command.storeId)
            const action = registration?.originalActions.get(command.actionName)
            if (!registration?.active || !action)
              throw new Error(`Store "${command.storeId}" does not expose synced action "${command.actionName}" in participant "${tab.id}".`)

            return action.apply(registration.store, command.args)
          })
          .then(
            result => ({ result: structuredClone(result), status: 'fulfilled' }) as const,
            (error: unknown) => {
              const operationError = toError(error)
              return { error: { message: operationError.message, name: operationError.name }, status: 'rejected' } as const
            },
          )
          // The leader commits the result. State proposals from the action must reach it first.
          .then(async (outcome) => {
            await flushLocalProposals()
            created.expiresAt = Date.now() + resolvedOptions.callTimeout
            return outcome
          }),
      }
      execution = created
      routedExecutions.set(command.operationId, execution)
    }

    void execution.outcome.then((outcome) => {
      if (!disposed)
        tab.send({ operationId: command.operationId, outcome, type: 'action-result' } satisfies CoordinationMessage, requesterId)
    })
  }

  function pruneRoutedExecutions() {
    const now = Date.now()
    for (const [operationId, execution] of routedExecutions) {
      if (execution.expiresAt !== undefined && execution.expiresAt < now)
        routedExecutions.delete(operationId)
    }
  }

  /** Waits until this participant's queued state proposals reach the leader. */
  async function flushLocalProposals() {
    // Mutation subscriptions run in Vue's pre-flush queue. Let the last mutation queue its commit first.
    await nextTick()
    while (unsettledCommits.size > 0) {
      // A failed proposal is reported by the mutation subscription.
      await Promise.allSettled([...unsettledCommits])
    }
  }

  function announceRoles() {
    tab.send({ participantId: tab.id, roles: localRoles(), type: 'participant-roles' } satisfies CoordinationMessage)
    notifyCoordinationChange()
  }

  function addRole(role: string) {
    if (typeof role !== 'string' || role.length === 0)
      throw new TypeError('A role must be a non-empty string.')
    if (disposed)
      return noop

    const claims = roleClaims.get(role) ?? 0
    roleClaims.set(role, claims + 1)
    if (claims === 0)
      announceRoles()

    let released = false
    return () => {
      if (released || disposed)
        return

      released = true
      const remaining = (roleClaims.get(role) ?? 1) - 1
      if (remaining > 0) {
        roleClaims.set(role, remaining)
        return
      }

      roleClaims.delete(role)
      announceRoles()
    }
  }

  function publishCommit(storeStates: ReadonlyMap<string, unknown>, operations: readonly OperationRecord[]) {
    if (disposed || !tab.isLeader)
      return

    const current = normalizeDomainState(tab.getState())
    const operationIds = new Set(operations.map(operation => operation.id))
    const completedOperations = [
      ...current.operations.filter(operation => !operationIds.has(operation.id)),
      ...operations,
    ]

    const historyStart = Math.max(0, completedOperations.length - resolvedOptions.commandHistoryLimit)
    // A caller can retry until its RPC timeout. Keep every result that a late retry can still reference.
    const retryWindowOpenedAt = Date.now() - resolvedOptions.callTimeout
    const retryWindowStart = completedOperations.findIndex(item => item.completedAt >= retryWindowOpenedAt)
    const retentionStart = retryWindowStart === -1 ? historyStart : Math.min(historyStart, retryWindowStart)
    const storeRevisions = { ...current.storeRevisions }
    const stores = { ...current.stores }

    for (const [storeId, state] of storeStates) {
      const storeRevision = (storeRevisions[storeId] ?? 0) + 1
      storeRevisions[storeId] = storeRevision
      stores[storeId] = state

      const registration = registrations.get(storeId)
      if (registration?.active)
        registration.appliedRevision = storeRevision
    }

    tab.setState({
      operations: completedOperations.slice(retentionStart),
      revision: current.revision + 1,
      storeRevisions,
      stores,
    })
  }

  /**
   * Flushes dirty stores and completed operations as one domain revision.
   *
   * Triggering workflow:
   *
   * {@link queueDirtyStore}
   *   -> {@link scheduleCommit}
   *     -> `MessagePort.message`
   *       -> {@link flushPendingCommit}
   *
   * Upstream:
   * - {@link scheduleCommit}
   *
   * Downstream:
   * - {@link publishCommit}
   */
  async function flushPendingCommit() {
    const commit = pendingCommit
    if (!commit)
      return

    pendingCommit = undefined
    const operations = [...pendingOperations.values()]
    const storeStates = new Map(pendingStoreStates)
    const dirtyStoreIds = [...pendingDirtyStoreIds]
    pendingDirtyStoreIds.clear()
    pendingOperations.clear()
    pendingStoreStates.clear()

    try {
      for (const storeId of dirtyStoreIds) {
        const registration = registrations.get(storeId)
        if (registration?.active)
          storeStates.set(storeId, resolvedOptions.serialize(registration.store.$state))
      }

      if (tab.isLeader) {
        publishCommit(storeStates, operations)
      }
      else {
        await Promise.all([...storeStates].map(([storeId, state]) => proposeState(storeId, state)))
      }
      commit.resolve()
    }
    catch (error) {
      commit.reject(error)
    }
  }

  /**
   * Sends a full-state proposal of one store to the leader.
   *
   * While a proposal is unsettled, {@link applyDomainState} keeps the local state of that store.
   * A snapshot that arrives meanwhile can predate the local mutation, for example the echo of an earlier proposal.
   * Applying it would undo the mutation. Worse, an action that still runs here would write to replaced objects.
   */
  async function proposeState(storeId: string, state: unknown) {
    const registration = registrations.get(storeId)
    if (registration)
      registration.localProposals += 1

    try {
      await invokeLeader('replaceState', { state, storeId })
    }
    finally {
      if (registration) {
        registration.localProposals -= 1
        if (registration.localProposals === 0 && registration.active && !tab.isLeader)
          applyDomainState(tab.getState())
      }
    }
  }

  function scheduleCommit() {
    if (pendingCommit)
      return pendingCommit.promise

    let reject!: (error: unknown) => void
    let resolve!: () => void
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      reject = rejectPromise
      resolve = resolvePromise
    })
    pendingCommit = { promise, reject, resolve }
    unsettledCommits.add(promise)
    promise.then(
      () => unsettledCommits.delete(promise),
      () => unsettledCommits.delete(promise),
    )
    commitChannel.port2.postMessage(undefined)
    return promise
  }

  function queueOperationCommit(operation: OperationRecord) {
    if (disposed)
      return Promise.resolve()

    pendingOperations.set(operation.id, operation)
    return scheduleCommit()
  }

  function queueStoreCommit(storeId: string, state: unknown) {
    if (disposed)
      return Promise.resolve()

    pendingStoreStates.set(storeId, state)
    return scheduleCommit()
  }

  function queueDirtyStore(storeId: string) {
    if (disposed)
      return

    const commitAlreadyScheduled = Boolean(pendingCommit)
    pendingDirtyStoreIds.add(storeId)
    if (!commitAlreadyScheduled)
      return scheduleCommit()
  }

  commitChannel.port1.onmessage = flushPendingCommit

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

    // A snapshot that matches the current state is not a change, and pinia
    // notifies subscribers on every `$patch`. A late or repeated snapshot
    // arrives this way: applying it reports a change that did not happen.
    if (isEqual(resolvedOptions.serialize(registration.store.$state), serializedState))
      return

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
      // The subscription flushes in Vue's next microtask. Keep the guard active
      // until its callback has observed this remotely applied patch.
      queueMicrotask(() => {
        registration.applyingState -= 1
      })
    }
  }

  function applyDomainState(state: unknown) {
    const domainState = normalizeDomainState(state)
    for (const registration of registrations.values()) {
      if (!registration.options.state)
        continue

      const storeId = registration.store.$id
      if (!(storeId in domainState.stores))
        continue

      // Keep unsent and unacknowledged local mutations. See proposeState.
      if (!tab.isLeader && (registration.localProposals > 0 || pendingDirtyStoreIds.has(storeId)))
        continue

      const storeRevision = domainState.storeRevisions[storeId] ?? domainState.revision
      if (registration.appliedRevision === storeRevision)
        continue

      applyStoreState(registration, domainState.stores[storeId])
      registration.appliedRevision = storeRevision
    }
  }

  /**
   * Executes a routed action in the elected leader.
   *
   * Triggering workflow:
   *
   * {@link Tab.call}
   *   -> `invokeAction`
   *     -> {@link executeAction}
   *
   * Upstream:
   * - {@link leaderApi}
   *
   * Downstream:
   * - {@link queueOperationCommit}
   */
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
    const actionOptions = registration?.options.actions.get(command.actionName)
    if (!registration?.active || !action || !actionOptions) {
      throw new Error(`Store "${command.storeId}" does not expose synced action "${command.actionName}" in the leader.`)
    }

    const run = async () => {
      const executorId = selectExecutor(actionOptions, command.callerId)
      if (executorId === tab.id)
        return action.apply(registration.store, command.args)

      const outcome = await routeAction(executorId, command)
      if (outcome.status === 'rejected')
        throw toError(outcome.error)

      return outcome.result
    }

    const execution = Promise.resolve()
      .then(run)
      .then(
        async (result) => {
          const clonedResult = structuredClone(result)
          await queueOperationCommit({ completedAt: Date.now(), id: command.operationId, outcome: 'fulfilled', result: clonedResult })
          return clonedResult
        },
        async (error: unknown) => {
          const operationError = toError(error)
          await queueOperationCommit({ completedAt: Date.now(), error: { message: operationError.message, name: operationError.name }, id: command.operationId, outcome: 'rejected' })
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
      return Promise.resolve()

    return queueStoreCommit(command.storeId, command.state)
  }

  function replaceState(command: StateCommand) {
    const registration = registrations.get(command.storeId)
    if (registration?.active)
      applyStoreState(registration, command.state)

    return queueStoreCommit(command.storeId, command.state)
  }

  const leaderApi: LeaderApi = {
    invokeAction: executeAction,
    publishInitialState,
    replaceState,
  }

  /**
   * Applies a committed domain snapshot received from tab-election.
   *
   * Triggering workflow:
   *
   * {@link Tab}
   *   -> `state`
   *     -> {@link handleState}
   *
   * Upstream:
   * - {@link Tab.addEventListener}
   *
   * Downstream:
   * - {@link applyDomainState}
   */
  const handleState = (event: Event) => {
    if (!(event instanceof MessageEvent))
      return

    hasReceivedCommittedState = true
    applyDomainState(event.data)
  }

  /**
   * Updates participant presence and leader identity from a coordination message.
   *
   * Triggering workflow:
   *
   * {@link Tab}
   *   -> `message`
   *     -> {@link handleCoordinationMessage}
   *
   * Upstream:
   * - {@link Tab.addEventListener}
   *
   * Downstream:
   * - {@link notifyCoordinationChange}
   */
  const handleCoordinationMessage = (event: Event) => {
    if (!(event instanceof MessageEvent) || !event.data || typeof event.data !== 'object')
      return

    const message = event.data as Partial<CoordinationMessage>
    if (message.type === 'leader-present' && typeof message.leaderId === 'string') {
      const countBefore = participantLastSeen.size
      participantLastSeen.set(message.leaderId, Date.now())
      const changed = leaderId !== message.leaderId || countBefore !== participantLastSeen.size
      leaderId = message.leaderId
      if (changed)
        notifyCoordinationChange()
      return
    }

    if (message.type === 'action-request' && message.command && typeof message.leaderId === 'string') {
      runRoutedAction(message.command, message.leaderId)
      return
    }

    if (message.type === 'action-result' && typeof message.operationId === 'string' && message.outcome) {
      const outcome = message.outcome
      const route = pendingRoutes.get(message.operationId)
      if (route)
        settleRoute(message.operationId, () => route.resolve(outcome))
      return
    }

    if (!('participantId' in message) || typeof message.participantId !== 'string')
      return

    if (message.type === 'participant-leave') {
      if (forgetParticipant(message.participantId))
        notifyCoordinationChange()
      return
    }

    if (message.type !== 'participant-heartbeat' && message.type !== 'participant-hello' && message.type !== 'participant-present' && message.type !== 'participant-roles')
      return

    const countBefore = participantLastSeen.size
    participantLastSeen.set(message.participantId, Date.now())
    const roles = Array.isArray(message.roles) ? message.roles.filter((role): role is string => typeof role === 'string').sort() : []
    const rolesChanged = !isEqual(participantRoles.get(message.participantId) ?? [], roles)
    participantRoles.set(message.participantId, roles)
    if (countBefore !== participantLastSeen.size || rolesChanged)
      notifyCoordinationChange()

    if (message.type === 'participant-hello') {
      tab.send({ participantId: tab.id, roles: localRoles(), type: 'participant-present' } satisfies CoordinationMessage, message.participantId)
      if (tab.isLeader)
        tab.send({ leaderId: tab.id, type: 'leader-present' } satisfies CoordinationMessage, message.participantId)
    }
  }

  /**
   * Publishes the runtime's new leadership role to participants and listeners.
   *
   * Triggering workflow:
   *
   * {@link Tab}
   *   -> `leadershipchange`
   *     -> {@link handleLeadershipChange}
   *
   * Upstream:
   * - {@link Tab.addEventListener}
   *
   * Downstream:
   * - {@link notifyCoordinationChange}
   */
  const handleLeadershipChange = () => {
    if (tab.isLeader) {
      leaderId = tab.id
      participantLastSeen.set(tab.id, Date.now())
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

  /**
   * Restores the latest domain snapshot and exposes the leader-owned API.
   *
   * Triggering workflow:
   *
   * {@link Tab.waitForLeadership}
   *   -> `leadership acquired`
   *     -> {@link assumeLeadership}
   *
   * Upstream:
   * - {@link participateInElection}
   *
   * Downstream:
   * - {@link applyDomainState}
   */
  const assumeLeadership = () => {
    applyDomainState(tab.getState())
    return leaderApi
  }

  function reportError(error: unknown) {
    console.error(`[${resolvedOptions.namespace}]`, error)
    resolvedOptions.onError(error)
  }

  function waitForCommittedState() {
    if (hasReceivedCommittedState)
      return Promise.resolve(true)

    return new Promise<boolean>((resolve, reject) => {
      let handleStateReceived: () => void
      let timeout: ReturnType<typeof setTimeout>

      const settle = (callback: () => void) => {
        clearTimeout(timeout)
        tab.removeEventListener('state', handleStateReceived)
        stopWaitingForCommittedState = noop
        callback()
      }

      handleStateReceived = () => settle(() => resolve(true))
      timeout = setTimeout(() => {
        settle(() => reject(new Error('leader-only takeover timed out before receiving committed state.')))
      }, resolvedOptions.callTimeout)

      stopWaitingForCommittedState = () => settle(() => resolve(false))
      tab.addEventListener('state', handleStateReceived)

      if (hasReceivedCommittedState)
        handleStateReceived()
    })
  }

  async function participateInElection() {
    let steal = false
    if (resolvedOptions.leadership === 'leader-only') {
      const hasLeader = await tab.hasLeader()
      if (disposed)
        return

      if (hasLeader && !tab.isLeader) {
        try {
          if (!await waitForCommittedState())
            return
          steal = true
        }
        catch (error) {
          reportError(error)
        }
      }
      else {
        steal = true
      }
    }

    for (;;) {
      if (disposed)
        return

      try {
        await tab.waitForLeadership(assumeLeadership, steal ? { steal: true } : undefined)
      }
      catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'AbortError') {
          reportError(error)
          return
        }
      }
      steal = false
    }
  }

  if (resolvedOptions.leadership !== 'follower-only')
    void participateInElection()

  tab.send({ participantId: tab.id, roles: localRoles(), type: 'participant-hello' } satisfies CoordinationMessage)
  const heartbeatTimer = setInterval(() => {
    const now = Date.now()
    let changed = false
    participantLastSeen.set(tab.id, now)
    for (const [participantId, lastSeen] of participantLastSeen) {
      if (participantId !== tab.id && now - lastSeen > resolvedOptions.participantTimeout) {
        forgetParticipant(participantId)
        changed = true
      }
    }
    if (changed)
      notifyCoordinationChange()

    pruneRoutedExecutions()
    tab.send({ participantId: tab.id, roles: localRoles(), type: 'participant-heartbeat' } satisfies CoordinationMessage)
  }, resolvedOptions.participantHeartbeatInterval)

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
    for (const actionName of registration.options.actions.keys()) {
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
          callerId: tab.id,
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

  function registerStore(store: StoreGeneric, storeOptions: ResolvedStoreOptions) {
    const registration: StoreRegistration = {
      actionWrappers: new Map(),
      active: true,
      applyingState: 0,
      localProposals: 0,
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
      registration.appliedRevision = domainState.storeRevisions[store.$id] ?? domainState.revision
    }
    else if (tab.isLeader) {
      publishCommit(new Map([[store.$id, resolvedOptions.serialize(store.$state)]]), [])
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
      /**
       * Marks a locally mutated store for serialization in the next commit task.
       *
       * Triggering workflow:
       *
       * {@link registerStore}
       *   -> {@link StoreGeneric.$subscribe}
       *     -> `store mutation`
       *       -> {@link handleStoreMutation}
       *
       * Upstream:
       * - {@link StoreGeneric.$subscribe}
       *
       * Downstream:
       * - {@link queueDirtyStore}
       */
      const handleStoreMutation: Parameters<typeof store.$subscribe>[0] = () => {
        if (!registration.active || registration.applyingState > 0)
          return

        void queueDirtyStore(store.$id)?.catch((error) => {
          console.error(`[${resolvedOptions.namespace}]`, error)
          resolvedOptions.onError(error)
          if (!tab.isLeader)
            applyDomainState(tab.getState())
        })
      }

      registration.stopSubscription = store.$subscribe(handleStoreMutation, { flush: 'pre' })
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
      actions: resolveActionOptions(store.$id, configured.actions ?? []),
      state: configured.state ?? true,
    })
  }

  return {
    addRole,
    dispose() {
      if (disposed)
        return

      disposed = true
      stopWaitingForCommittedState()

      tab.send({ participantId: tab.id, type: 'participant-leave' } satisfies CoordinationMessage)
      clearInterval(heartbeatTimer)

      tab.removeEventListener('state', handleState)
      tab.removeEventListener('message', handleCoordinationMessage)
      tab.removeEventListener('leadershipchange', handleLeadershipChange)

      for (const registration of [...registrations.values()])
        unregisterStore(registration)

      coordinationListeners.clear()
      leadershipListeners.clear()
      inFlightActions.clear()
      roleClaims.clear()
      routedExecutions.clear()
      unsettledCommits.clear()
      pendingDirtyStoreIds.clear()
      pendingOperations.clear()
      pendingStoreStates.clear()
      pendingCommit?.resolve()
      pendingCommit = undefined
      commitChannel.port1.onmessage = null
      commitChannel.port1.close()
      commitChannel.port2.close()

      const disposalError = new Error('Pinia sync runtime was disposed before the RPC completed.')

      for (const pending of pendingCalls)
        pending.reject(disposalError)

      for (const [operationId, route] of [...pendingRoutes])
        settleRoute(operationId, () => route.reject(disposalError))

      pendingCalls.clear()
      tab.close()
    },
    getLeaderId: () => leaderId,
    getParticipantCount: () => participantLastSeen.size,
    getParticipants: listParticipants,
    getRoles: localRoles,
    isLeader: () => tab.isLeader,
    onCoordinationChange(listener) {
      if (disposed)
        return noop

      coordinationListeners.add(listener)
      listener(coordinationSnapshot())

      return () => coordinationListeners.delete(listener)
    },
    onLeadershipChange(listener) {
      if (disposed)
        return noop

      leadershipListeners.add(listener)
      listener(tab.isLeader)

      return () => leadershipListeners.delete(listener)
    },
    participantId: tab.id,
    plugin,
  }
}

function normalizeDomainState(state: unknown): DomainState {
  if (!state || typeof state !== 'object' || Array.isArray(state))
    return { operations: [], revision: 0, storeRevisions: {}, stores: {} }

  const value = state as Partial<DomainState>
  const revision = Number.isSafeInteger(value.revision) && (value.revision ?? 0) >= 0
    ? value.revision ?? 0
    : 0
  const stores = value.stores && typeof value.stores === 'object' && !Array.isArray(value.stores)
    ? value.stores
    : {}
  const storeRevisions = value.storeRevisions && typeof value.storeRevisions === 'object' && !Array.isArray(value.storeRevisions)
    ? { ...value.storeRevisions }
    : {}

  for (const storeId of Object.keys(stores)) {
    const storeRevision = storeRevisions[storeId]
    if (!Number.isSafeInteger(storeRevision) || (storeRevision ?? -1) < 0)
      storeRevisions[storeId] = revision
  }

  return {
    operations: Array.isArray(value.operations) ? value.operations : [],
    revision,
    storeRevisions,
    stores,
  }
}

function resolveActionOptions(storeId: string, actions: NonNullable<SyncedStoreOptions['actions']>) {
  const entries: [string, SyncedActionOptions | undefined][] = Array.isArray(actions)
    ? actions.map(actionName => [actionName, undefined])
    : Object.entries(actions)
  const resolved = new Map<string, ResolvedActionOptions>()

  for (const [actionName, options] of entries) {
    const roles = options?.roles ?? []
    const fallback = options?.fallback ?? 'leader'
    if (!roles.every(role => typeof role === 'string' && role.length > 0))
      throw new TypeError(`Synced action "${actionName}" of store "${storeId}" must list non-empty role strings.`)
    if (fallback !== 'leader' && fallback !== 'reject')
      throw new TypeError(`Synced action "${actionName}" of store "${storeId}" must use fallback "leader" or "reject".`)

    resolved.set(actionName, { fallback, roles: [...roles] })
  }

  return resolved
}
