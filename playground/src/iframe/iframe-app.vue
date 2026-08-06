<script setup lang="ts">
import type { AutoLayout } from 'animejs/layout'

import { createLayout } from 'animejs/layout'
import { useDark } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import {
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from 'reka-ui'
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'

import { instanceId, isLeader } from '../modules/synced'
import { useMessagesStore } from '../stores/messages'

const messagesStore = useMessagesStore()
const { messages } = storeToRefs(messagesStore)
const draft = shallowRef('')
const shortInstanceId = computed(() => instanceId.slice(0, 8))
const messageList = useTemplateRef<HTMLDivElement>('message-list')
let messageLayout: AutoLayout | undefined

useDark({ disableTransition: false })

onMounted(() => {
  if (!messageList.value)
    return

  messageLayout = createLayout(messageList.value, {
    children: '.message-item',
    duration: 350,
    ease: 'out(4)',
    enterFrom: {
      opacity: 0,
      transform: 'scaleY(0)',
    },
    leaveTo: {
      opacity: 0,
      transform: 'scaleY(0)',
    },
    swapAt: { opacity: 1 },
  })
})

onBeforeUnmount(() => messageLayout?.revert())

watch(
  () => messages.value.map(message => message.id),
  async (_messageIds, _previousMessageIds, onCleanup) => {
    if (!messageLayout)
      return

    let canceled = false
    onCleanup(() => {
      canceled = true
    })

    // The watcher runs before Vue patches the keyed buttons. Record that old
    // geometry first, then animate the new DOM after the render is committed.
    messageLayout.record()
    await nextTick()
    if (!canceled)
      messageLayout.animate()
  },
  { flush: 'pre' },
)

async function sendMessage() {
  const text = draft.value.trim()
  if (!text)
    return

  await messagesStore.appendMessage({
    createdAt: Date.now(),
    id: crypto.randomUUID(),
    sourceId: shortInstanceId.value,
    text,
  })
  draft.value = ''
}

function updateState() {
  const text = draft.value.trim()
  if (!text)
    return

  messagesStore.$patch({
    messages: [...messages.value, {
      createdAt: Date.now(),
      executedBy: shortInstanceId.value,
      id: crypto.randomUUID(),
      sourceId: shortInstanceId.value,
      text,
    }],
  })
  draft.value = ''
}
</script>

<template>
  <main :class="['h-full p-3 flex flex-col gap-3', 'bg-neutral-100 dark:bg-neutral-900']">
    <p :class="['my-0 flex items-center gap-4 text-sm']">
      <span>
        ID
        <code :class="['font-mono']">{{ shortInstanceId }}</code>
      </span>
      <span>
        Role
        <strong>{{ isLeader ? 'leader' : 'follower' }}</strong>
      </span>
    </p>

    <form :class="['flex gap-2']" @submit.prevent="sendMessage">
      <input
        v-model="draft"
        aria-label="Message"
        autocomplete="off"
        placeholder="Message"
        :class="[
          'min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-sm',
          'bg-white dark:bg-neutral-950',
          'outline outline-0 outline-offset-0 outline-transparent',
          'focus:outline-primary-500 focus:outline-offset-1 focus:outline-2',
          'transition-all duration-150 ease-in-out',
        ]"
      >
      <button
        type="submit"
        aria-label="Send by action"
        title="Send by action"
        :class="[
          'size-8 shrink-0 rounded-lg',
          'flex items-center justify-center',
          'bg-primary-500 text-white hover:bg-primary-600',
          'transition-all duration-150 ease-in-out',
          'outline-none'
        ]"
      >
        <span :class="['i-mingcute:send-plane-line size-4']" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Update state"
        title="Update state"
        :class="[
          'size-8 shrink-0 rounded-lg',
          'flex items-center justify-center',
          'bg-neutral-200 hover:bg-primary-200',
          'dark:bg-neutral-800 dark:hover:bg-primary-800',
          'transition-all duration-150 ease-in-out',
          'outline-none'
        ]"
        @click="updateState"
      >
        <span :class="['i-mingcute:edit-line size-4']" aria-hidden="true" />
      </button>
    </form>

    <TooltipProvider :delay-duration="120" :skip-delay-duration="80">
      <div
        ref="message-list"
        :class="['min-h-5 flex flex-wrap content-start items-start gap-1.5']"
      >
        <TooltipRoot v-for="message in messages" :key="message.id">
          <TooltipTrigger as-child>
            <button
              type="button"
              :aria-label="message.text"
              :class="[
                'h-5 w-2.5 rounded-sm bg-primary-400 outline-none',
                'hover:bg-primary-500 focus-visible:ring-2 focus-visible:ring-primary-500',
                'dark:bg-primary-600 dark:hover:bg-primary-500',
                'transition-all duration-150 ease-in-out',
              ]"
              class="message-item"
            >
              <span :class="['sr-only']">{{ message.text }}</span>
            </button>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent
              side="top"
              :side-offset="6"
              :class="[
                'z-20 rounded-lg px-2.5 py-2 text-xs',
                'bg-white text-neutral-900 shadow-lg dark:bg-neutral-950 dark:text-neutral-100',
              ]"
            >
              <div :class="['grid grid-cols-[auto_auto] items-baseline gap-x-3 gap-y-1']">
                <span>Sender ID</span>
                <code :class="['justify-self-end text-right font-mono']">{{ message.sourceId }}</code>
                <span>Executor ID</span>
                <code :class="['justify-self-end text-right font-mono']">{{ message.executedBy }}</code>
              </div>
              <TooltipArrow :width="8" :height="4" :class="['fill-white dark:fill-neutral-900']" />
            </TooltipContent>
          </TooltipPortal>
        </TooltipRoot>
      </div>
    </TooltipProvider>

    <span :class="['sr-only']">{{ messages.length }} messages</span>
  </main>
</template>
