import type { Peer } from './test-utils'

import { expect, test } from '@playwright/test'

import {
  expectMessages,
  openPagePeer,
  participantId,
  waitForSingleLeader,
} from './test-utils'

/** Waits until every peer observes the same number of narrators. The leader routes by what it observes. */
async function expectNarrators(peers: Peer[], count: number) {
  for (const peer of peers)
    await expect(peer.surface.locator('.narrator-count')).toHaveText(String(count))
}

async function narrateMessage(peer: Peer, text: string) {
  await peer.surface.locator('.message-input').fill(text)
  await peer.surface.locator('.narrate-message').click()
}

test('the leader routes a role action to the participant that holds the role', async ({ context }) => {
  const first = await openPagePeer(context)
  const { leader } = await waitForSingleLeader([first])
  const narrator = await openPagePeer(context, 'follower-only', ['narrator'])
  const caller = await openPagePeer(context, 'follower-only')
  const peers = [leader, narrator, caller]
  await expectNarrators(peers, 1)
  const narratorId = await participantId(narrator)

  await narrateMessage(caller, 'routed to the narrator')

  for (const peer of peers)
    await expectMessages(peer, ['routed to the narrator'])
  await expect(caller.surface.locator('.message-executor').last()).toHaveText(narratorId)
  await expect(narrator.surface.locator('.narrate-message-executions')).toHaveText('1')
  await expect(leader.surface.locator('.narrate-message-executions')).toHaveText('0')
  await expect(caller.surface.locator('.narrate-message-executions')).toHaveText('0')

  for (const peer of peers)
    expect(peer.errors).toEqual([])
})

test('a caller that holds the role runs its own role action', async ({ context }) => {
  const first = await openPagePeer(context)
  const { leader } = await waitForSingleLeader([first])
  const narrators = [
    await openPagePeer(context, 'follower-only', ['narrator']),
    await openPagePeer(context, 'follower-only', ['narrator']),
  ]
  const peers = [leader, ...narrators]
  await expectNarrators(peers, 2)

  for (const [index, narrator] of narrators.entries()) {
    const id = await participantId(narrator)
    await narrateMessage(narrator, `from narrator ${index}`)
    await expect(narrator.surface.locator('.message-executor').last()).toHaveText(id)
    await expect(narrator.surface.locator('.narrate-message-executions')).toHaveText('1')
  }

  await expectMessages(leader, ['from narrator 0', 'from narrator 1'])
})

test('roles change at runtime, and a role action rejects when no participant holds its role', async ({ context }) => {
  const first = await openPagePeer(context)
  const { leader } = await waitForSingleLeader([first])
  const second = await openPagePeer(context, 'follower-only')
  const peers = [leader, second]

  await narrateMessage(second, 'nobody narrates')
  await expect(second.surface.locator('.narrate-error')).toContainText('No live participant holds the roles "narrator"')
  await expect(leader.surface.locator('.message-count')).toHaveText('0 messages')

  await leader.surface.locator('.narrator-role').check()
  await expectNarrators(peers, 1)
  await expect(leader.surface.locator('.participant-roles')).toHaveText('narrator')
  const leaderId = await participantId(leader)
  await narrateMessage(second, 'the leader narrates')
  await expect(second.surface.locator('.message-executor').last()).toHaveText(leaderId)

  await leader.surface.locator('.narrator-role').uncheck()
  await second.surface.locator('.narrator-role').check()
  await expect(leader.surface.locator('.participant-roles')).toHaveText('none')
  await expect(second.surface.locator('.participant-roles')).toHaveText('narrator')
  await expectNarrators(peers, 1)
  const secondId = await participantId(second)
  await narrateMessage(leader, 'the follower narrates')
  await expect(leader.surface.locator('.message-executor').last()).toHaveText(secondId)

  await expectMessages(leader, ['the leader narrates', 'the follower narrates'])
})

// ROOT CAUSE:
//
// A follower that runs a routed action proposes each mutation to the leader. The leader republishes every proposal.
// The echo of an earlier proposal can arrive after a later local mutation. Applying it undoes that mutation.
//
// Before the fix, the follower applied every snapshot that it received, and a streamed message could lose words.
//
// The fix keeps the local state of a store while its proposals are unsent or unacknowledged.
test('a follower that runs a streaming role action keeps every streamed mutation', async ({ context }) => {
  const first = await openPagePeer(context)
  const { leader } = await waitForSingleLeader([first])
  const narrator = await openPagePeer(context, 'follower-only', ['narrator'])
  const peers = [leader, narrator]
  await expectNarrators(peers, 1)

  const words = Array.from({ length: 40 }, (_value, index) => `word-${index}`)
  for (let round = 0; round < 3; round++)
    await narrateMessage(leader, `${round} ${words.join(' ')}`)

  const expected = Array.from({ length: 3 }, (_value, round) => `${round} ${words.join(' ')}`)
  for (const peer of peers) {
    await expect(peer.surface.locator('.message-item > span:first-child')).toHaveText(expected)
  }
  await expect(narrator.surface.locator('.narrate-message-executions')).toHaveText('3')
})
