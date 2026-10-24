import type { StateTree, StoreActions } from 'pinia'

export const leadershipModes = ['follower-preferred', 'follower-only', 'leader-only'] as const

export type LeadershipMode = typeof leadershipModes[number]

/** Where one synced action executes. */
export interface SyncedActionOptions {
  /**
   * What happens when no live participant holds the roles.
   * `leader` runs the action in the leader. `reject` rejects the call. @default leader
   */
  fallback?: 'leader' | 'reject'
  /**
   * Runs the action in a live participant that holds every listed role.
   * The leader runs it when it holds the roles. Otherwise the caller runs it when it holds them.
   * Otherwise another participant that holds them runs it.
   * An empty list runs the action in the leader. @default []
   */
  roles?: readonly string[]
}

export interface SyncedOptions {
  /** Timeout for an action or state RPC to the elected leader, in milliseconds. @default 30000 */
  callTimeout?: number
  /** Recent completed actions retained after the RPC timeout window; unexpired actions can exceed this limit. @default 128 */
  commandHistoryLimit?: number
  /** Converts a received value back into a Pinia state tree. Defaults to structuredClone after validating the state shape. */
  deserialize?: (state: unknown) => StateTree
  /** Determines how this runtime participates in leadership. @default follower-preferred */
  leadership?: LeadershipMode
  /** Unique same-origin synchronization and leader-election domain. @default pinia-plugin-synced */
  namespace?: string
  /** Receives background transport, serialization, and state application failures. */
  onError?: (error: unknown) => void
  /** Interval between participant presence announcements, in milliseconds. @default 15000 */
  participantHeartbeatInterval?: number
  /** Time without a presence announcement before a participant expires, in milliseconds. @default 120000 */
  participantTimeout?: number
  /** Converts reactive Pinia state into a structured-clone-compatible value. Defaults to structuredClone after unwrapping Vue reactivity. */
  serialize?: (state: StateTree) => unknown
}

export interface SyncedStoreOptions<ActionName extends string = string> {
  /**
   * Async actions that the elected leader routes and executes.
   * A list runs each action in the leader. A record can route an action to participants by role.
   * @default []
   */
  actions?: readonly ActionName[] | { readonly [Name in ActionName]?: SyncedActionOptions }
  /** Synchronize direct mutations as authoritative full-state proposals. @default true */
  state?: boolean
}

declare module 'pinia' {
  // NOTICE:
  // TypeScript requires merged interfaces to repeat Pinia's generic parameter names and constraints.
  // This plugin only reads Store, so S is intentionally unused here.
  // Source: pinia/dist/pinia.d.ts, DefineStoreOptionsBase.
  // Remove this suppression if Pinia exposes a store-option augmentation without the unused state parameter.
  // eslint-disable-next-line unused-imports/no-unused-vars
  export interface DefineStoreOptionsBase<S extends StateTree, Store> {
    /** Enables tab-election-backed synchronization for this store. */
    synced?: boolean | SyncedStoreOptions<Extract<keyof StoreActions<Store>, string>>
  }
}
