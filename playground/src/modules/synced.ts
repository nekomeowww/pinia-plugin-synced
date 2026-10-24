import type { LeadershipMode } from 'pinia-plugin-synced'

import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { computed, shallowRef } from 'vue'

const searchParams = new URLSearchParams(window.location.search)
const leadership = searchParams.get('leadership') as LeadershipMode | null

/** The role that the playground's narrate action requires. */
export const narratorRole = 'narrator'

export const synced = createSyncedPiniaPlugin({
  leadership: leadership ?? 'follower-preferred',
  namespace: 'pinia-plugin-synced:playground',
})
export const participantId = synced.participantId
export const isLeader = shallowRef(synced.isLeader())
const coordination = shallowRef({
  leaderId: synced.getLeaderId(),
  participantCount: synced.getParticipantCount(),
  participants: synced.getParticipants(),
})
export const participantCount = computed(() => coordination.value.participantCount)
export const leaderId = computed(() => coordination.value.leaderId)
export const narratorCount = computed(() => coordination.value.participants.filter(participant => participant.roles.includes(narratorRole)).length)
export const roles = computed(() => coordination.value.participants.find(participant => participant.id === participantId)?.roles ?? [])

let releaseNarrator: (() => void) | undefined

export function setNarrator(value: boolean) {
  if (value && !releaseNarrator) {
    releaseNarrator = synced.addRole(narratorRole)
  }
  else if (!value && releaseNarrator) {
    releaseNarrator()
    releaseNarrator = undefined
  }
}

setNarrator(searchParams.get('roles')?.split(',').includes(narratorRole) ?? false)

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
