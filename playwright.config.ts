import { defineConfig } from '@playwright/test'

export default defineConfig({
  fullyParallel: false,
  reporter: 'list',
  testDir: './tests/browser',
  use: {
    baseURL: 'http://127.0.0.1:43017',
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: './node_modules/.bin/vite playground --host 127.0.0.1 --port 43017 --strictPort',
    reuseExistingServer: false,
    url: 'http://127.0.0.1:43017',
  },
  workers: 1,
})
