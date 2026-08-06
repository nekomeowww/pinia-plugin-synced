import { defineConfig } from 'tsdown'

export default defineConfig({
  clean: true,
  deps: {
    neverBundle: [
      '@moeru/std',
      'es-toolkit',
      'pinia',
      'tab-election',
      'vue',
    ],
  },
  dts: true,
  entry: ['./src/index.ts'],
  format: ['esm'],
  sourcemap: true,
})
