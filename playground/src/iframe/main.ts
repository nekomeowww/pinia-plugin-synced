import { createPinia } from 'pinia'
import { createApp } from 'vue'

import IframeApp from './iframe-app.vue'

import { disposeSynced, synced } from '../modules/synced'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'
import '../styles/markdown.css'
import '../style.css'

const app = createApp(IframeApp)
const pinia = createPinia()

pinia.use(synced.plugin)
app.use(pinia)
app.mount('#app')

window.addEventListener('pagehide', () => {
  disposeSynced()
}, { once: true })
