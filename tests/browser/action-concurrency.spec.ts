import type { Page } from '@playwright/test'

import type { Peer } from './test-utils'

import { expect, test } from '@playwright/test'

import {
  expectCoordination,
  instanceId,
  openPagePeer,
  waitForSingleLeader,
} from './test-utils'

const actionsPerPeer = 100

test('settles hundreds of concurrent actions exactly once in the elected leader', async ({ context }) => {
  const peers = await Promise.all([
    openPagePeer(context),
    openPagePeer(context),
    openPagePeer(context),
  ])
  await Promise.all(peers.map(peer => peer.surface.emulateMedia({ reducedMotion: 'reduce' })))

  const election = await waitForSingleLeader(peers)
  const electedLeaderId = await instanceId(election.leader)
  await expectCoordination(peers, electedLeaderId, peers.length)

  const batches = peers.map((_peer, peerIndex) => (
    Array.from({ length: actionsPerPeer }, (_value, actionIndex) => `peer-${peerIndex}-action-${actionIndex}`)
  ))
  const expectedMessages = batches.flat()

  await Promise.all(peers.map((peer, index) => submitBurst(peer, batches[index]!)))

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
