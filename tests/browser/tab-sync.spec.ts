import { expect, test } from '@playwright/test'

import {
  expectCoordination,
  expectMessages,
  openPagePeer,
  participantId,
  patchMessage,
  sendMessage,
  waitForSingleLeader,
} from './test-utils'

/**
 * This spec intentionally uses Playwright Test instead of Vitest Browser Mode.
 * Vitest Browser Mode runs against real Web Platform APIs, but its public test
 * context does not expose the provider's BrowserContext/newPage lifecycle.
 * Playwright lets the test own independent top-level pages and close the active
 * leader, which is required to verify real tab election and failover.
 */
test('executes each synced action in exactly one tab leader across failover', async ({ context }) => {
  const first = await openPagePeer(context)
  const second = await openPagePeer(context)
  const initialElection = await waitForSingleLeader([first, second])
  const initialLeaderId = await participantId(initialElection.leader)
  const initialFollower = initialElection.followers[0]!
  await expectCoordination([first, second], initialLeaderId, 2)

  await sendMessage(initialFollower, 'from follower')

  await expectMessages(first, ['from follower'])
  await expectMessages(second, ['from follower'])
  await expect(first.surface.locator('.message-executor')).toHaveText(initialLeaderId)
  await expect(second.surface.locator('.message-executor')).toHaveText(initialLeaderId)
  await expect(initialElection.leader.surface.locator('.append-message-executions')).toHaveText('1')
  await expect(initialFollower.surface.locator('.append-message-executions')).toHaveText('0')

  const initialFollowerId = await participantId(initialFollower)
  await patchMessage(initialFollower, 'direct state proposal')
  await expectMessages(first, ['from follower', 'direct state proposal'])
  await expectMessages(second, ['from follower', 'direct state proposal'])
  await expect(first.surface.locator('.message-executor').last()).toHaveText(initialFollowerId)
  await expect(second.surface.locator('.message-executor').last()).toHaveText(initialFollowerId)

  const latePeer = await openPagePeer(context)
  await expectMessages(latePeer, ['from follower', 'direct state proposal'])
  await expect(latePeer.surface.locator('.append-message-executions')).toHaveText('0')
  await expectCoordination([first, second, latePeer], initialLeaderId, 3)

  await initialElection.leader.surface.close()
  const survivors = [initialFollower, latePeer]
  const successorElection = await waitForSingleLeader(survivors)
  const successorId = await participantId(successorElection.leader)
  expect(successorId).not.toBe(initialLeaderId)
  await expectCoordination(survivors, successorId, 2)

  await sendMessage(successorElection.followers[0]!, 'after failover')

  for (const peer of survivors) {
    await expectMessages(peer, ['from follower', 'direct state proposal', 'after failover'])
    await expect(peer.surface.locator('.message-executor').last()).toHaveText(successorId)
  }
  await expect(successorElection.leader.surface.locator('.append-message-executions')).toHaveText('1')
  await expect(successorElection.followers[0]!.surface.locator('.append-message-executions')).toHaveText('0')

  expect([first, second, latePeer].flatMap(peer => peer.errors)).toEqual([])
})
