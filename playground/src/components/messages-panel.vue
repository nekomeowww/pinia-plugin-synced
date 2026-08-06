<script setup lang="ts">
import type { JSAnimation } from 'animejs'
import type { AutoLayout } from 'animejs/layout'

import { animate } from 'animejs'
import { createLayout } from 'animejs/layout'
import { usePreferredReducedMotion } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, onMounted, shallowReactive, shallowRef, useTemplateRef, watch } from 'vue'

import { instanceId } from '../modules/synced'
import { appendMessageExecutions, useMessagesStore } from '../stores/messages'

const messagesStore = useMessagesStore()
const { messages } = storeToRefs(messagesStore)
const draft = shallowRef('')
const shortInstanceId = computed(() => instanceId.slice(0, 8))
const reducedMotion = usePreferredReducedMotion()
const messageList = useTemplateRef<HTMLOListElement>('message-list')
const messageCountValue = useTemplateRef<HTMLSpanElement>('message-count-value')
const animatedMessageCount = shallowReactive({ value: messages.value.length })
let messageLayout: AutoLayout | undefined
let messageCountAnimation: JSAnimation | undefined
let messageCountValueAnimation: JSAnimation | undefined

onMounted(() => {
  if (!messageList.value)
    return

  messageLayout = createLayout(messageList.value, {
    children: '.message-item',
    duration: 400,
    ease: 'out(4)',
    enterFrom: {
      opacity: 0,
      transform: 'translateY(8px) scale(.98)',
    },
    leaveTo: {
      opacity: 0,
      transform: 'translateY(-8px) scale(.98)',
    },
    swapAt: { opacity: 1 },
  })
})

onBeforeUnmount(() => {
  messageLayout?.revert()
  messageCountAnimation?.cancel()
  messageCountValueAnimation?.cancel()
})

watch(
  () => messages.value.map(message => message.id),
  async (_messageIds, _previousMessageIds, onCleanup) => {
    if (!messageLayout || reducedMotion.value === 'reduce')
      return

    let canceled = false
    onCleanup(() => {
      canceled = true
    })

    messageLayout.record()
    await nextTick()
    if (!canceled)
      messageLayout.animate()
  },
  { flush: 'pre' },
)

watch(
  () => messages.value.length,
  (messageCount) => {
    messageCountAnimation?.cancel()
    messageCountValueAnimation?.cancel()
    if (reducedMotion.value === 'reduce') {
      animatedMessageCount.value = messageCount
      return
    }

    messageCountAnimation = animate(animatedMessageCount, {
      value: messageCount,
      duration: 350,
      ease: 'out(4)',
      modifier: value => Math.round(value),
    })

    if (messageCountValue.value) {
      messageCountValueAnimation = animate(messageCountValue.value, {
        opacity: [0.4, 1],
        scale: [1.2, 1],
        y: ['-.25em', '0em'],
        duration: 350,
        ease: 'out(4)',
      })
    }
  },
)

async function appendMessage() {
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

async function clearMessages() {
  await messagesStore.clearMessages()
}

function patchMessage() {
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
  <p :class="['my-0 pb-4']">
    Send an action or patch state directly. Local action executions:
    <code :class="['append-message-executions rounded bg-neutral-200 px-1.5 py-0.5 font-mono dark:bg-neutral-800']">{{ appendMessageExecutions }}</code>
  </p>

  <form @submit.prevent="appendMessage">
    <label for="message" :class="['mb-2 block']">
      Message
    </label>
    <div :class="['flex flex-col gap-2 sm:flex-row']">
      <input
        id="message"
        v-model="draft"
        placeholder="Type a message"
        autocomplete="off"
        :class="[
          'message-input',
          'min-w-0 flex-1 rounded-lg px-3 py-2',
          'bg-neutral-100 dark:bg-neutral-800',
          'outline outline-0 outline-offset-0 outline-transparent',
          'focus:outline-primary-500 focus:outline-offset-1 focus:outline-2',
          'transition-all duration-150 ease-in-out',
        ]"
      >
      <button
        type="submit"
        :class="[
          'send-message',
          'rounded-lg bg-primary-500 px-4 py-2 text-primary-50',
          'hover:bg-primary-600 dark:bg-primary-600 dark:hover:bg-primary-500',
          'transition-all duration-150 ease-in-out',
          'outline-none'
        ]"
      >
        Send by action
      </button>
      <button
        type="button"
        :class="[
          'patch-message',
          'rounded-lg bg-neutral-200 px-4 py-2 dark:bg-neutral-800',
          'hover:bg-primary-200 dark:hover:bg-primary-800',
          'transition-all duration-150 ease-in-out',
          'outline-none'
        ]"
        @click="patchMessage"
      >
        Send by state update
      </button>
    </div>
  </form>

  <div
    :class="[
      'mt-6 border-t border-neutral-200 pt-4 dark:border-neutral-800',
      'flex items-center justify-between gap-4',
    ]"
  >
    <span :class="['message-count']">
      <span ref="message-count-value" :class="['message-count-value inline-block tabular-nums']">{{ animatedMessageCount.value }}</span> messages
    </span>
    <button
      type="button"
      :disabled="messages.length === 0"
      :class="[
        'clear-messages',
        'rounded-lg bg-neutral-200 px-3 py-2 text-sm dark:bg-neutral-800',
        'disabled:cursor-not-allowed disabled:opacity-45',
        'transition-all duration-150 ease-in-out',
        'outline-none'
      ]"
      @click="clearMessages"
    >
      Clear in every tab
    </button>
  </div>

  <ol
    ref="message-list"
    :class="[
      'message-list',
      'm-0 grid list-none gap-2 p-0',
      messages.length ? 'mt-4' : '',
    ]"
  >
    <li
      v-for="message in messages"
      :key="message.id"
      :class="[
        'message-item',
        'rounded-lg px-4 py-3',
        'flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4',
        'bg-primary-50/50 dark:bg-primary-950/50',
      ]"
    >
      <span>{{ message.text }}</span>
      <small :class="['shrink-0 text-xs text-neutral-500 dark:text-neutral-400']">
        from <span :class="[
          'px-1 py-0.5',
          'rounded-md',
          instanceId.startsWith(message.sourceId) ? 'bg-primary-100 text-primary-700' : '',
          instanceId.startsWith(message.sourceId) ? 'dark:bg-primary-900 dark:text-primary-300' : ''
        ]">{{ message.sourceId }}</span> · applied by
        <span
          :class="[
            'message-executor',
            'font-mono text-primary-700 dark:text-primary-300',
            'px-1 py-0.5',
            'rounded-md',
            instanceId.startsWith(message.executedBy) ? 'bg-primary-100 text-primary-700' : '',
            instanceId.startsWith(message.executedBy) ? 'dark:bg-primary-900 dark:text-primary-300' : ''
          ]"
        >
          {{ message.executedBy }}
        </span>
      </small>
    </li>
  </ol>
  <p
    v-if="!messages.length"
    :class="[
      'mb-0 mt-4 rounded-lg-neutral-300 px-4 py-8',
      'text-center text-neutral-500 dark:text-neutral-400',
    ]"
  >
    Messages from every participating context will appear here.
  </p>
</template>
