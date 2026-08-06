# Pinia state snapshots and plugin practice

Research date: 2026-08-06

## Scope

This note answers four questions:

- Does Pinia expose the complete state tree?
- Does Pinia filter state for selected stores?
- Which public APIs restore state?
- How do existing Pinia plugins read and restore state?

The local prototype uses Pinia 4.0.2. The matching source commit is
[`ae4e3b2`](https://github.com/vuejs/pinia/tree/ae4e3b2ba6938b12296ae35ce8d49e36d89f8fd1).

## Direct answer

Pinia exposes the complete live state tree as `pinia.state.value`. Its type is
`Record<string, StateTree>`. Each key is a store ID. Pinia does not expose a
separate snapshot function.

`pinia.state.value` is reactive state, not a detached snapshot. A serializer or
clone operation must create the transport value.

Pinia does not expose a public utility that filters this tree by plugin options.
The root state does not contain the `synced.state` opt-in setting. The sync
plugin must keep this selection itself.

The current `snapshotRegisteredStores` policy must not change to serialization
of the complete `pinia.state.value`. That change would include stores that did
not opt in. It can also include retained state from a disposed store.

The recommended implementation is:

1. Keep the plugin registration map as the source of selected store IDs.
2. Keep inactive and `state: false` registrations out of the result.
3. Read each selected store from `store.$state` or `pinia.state.value[storeId]`.
4. Serialize each selected store before transport.
5. Keep remote state for a selected store that is not registered in this tab.

`store.$state` is the clearer source inside a store plugin. Pinia implements it
as a getter for `pinia.state.value[storeId]`. Thus, a change to the root entry
does not remove the loop or provide a new Pinia utility.

## Pinia public API

### Complete state

The public `Pinia` interface defines `state` as
`Ref<Record<string, StateTree>>`. See
[`rootStore.ts`, lines 63-69](https://github.com/vuejs/pinia/blob/ae4e3b2ba6938b12296ae35ce8d49e36d89f8fd1/packages/pinia/src/rootStore.ts#L63-L69).

Pinia creates this root state as one `ref({})`. See
[`createPinia.ts`, lines 10-16](https://github.com/vuejs/pinia/blob/ae4e3b2ba6938b12296ae35ce8d49e36d89f8fd1/packages/pinia/src/createPinia.ts#L10-L16).

The official state guide gives two supported whole-tree operations:

- Assign `pinia.state.value` to provide the initial application state.
- Watch `pinia.state` to persist the complete state tree.

See the official sections on
[replacing state](https://pinia.vuejs.org/core-concepts/state.html#replacing-the-state)
and [subscribing to state](https://pinia.vuejs.org/core-concepts/state.html#subscribing-to-the-state).

These APIs do not select stores. The application or plugin must select the
required keys.

### Per-store state

Pinia reads initial Option Store state from `pinia.state.value[id]`. It creates
that entry when no initial state exists. See
[`store.ts`, lines 162-177](https://github.com/vuejs/pinia/blob/ae4e3b2ba6938b12296ae35ce8d49e36d89f8fd1/packages/pinia/src/store.ts#L162-L177).

For a normal store, the `$state` getter returns the same root-state entry. The
`$state` setter calls `$patch()` and assigns the incoming fields. See
[`store.ts`, lines 574-588](https://github.com/vuejs/pinia/blob/ae4e3b2ba6938b12296ae35ce8d49e36d89f8fd1/packages/pinia/src/store.ts#L574-L588).

As a result, these reads refer to the same state:

```ts
store.$state
pinia.state.value[store.$id]
```

The first form expresses store ownership. The second form is useful for a root
state operation.

### Filtering selected stores

Pinia has no public selected-store snapshot utility. Its internal `_s` map is a
store registry, but Pinia marks `_s` as internal. See
[`rootStore.ts`, lines 88-94](https://github.com/vuejs/pinia/blob/ae4e3b2ba6938b12296ae35ce8d49e36d89f8fd1/packages/pinia/src/rootStore.ts#L88-L94).

The root state is also not a list of active stores. `$dispose()` removes a store
from the registry but keeps its state entry. Pinia documents the required
manual deletion in
[`types.ts`, lines 397-406](https://github.com/vuejs/pinia/blob/ae4e3b2ba6938b12296ae35ce8d49e36d89f8fd1/packages/pinia/src/types.ts#L397-L406).

Therefore, the sync plugin must not use all keys from `pinia.state.value` as its
opt-in list.

### Restore and hydration APIs

Pinia supplies these public mechanisms:

- `store.$patch(object)` merges a partial state object.
- `store.$patch(function)` changes the existing reactive state.
- `store.$state = value` calls `$patch()` internally. It is not an exact object
  replacement.
- `pinia.state.value = rootState` supplies or replaces the application root
  state. Pinia uses this mechanism for initial SSR hydration.
- The Option Store `hydrate` hook handles custom refs that ordinary initial
  state copying cannot hydrate.
- `skipHydrate()` and `shouldHydrate()` control hydration of values from Setup
  Stores.

The `$patch()` implementation changes `pinia.state.value[storeId]` and then
notifies subscribers. See
[`store.ts`, lines 288-327](https://github.com/vuejs/pinia/blob/ae4e3b2ba6938b12296ae35ce8d49e36d89f8fd1/packages/pinia/src/store.ts#L288-L327).

The official API documents the
[`hydrate` option](https://pinia.vuejs.org/api/pinia/interfaces/DefineStoreOptionsInPlugin.html#hydrate),
[`skipHydrate()`](https://pinia.vuejs.org/api/pinia/functions/skipHydrate.html), and
[`shouldHydrate()`](https://pinia.vuejs.org/api/pinia/functions/shouldHydrate.html).
These APIs do not provide a general network-state restore operation.

For an existing store, `$patch()` is the normal public restore API. This choice
keeps the state object reactive and groups the update for subscribers and
devtools.

## Existing plugin practice

### pinia-plugin-persistedstate 4.5.0

This project is archived. Version 4.5.0 is its last release. The release commit
is [`fb2c00a`](https://github.com/prazdevs/pinia-plugin-persistedstate/tree/fb2c00a62b912a7ce3833af33c6637fe028e1529).

The plugin works one store at a time:

- It receives the state from `store.$subscribe()`.
- Its explicit `$persist()` method reads `store.$state`.
- It applies `pick` and `omit` rules before serialization.
- It deserializes stored state and restores it with `store.$patch()`.

See
[`core.ts`, lines 24-35](https://github.com/prazdevs/pinia-plugin-persistedstate/blob/fb2c00a62b912a7ce3833af33c6637fe028e1529/src/runtime/core.ts#L24-L35)
and
[`core.ts`, lines 46-65](https://github.com/prazdevs/pinia-plugin-persistedstate/blob/fb2c00a62b912a7ce3833af33c6637fe028e1529/src/runtime/core.ts#L46-L65).
Its store integration appears in
[`core.ts`, lines 73-119](https://github.com/prazdevs/pinia-plugin-persistedstate/blob/fb2c00a62b912a7ce3833af33c6637fe028e1529/src/runtime/core.ts#L73-L119).

This plugin uses `pinia.state.value` only for an HMR identity check. It does not
serialize the complete root state.

### pinia-shared-state 2.0.1

The reviewed release is 2.0.1 at
[`fd47032`](https://github.com/wobsoriano/pinia-shared-state/tree/fd47032d725449c98c1ebbb77732d52af1151114).
The repository main branch also had commit
[`0726cf9`](https://github.com/wobsoriano/pinia-shared-state/tree/0726cf9284aff2af35c24ee291a8915b56ce6fa2)
on the research date. The relevant state logic is unchanged between these
revisions.

This plugin also works one store at a time:

- It creates one channel from `store.$id`.
- It serializes `store.$state` when another tab requests the current state.
- It serializes the state argument from `store.$subscribe()` after changes.
- It filters omitted state keys itself.
- It restores received state with `store.$patch()`.

See
[`index.ts`, lines 35-72](https://github.com/wobsoriano/pinia-shared-state/blob/fd47032d725449c98c1ebbb77732d52af1151114/src/index.ts#L35-L72)
and
[`index.ts`, lines 75-87](https://github.com/wobsoriano/pinia-shared-state/blob/fd47032d725449c98c1ebbb77732d52af1151114/src/index.ts#L75-L87).

## Recommendation for `snapshotRegisteredStores`

The function represents plugin policy, not a missing Pinia helper. It combines
three decisions:

- Which stores opted in.
- Which registrations are active.
- Which remote states must remain available before local store registration.

Pinia cannot make these decisions from `pinia.state.value`.

Keep the registration-based filter. Reading `registration.store.$state` matches
the practice of both reviewed plugins. It also avoids reliance on Pinia's
internal store registry.

The function can use `pinia.state.value[storeId]` if a future implementation
needs one root-state read. This is an equivalent source for a normal store. It
does not remove the filter or the serializer call.

Do not replace the function with this operation:

```ts
serialize(pinia.state.value)
```

That operation changes the package contract. It synchronizes every root-state
entry, including non-opted-in and retained disposed-store state.

If the helper name appears too mechanical, a policy name such as
`collectSynchronizedState` is more accurate. The loop itself has a distinct
purpose and has more than one call site, so inlining it does not improve the
module boundary.
