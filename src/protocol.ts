import type { ErrorLike } from '@moeru/std'

/** Invokes one explicitly registered action on the elected leader. */
export interface ActionCommand {
  actionName: string
  args: unknown[]
  /** The participant that called the action. The leader prefers it when it holds the required roles. */
  callerId: string
  operationId: string
  storeId: string
}

/** Presence and routing messages exchanged directly between synchronization participants. */
export type CoordinationMessage
  = | { command: ActionCommand, leaderId: string, type: 'action-request' }
    | { leaderId: string, type: 'leader-present' }
    | { operationId: string, outcome: RoutedOutcome, type: 'action-result' }
    | { participantId: string, roles: string[], type: 'participant-heartbeat' }
    | { participantId: string, roles: string[], type: 'participant-hello' }
    | { participantId: string, roles: string[], type: 'participant-present' }
    | { participantId: string, roles: string[], type: 'participant-roles' }
    | { participantId: string, type: 'participant-leave' }

/** The leader-owned state replicated by tab-election to every participating tab. */
export interface DomainState {
  operations: OperationRecord[]
  revision: number
  storeRevisions: Record<string, number>
  stores: Record<string, unknown>
}

/** A transport-safe error retained so duplicate operations can replay their outcome. */
export interface OperationError extends ErrorLike {
  message: string
  name: string
}

/** A completed action result retained for at-least-once delivery deduplication. */
export type OperationRecord
  = | {
    completedAt: number
    error: OperationError
    id: string
    outcome: 'rejected'
  }
  | {
    completedAt: number
    id: string
    outcome: 'fulfilled'
    result: unknown
  }

/** The outcome of an action that the leader routed to another participant. */
export type RoutedOutcome
  = | { error: OperationError, status: 'rejected' }
    | { result: unknown, status: 'fulfilled' }

/** Proposes a full state snapshot to the elected leader. */
export interface StateCommand {
  state: unknown
  storeId: string
}
