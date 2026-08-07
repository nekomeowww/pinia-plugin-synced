import type { BrowserContext, Frame, Page, TestInfo } from '@playwright/test'

import { expect } from '@playwright/test'

export interface Peer<Surface extends PeerSurface = PeerSurface> {
  errors: string[]
  surface: Surface
}

export type PeerSurface = Frame | Page

export function baseURL(testInfo: TestInfo) {
  const value = testInfo.project.use.baseURL
  if (typeof value !== 'string')
    throw new Error('Playwright project must configure a string baseURL.')
  return value
}

/** Waits for every peer to observe the same leader and live participant count. */
export async function expectCoordination(peers: Peer[], leaderId: string, participantCount: number) {
  for (const peer of peers) {
    await expect(peer.surface.locator('.leader-id')).toHaveText(leaderId)
    await expect(peer.surface.locator('.participant-count')).toHaveText(String(participantCount))
  }
}

export async function expectMessages(peer: Peer, texts: string[]) {
  await expect(peer.surface.locator('.message-count')).toHaveText(`${texts.length} messages`)
  await expect(peer.surface.locator('.message-item')).toHaveCount(texts.length)
  for (const text of texts)
    await expect(peer.surface.locator('.message-list')).toContainText(text)
}

export async function openFramePeer(host: Page, name: string, url: string, errors: string[]): Promise<Peer<Frame>> {
  await host.evaluate(({ frameName, frameUrl }) => {
    const iframe = document.createElement('iframe')
    iframe.name = frameName
    iframe.src = frameUrl
    document.body.append(iframe)
  }, { frameName: name, frameUrl: url })

  await expect.poll(() => host.frames().some(frame => frame.name() === name)).toBe(true)
  const frame = host.frame({ name })
  if (!frame)
    throw new Error(`Iframe peer "${name}" did not load.`)
  await expect(frame.locator('.leadership-role')).toBeVisible()
  return { errors, surface: frame }
}

export async function openPagePeer(context: BrowserContext): Promise<Peer<Page>> {
  const page = await context.newPage()
  const errors = trackErrors(page)
  await page.goto('/?embed=false')
  await expect(page.locator('.leadership-role')).toBeVisible()
  return { errors, surface: page }
}

export async function participantId(peer: Peer) {
  const value = await peer.surface.locator('.participant-id').textContent()
  if (!value)
    throw new Error('Peer did not expose a participant ID.')
  return value
}

export async function patchMessage(peer: Peer, text: string) {
  await peer.surface.locator('.message-input').fill(text)
  await peer.surface.locator('.patch-message').click()
}

export async function sendMessage(peer: Peer, text: string) {
  await peer.surface.locator('.message-input').fill(text)
  await peer.surface.locator('.send-message').click()
}

export function trackErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error')
      errors.push(message.text())
  })
  page.on('pageerror', error => errors.push(error.message))
  return errors
}

/** Waits until the supplied browser contexts converge on exactly one leader. */
export async function waitForSingleLeader<Surface extends PeerSurface>(peers: Peer<Surface>[]) {
  await expect.poll(async () => {
    const roles = await Promise.all(peers.map(role))
    return roles.filter(value => value === 'leader').length
  }).toBe(1)

  const roles = await Promise.all(peers.map(role))
  const leaderIndex = roles.findIndex(value => value === 'leader')
  return {
    followers: peers.filter((_peer, index) => index !== leaderIndex),
    leader: peers[leaderIndex]!,
  }
}

async function role(peer: Peer) {
  return peer.surface.locator('.leadership-role').textContent()
}
