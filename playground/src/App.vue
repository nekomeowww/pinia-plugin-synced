<script setup lang="ts">
import { useDark, useToggle } from '@vueuse/core'

import IframeConnections from './components/iframe-connections.vue'
import InstallLibrary from './components/install-library.vue'
import MessagesPanel from './components/messages-panel.vue'
import GettingStarted from './docs/getting-started.md'
import Introduction from './docs/introduction.md'
import Ending from './docs/ending.md'
import { isLeader, leaderId, participantCount, participantId } from './modules/synced'

const isDark = useDark({ disableTransition: false })
const toggleDark = useToggle(isDark)
const showEmbeddedPeer = new URLSearchParams(window.location.search).get('embed') !== 'false'

function openPeerWindow() {
  const peerUrl = new URL(window.location.href)
  peerUrl.searchParams.set('embed', 'false')
  window.open(peerUrl, 'pinia-plugin-synced-peer', 'popup,width=720,height=1080')?.focus()
}
</script>

<template>
  <div>
    <header :class="['sticky left-0 top-0 z-10 w-full px-4 pb-0 pt-2']">
      <div
        :class="[
          'mx-auto max-w-screen-lg rounded-xl p-4',
          'flex items-center gap-2',
          'bg-neutral-100/80 dark:bg-neutral-800/50 backdrop-blur-md',
        ]"
      >
        <h1 :class="['m-0 flex-1 text-2xl']">
          Pinia Plugin Synced
        </h1>
        <div :class="['flex flex-row items-center gap-2']">
          <button
            :class="['size-8 flex items-center justify-center text-lg outline-none']"
            type="button"
            :aria-label="isDark ? 'Use light theme' : 'Use dark theme'"
            @click="toggleDark()"
          >
            <span v-if="isDark" :class="['i-solar:moon-stars-bold-duotone size-5']" aria-hidden="true" />
            <span v-else :class="['i-solar:sun-bold size-5']" aria-hidden="true" />
          </button>
          <a
            href="https://github.com/nekomeowww/pinia-plugin-synced"
            :class="['size-8 flex items-center justify-center text-lg outline-none']"
            aria-label="Open the GitHub repository"
          >
            <span :class="['i-simple-icons:github size-5']" aria-hidden="true" />
          </a>
        </div>
      </div>
    </header>

    <main :class="['mx-auto max-w-screen-lg px-4 pb-4 pt-0']">
      <Introduction />

      <section :class="['py-5 text-base leading-relaxed']">
        <h2 :class="['my-0 pb-4 text-2xl']">
          Playground
        </h2>

        <p :class="['my-2']">
          The current tab is
          <code :class="['participant-id rounded-lg bg-primary-200 px-2 py-1 font-mono dark:bg-primary']">
            {{ participantId.slice(0, 8) }}
          </code>
          and is currently the
          <strong :class="['leadership-role text-primary-700 dark:text-primary-300']">{{ isLeader ? 'leader' : 'follower' }}</strong>.
        </p>
        <p :class="['my-2 text-neutral-600 dark:text-neutral-300']">
          Open this page in another tab ->
          <button
            type="button"
            :class="[
              'rounded-lg px-2 py-1 align-middle text-sm',
              'inline-flex items-center gap-1.5',
              'bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100',
              'hover:bg-neutral-200 dark:hover:bg-neutral-700',
              'outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
              'transition-colors duration-150',
            ]"
            @click="openPeerWindow"
          >
            <span :class="['i-mingcute:external-link-line size-4']" aria-hidden="true" />
            <span>Open peer window</span>
          </button>
          <br />
          Each page owns a separate Pinia, while registered actions execute in the elected leader.
        </p>
        <br />
        <p :class="['my-2 text-neutral-600 dark:text-neutral-300']">
          Leader
          <code :class="['leader-id font-mono text-primary']">{{ leaderId?.slice(0, 8) ?? 'electing' }}</code>,
          in total <span :class="['participant-count text-primary']">{{ participantCount }}</span>
          {{ participantCount === 1 ? 'participant (tab/iframe/window)' : 'participants (tabs/iframes/windows)' }}.
        </p>
      </section>

      <MessagesPanel />
      <IframeConnections v-if="showEmbeddedPeer" />

      <section :class="['py-5']">
        <h2 :class="['my-0 pb-4 text-2xl']">
          Install
        </h2>

        <InstallLibrary />
      </section>

      <GettingStarted />
      <Ending />
    </main>
  </div>
</template>
