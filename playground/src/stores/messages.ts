import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

import { instanceId } from '../modules/synced'

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

export const useMessagesStore = defineStore('messages', () => {
  const messages = shallowRef<Message[]>([])

  async function appendMessage(message: MessageRequest) {
    appendMessageExecutions.value += 1
    if (messages.value.some(item => item.id === message.id))
      return

    messages.value = [...messages.value, { ...message, executedBy: instanceId.slice(0, 8) }]
  }

  async function clearMessages() {
    messages.value = []
  }

  return {
    appendMessage,
    clearMessages,
    messages,
  }
}, {
  synced: {
    actions: ['appendMessage', 'clearMessages'],
    state: true,
  },
})
