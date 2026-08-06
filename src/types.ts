import type { StateTree, StoreActions } from 'pinia'

export interface SyncedOptions {
  /** Timeout for an action or state RPC to the elected leader, in milliseconds. @default 30000 */
  callTimeout?: number
  /** Interval between candidate presence announcements, in milliseconds. @default 15000 */
  candidateHeartbeatInterval?: number
  /** Time without a presence announcement before a candidate expires, in milliseconds. @default 120000 */
  candidateTimeout?: number
  /** Recent completed actions retained after the RPC timeout window; unexpired actions can exceed this limit. @default 128 */
  commandHistoryLimit?: number
  /** Converts a received value back into a Pinia state tree. */
  deserialize?: (state: unknown) => StateTree
  /** Unique same-origin synchronization and leader-election domain. @default pinia-plugin-synced */
  namespace?: string
  /** Receives background transport, serialization, and state application failures. */
  onError?: (error: unknown) => void
  /** Converts reactive Pinia state into a structured-clone-compatible value. */
  serialize?: (state: StateTree) => unknown
}

export interface SyncedStoreOptions<ActionName extends string = string> {
  /** Async actions routed to and executed only by the elected leader. @default [] */
  actions?: readonly ActionName[]
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
