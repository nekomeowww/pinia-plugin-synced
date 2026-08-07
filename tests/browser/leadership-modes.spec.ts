import { expect, test } from '@playwright/test'

import {
  expectCoordination,
  expectMessages,
  openPagePeer,
  participantId,
  sendMessage,
  waitForSingleLeader,
} from './test-utils'

test('a follower-only participant follows without entering the leadership election', async ({ context }) => {
  const follower = await openPagePeer(context, 'follower-only')

  await expect(follower.surface.locator('.leadership-role')).toHaveText('follower')

  const participant = await openPagePeer(context)
  const election = await waitForSingleLeader([follower, participant])
  const leaderId = await participantId(election.leader)
  await expectCoordination([follower, participant], leaderId, 2)

  await sendMessage(follower, 'from follower-only')
  await expectMessages(follower, ['from follower-only'])
  await expectMessages(participant, ['from follower-only'])
})

test('a leader-only participant takes over once without losing committed state', async ({ context }) => {
  const first = await openPagePeer(context)
  const initialElection = await waitForSingleLeader([first])
  const initialLeaderId = await participantId(initialElection.leader)

  await sendMessage(first, 'before takeover')
  await expectMessages(first, ['before takeover'])

  const leaderOnly = await openPagePeer(context, 'leader-only')
  const leaderOnlyId = await participantId(leaderOnly)
  await expect(leaderOnly.surface.locator('.leadership-role')).toHaveText('leader')
  await expect(first.surface.locator('.leadership-role')).toHaveText('follower')
  await expectCoordination([first, leaderOnly], leaderOnlyId, 2)
  await expectMessages(leaderOnly, ['before takeover'])

  await sendMessage(first, 'after takeover')
  await expectMessages(first, ['before takeover', 'after takeover'])
  await expectMessages(leaderOnly, ['before takeover', 'after takeover'])
  await expect(first.surface.locator('.message-executor').last()).toHaveText(leaderOnlyId)

  await leaderOnly.surface.close()
  await expect(first.surface.locator('.leadership-role')).toHaveText('leader')
  await expectCoordination([first], initialLeaderId, 1)

  expect(first.errors).toEqual([])
})

test('leader-only participants take over once in joining order', async ({ context }) => {
  const first = await openPagePeer(context, 'leader-only')
  const firstId = await participantId(first)
  await expectCoordination([first], firstId, 1)

  const second = await openPagePeer(context, 'leader-only')
  const secondId = await participantId(second)
  await expect(second.surface.locator('.leadership-role')).toHaveText('leader')
  await expect(first.surface.locator('.leadership-role')).toHaveText('follower')
  await expectCoordination([first, second], secondId, 2)

  await expect(first.surface.locator('.leadership-role')).toHaveText('follower')
  await second.surface.close()
  await expect(first.surface.locator('.leadership-role')).toHaveText('leader')
  await expectCoordination([first], firstId, 1)

  expect(first.errors).toEqual([])
})
