import type { ErrorLike } from '@moeru/std'

/** Invokes one explicitly registered action on the elected leader. */
export interface ActionCommand {
  actionName: string
  args: unknown[]
  operationId: string
  storeId: string
}

/** Presence messages exchanged directly between synchronization candidates. */
export type CoordinationMessage
  = | { candidateId: string, type: 'candidate-heartbeat' }
    | { candidateId: string, type: 'candidate-hello' }
    | { candidateId: string, type: 'candidate-leave' }
    | { candidateId: string, type: 'candidate-present' }
    | { leaderId: string, type: 'leader-present' }

/** The leader-owned state replicated by tab-election to every participating tab. */
export interface DomainState {
  operations: OperationRecord[]
  revision: number
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

/** Proposes a full state snapshot to the elected leader. */
export interface StateCommand {
  state: unknown
  storeId: string
}
