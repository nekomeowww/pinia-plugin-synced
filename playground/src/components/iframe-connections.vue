<script setup lang="ts">
import type { AutoLayout } from 'animejs/layout'

import { createLayout } from 'animejs/layout'
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef } from 'vue'

const iframeIds = shallowRef([crypto.randomUUID()])
const iframeGrid = useTemplateRef<HTMLDivElement>('iframe-grid')
const gridColumns = computed(() => {
  if (iframeIds.value.length === 1)
    return 'grid-cols-1'
  if (iframeIds.value.length === 2)
    return 'grid-cols-1 sm:grid-cols-2'
  return 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3'
})
let layout: AutoLayout | undefined

onMounted(() => {
  if (!iframeGrid.value)
    return

  layout = createLayout(iframeGrid.value, {
    children: 'iframe',
    duration: 550,
    ease: 'out(4)',
    enterFrom: {
      opacity: 0,
      transform: 'scale(.96)',
    },
    swapAt: { opacity: 1 },
  })
})

onBeforeUnmount(() => layout?.revert())

async function addIframe() {
  // Vue commits the new iframe and column class asynchronously, so Auto Layout
  // measures before the state change and animates after the next DOM update.
  layout?.record()
  iframeIds.value = [...iframeIds.value, crypto.randomUUID()]
  await nextTick()
  layout?.animate()
}
</script>

<template>
  <section :class="['py-5']">
    <div :class="['mb-4 flex items-center justify-between gap-4']">
      <h2 :class="['my-0 text-2xl']">
        Connect iframes
      </h2>
      <button
        type="button"
        :class="[
          'rounded-lg px-3 py-2',
          'flex items-center gap-1.5',
          'bg-neutral-200 hover:bg-primary-200 dark:bg-neutral-800 dark:hover:bg-primary-800',
          'transition-all duration-150 ease-in-out',
          'outline-none'
        ]"
        @click="addIframe"
      >
        <span :class="['i-mingcute:plus-line size-4']" aria-hidden="true" />
        <span>Add</span>
      </button>
    </div>

    <div
      ref="iframe-grid"
      :class="[
        'grid gap-3',
        gridColumns,
      ]"
    >
      <iframe
        v-for="(iframeId, index) in iframeIds"
        :key="iframeId"
        src="/iframe.html"
        :name="`iframe-peer-${iframeId}`"
        :title="`Synchronized Pinia iframe ${index + 1}`"
        :class="[
          'h-32 w-full rounded-xl outline-none border-none',
          'bg-neutral-100 dark:bg-neutral-950',
        ]"
      />
    </div>
  </section>
</template>
