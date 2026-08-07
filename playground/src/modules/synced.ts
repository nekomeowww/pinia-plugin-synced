import type { LeadershipMode } from 'pinia-plugin-synced'

import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { computed, shallowRef } from 'vue'

const leadership = new URLSearchParams(window.location.search).get('leadership') as LeadershipMode | null

export const synced = createSyncedPiniaPlugin({
  leadership: leadership ?? 'follower-preferred',
  namespace: 'pinia-plugin-synced:playground',
})
export const participantId = synced.participantId
export const isLeader = shallowRef(synced.isLeader())
const coordination = shallowRef({
  leaderId: synced.getLeaderId(),
  participantCount: synced.getParticipantCount(),
})
export const participantCount = computed(() => coordination.value.participantCount)
export const leaderId = computed(() => coordination.value.leaderId)

const stopLeadershipListener = synced.onLeadershipChange((value) => {
  isLeader.value = value
})
const stopCoordinationListener = synced.onCoordinationChange((value) => {
  coordination.value = value
})

export function disposeSynced() {
  stopCoordinationListener()
  stopLeadershipListener()
  synced.dispose()
}
