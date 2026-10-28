import type { BrowserContext } from '@playwright/test'

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

/**
 * Holds the leader lock from a page that runs no sync runtime, like a leader page that is still unloading. It never
 * sends committed state. Returns a function that releases the lock.
 */
async function holdStaleLeaderLock(context: BrowserContext) {
  const page = await context.newPage()
  await page.goto('/?embed=false&leadership=follower-only')
  await expect(page.locator('.leadership-role')).toBeVisible()
  await page.evaluate(() => new Promise<void>((resolve) => {
    void navigator.locks.request('tab-pinia-plugin-synced:playground', { steal: true }, () => new Promise<void>((release) => {
      ;(window as unknown as { releaseStaleLeaderLock: () => void }).releaseStaleLeaderLock = release
      resolve()
    }))
  }))

  return async () => {
    await page.evaluate(() => (window as unknown as { releaseStaleLeaderLock: () => void }).releaseStaleLeaderLock())
  }
}

test('a leader-only participant takes over as soon as a stale leader lock is released', async ({ context }) => {
  const releaseStaleLeaderLock = await holdStaleLeaderLock(context)

  const follower = await openPagePeer(context, 'follower-only')
  const leaderOnly = await openPagePeer(context, 'leader-only')
  await expect(leaderOnly.surface.locator('.leadership-role')).toHaveText('follower')

  // An action that a follower starts while no participant leads must run once the leader-only participant leads.
  await sendMessage(follower, 'during the gap')
  await releaseStaleLeaderLock()

  // The call timeout of the playground is 30 seconds. The takeover must not wait for it.
  await expect(leaderOnly.surface.locator('.leadership-role')).toHaveText('leader', { timeout: 5_000 })
  await expectMessages(follower, ['during the gap'])
  await expectMessages(leaderOnly, ['during the gap'])

  expect(follower.errors).toEqual([])
  expect(leaderOnly.errors).toEqual([])
})

test('a leader-only participant leads again after every participant reloads at once', async ({ context }) => {
  const leaderOnly = await openPagePeer(context, 'leader-only')
  const follower = await openPagePeer(context, 'follower-only')
  await expectCoordination([leaderOnly, follower], await participantId(leaderOnly), 2)

  await Promise.all([leaderOnly.surface.reload(), follower.surface.reload()])
  await sendMessage(follower, 'after reload')

  await expect(leaderOnly.surface.locator('.leadership-role')).toHaveText('leader', { timeout: 5_000 })
  await expectMessages(follower, ['after reload'])
  await expectMessages(leaderOnly, ['after reload'])
})
