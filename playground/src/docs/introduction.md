<script setup>
import IconSpan from '../components/icon-span.vue'
</script>

## One Pinia state across every browser context

> This includes tabs, windows, and iframes of the same origin, applies to Electron too.

Have you ever tried to build a web application that needs to share the same state across multiple browser contexts?

- For example, multiple tabs and you want to keep them synced.
- For example, an <IconSpan icon="i-simple-icons:electron" :class="['text-[#47848f] dark:text-[#9feaf9]']" href="https://www.electronjs.org/">Electron</IconSpan> app opens many windows in parallel while keeping the same <IconSpan icon="i-simple-icons:pinia" :class="['text-[#c28c00] dark:text-[#ffd859]']" href="https://pinia.vuejs.org/">Pinia</IconSpan> or <IconSpan icon="i-mingcute:bear-line" :class="['text-[#443e38] dark:text-[#e7d7c1]']" href="https://github.com/pmndrs/zustand">Zustand</IconSpan> state across all of them.
