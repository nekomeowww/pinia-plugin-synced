import type { Page } from '@playwright/test'

import type { Peer } from './test-utils'

import { expect, test } from '@playwright/test'

import {
  expectCoordination,
  openPagePeer,
  participantId,
  waitForSingleLeader,
} from './test-utils'

const actionsPerFollower = 150

// https://github.com/nekomeowww/pinia-plugin-synced/actions/runs/31097410416/job/92602618715
// ROOT CAUSE:
//
// A slow leader can receive a retry after more than 128 newer actions remove the first result from command history.
// The retry then enters the action again because neither the completed history nor the in-flight map contains its operation ID.
//
// Before the fix, 300 unique commands entered the action 450 times in CI.
//
// The fix retains every result for the RPC timeout. The count limit applies after this retry window ends.
test('settles hundreds of concurrent actions exactly once in the elected leader', async ({ context }) => {
  const peers = await Promise.all([
    openPagePeer(context),
    openPagePeer(context),
    openPagePeer(context),
  ])
  await Promise.all(peers.map(peer => peer.surface.emulateMedia({ reducedMotion: 'reduce' })))

  const election = await waitForSingleLeader(peers)
  const electedLeaderId = await participantId(election.leader)
  await expectCoordination(peers, electedLeaderId, peers.length)

  const batches = election.followers.map((_peer, peerIndex) => (
    Array.from({ length: actionsPerFollower }, (_value, actionIndex) => `follower-${peerIndex}-action-${actionIndex}`)
  ))
  const expectedMessages = batches.flat()

  const blockedLeader = election.leader.surface.evaluate(() => {
    const resumeAt = performance.now() + 1_200
    while (performance.now() < resumeAt) {
      // Keep the leader busy so follower acknowledgements exceed the 500 ms retry interval.
    }
  })
  await new Promise(resolve => setTimeout(resolve, 100))
  await Promise.all(election.followers.map((peer, index) => submitBurst(peer, batches[index]!)))
  await blockedLeader

  for (const peer of peers) {
    const messageItems = peer.surface.locator('.message-item')
    await expect(messageItems).toHaveCount(expectedMessages.length, { timeout: 30_000 })
    await expect(peer.surface.locator('.message-count')).toHaveText(`${expectedMessages.length} messages`)

    const receivedMessages = await messageItems.locator('> span:first-child').allTextContents()
    expect(new Set(receivedMessages)).toEqual(new Set(expectedMessages))
  }

  await expect(election.leader.surface.locator('.append-message-executions')).toHaveText(String(expectedMessages.length))
  for (const follower of election.followers)
    await expect(follower.surface.locator('.append-message-executions')).toHaveText('0')

  expect(peers.flatMap(peer => peer.errors)).toEqual([])
})

async function submitBurst(peer: Peer<Page>, messages: string[]) {
  await peer.surface.locator('.message-input').evaluate((element, values) => {
    if (!(element instanceof HTMLInputElement) || !element.form)
      throw new TypeError('The message input must belong to a form.')

    for (const value of values) {
      element.value = value
      element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }))
      element.form.requestSubmit()
    }
  }, messages)
}
