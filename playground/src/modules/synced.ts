import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { computed, shallowRef } from 'vue'

export const synced = createSyncedPiniaPlugin({
  namespace: 'pinia-plugin-synced:playground',
})
export const instanceId = synced.instanceId
export const isLeader = shallowRef(synced.isLeader())
const coordination = shallowRef({
  candidateCount: synced.getCandidateCount(),
  leaderId: synced.getLeaderId(),
})
export const candidateCount = computed(() => coordination.value.candidateCount)
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
