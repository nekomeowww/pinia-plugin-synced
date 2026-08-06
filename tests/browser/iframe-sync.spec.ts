import { expect, test } from '@playwright/test'

import {
  baseURL,
  expectCoordination,
  expectMessages,
  instanceId,
  openFramePeer,
  patchMessage,
  sendMessage,
  trackErrors,
  waitForSingleLeader,
} from './test-utils'

/**
 * Sibling same-origin iframes are independent Window and JavaScript realms, but
 * share the Web Locks and BroadcastChannel partition used by tab-election. This
 * spec verifies embedded Pinia applications separately from top-level tabs.
 */
test('executes each synced action in exactly one same-origin iframe leader', async ({ context }, testInfo) => {
  const host = await context.newPage()
  const errors = trackErrors(host)
  // A same-origin inert host keeps sibling frames in the same storage partition
  // without creating a third Pinia/tab-election participant in the top page.
  await host.goto('/iframe-host.html')
  const peerURL = new URL('/?embed=false', baseURL(testInfo)).href
  const first = await openFramePeer(host, 'first-peer', peerURL, errors)
  const second = await openFramePeer(host, 'second-peer', peerURL, errors)
  const election = await waitForSingleLeader([first, second])
  const leaderId = await instanceId(election.leader)
  const follower = election.followers[0]!
  await expectCoordination([first, second], leaderId, 2)

  await sendMessage(follower, 'iframe action')

  await expectMessages(first, ['iframe action'])
  await expectMessages(second, ['iframe action'])
  await expect(first.surface.locator('.message-executor')).toHaveText(leaderId)
  await expect(second.surface.locator('.message-executor')).toHaveText(leaderId)
  await expect(election.leader.surface.locator('.append-message-executions')).toHaveText('1')
  await expect(follower.surface.locator('.append-message-executions')).toHaveText('0')

  await patchMessage(follower, 'iframe state proposal')
  await expectMessages(first, ['iframe action', 'iframe state proposal'])
  await expectMessages(second, ['iframe action', 'iframe state proposal'])

  const latePeer = await openFramePeer(host, 'late-peer', peerURL, errors)
  await expectMessages(latePeer, ['iframe action', 'iframe state proposal'])
  await expect(latePeer.surface.locator('.append-message-executions')).toHaveText('0')
  await expectCoordination([first, second, latePeer], leaderId, 3)
  expect(errors).toEqual([])
})
