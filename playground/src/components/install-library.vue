<script setup lang="ts">
import { TabsContent, TabsIndicator, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'

const packageManagers = [
  {
    command: 'npm install pinia-plugin-synced',
    icon: 'i-simple-icons:npm',
    label: 'npm',
    value: 'npm',
  },
  {
    command: 'pnpm add pinia-plugin-synced',
    icon: 'i-simple-icons:pnpm',
    label: 'pnpm',
    value: 'pnpm',
  },
  {
    command: 'yarn add pinia-plugin-synced',
    icon: 'i-simple-icons:yarn',
    label: 'Yarn',
    value: 'yarn',
  },
  {
    command: 'bun add pinia-plugin-synced',
    icon: 'i-simple-icons:bun',
    label: 'Bun',
    value: 'bun',
  },
] as const
</script>

<template>
  <TabsRoot default-value="pnpm" :class="['w-full']">
    <TabsList
      aria-label="Select a package manager"
      :class="[
        'relative w-full rounded-xl p-1 sm:w-fit',
        'grid grid-cols-4',
        'bg-neutral-100 dark:bg-neutral-800',
      ]"
    >
      <TabsIndicator
        :class="[
          'pointer-events-none absolute inset-y-1 left-0',
          'w-[var(--reka-tabs-indicator-size)] translate-x-[var(--reka-tabs-indicator-position)]',
          'transition-[width,transform] duration-300 ease-out',
        ]"
      >
        <div :class="['h-full w-full rounded-lg bg-white shadow-sm dark:bg-neutral-700']" />
      </TabsIndicator>

      <TabsTrigger
        v-for="packageManager in packageManagers"
        :key="packageManager.value"
        :value="packageManager.value"
        :class="[
          'relative z-1 min-w-20 rounded-lg px-3 py-2',
          'flex items-center justify-center gap-2',
          'text-sm text-neutral-500 dark:text-neutral-400',
          'data-[state=active]:text-neutral-950 dark:data-[state=active]:text-white',
          'hover:text-primary-700 dark:hover:text-primary-300',
          'outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
          'transition-colors duration-200',
        ]"
      >
        <span :class="[packageManager.icon, 'size-4']" aria-hidden="true" />
        <span>{{ packageManager.label }}</span>
      </TabsTrigger>
    </TabsList>

    <TabsContent
      v-for="packageManager in packageManagers"
      :key="packageManager.value"
      :value="packageManager.value"
      :class="[
        'mt-3 rounded-xl px-4 py-3',
        'bg-neutral-100 dark:bg-neutral-800',
        'outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
      ]"
    >
      <code :class="['install-command-text block font-mono text-sm sm:text-base']">
        <span aria-hidden="true" :class="['select-none text-neutral-400']">$ </span>{{ packageManager.command }}
      </code>
    </TabsContent>
  </TabsRoot>
</template>

<style scoped>
.install-command-text {
  animation: install-command-enter 300ms ease-in-out;
}

@keyframes install-command-enter {
  from {
    opacity: 0;
    filter: blur(4px);
  }

  to {
    opacity: 1;
    filter: blur(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .install-command-text {
    animation: none;
  }
}
</style>
