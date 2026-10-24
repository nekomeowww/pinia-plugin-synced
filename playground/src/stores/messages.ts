import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

import { narratorRole, participantId } from '../modules/synced'

export interface Message {
  createdAt: number
  executedBy: string
  id: string
  sourceId: string
  text: string
}

export type MessageRequest = Omit<Message, 'executedBy'>

/** Process-local diagnostic kept outside Pinia so synchronized state cannot overwrite it. */
export const appendMessageExecutions = shallowRef(0)
export const narrateMessageExecutions = shallowRef(0)

export const useMessagesStore = defineStore('messages', () => {
  const messages = shallowRef<Message[]>([])

  async function appendMessage(message: MessageRequest) {
    appendMessageExecutions.value += 1
    if (messages.value.some(item => item.id === message.id))
      return

    messages.value = [...messages.value, { ...message, executedBy: participantId.slice(0, 8) }]
  }

  /**
   * Runs only in a participant that holds the narrator role.
   * It streams the text word by word, as a chat reply streams tokens.
   */
  async function narrateMessage(message: MessageRequest) {
    narrateMessageExecutions.value += 1
    const words = message.text.split(/\s+/)
    messages.value = [...messages.value, { ...message, executedBy: participantId.slice(0, 8), text: words[0] ?? '' }]

    for (let index = 1; index < words.length; index++) {
      await new Promise(resolve => setTimeout(resolve, 5))
      messages.value = messages.value.map(item => item.id === message.id
        ? { ...item, text: words.slice(0, index + 1).join(' ') }
        : item)
    }
  }

  async function clearMessages() {
    messages.value = []
  }

  return {
    appendMessage,
    clearMessages,
    messages,
    narrateMessage,
  }
}, {
  synced: {
    actions: {
      appendMessage: {},
      clearMessages: {},
      narrateMessage: { fallback: 'reject', roles: [narratorRole] },
    },
    state: true,
  },
})
