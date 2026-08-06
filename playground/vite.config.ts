import { fileURLToPath, URL } from 'node:url'

import Shiki from '@shikijs/markdown-it'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import Markdown from 'unplugin-vue-markdown/vite'

import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        iframe: fileURLToPath(new URL('./iframe.html', import.meta.url)),
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
      },
    },
  },
  plugins: [
    vue({
      include: [/\.vue$/, /\.md(?:$|\?)/],
    }),
    Markdown({
      include: /\.md(?:$|\?)/,
      markdownItUses: [
        await Shiki({
          themes: {
            dark: 'catppuccin-mocha',
            light: 'catppuccin-latte',
          },
        }),
      ],
    }),
    UnoCSS({
      configFile: fileURLToPath(new URL('./uno.config.ts', import.meta.url)),
    }),
  ],
  resolve: {
    alias: {
      'pinia-plugin-synced': fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    },
  },
})
