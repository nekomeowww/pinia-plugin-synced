<script setup lang="ts">
interface Props {
  /** Iconify utility class rendered before the project name. */
  icon: string
  /** Project URL opened in a separate browser context. */
  href: string
}

defineProps<Props>()
</script>

<template>
  <a
    :href="href"
    target="_blank"
    rel="noopener noreferrer"
    :class="[
      'icon-span inline-flex items-baseline gap-1 align-baseline font-medium no-underline',
      'hover:underline underline-offset-2',
      'focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current',
    ]"
  >
    <span :class="[icon, 'size-4 self-center']" aria-hidden="true" />
    <span><slot /></span>
  </a>
</template>
