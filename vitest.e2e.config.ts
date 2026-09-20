import { defineConfig } from 'vitest/config'

// Browser regression suite against the running dev server (E2E_BASE_URL, default http://localhost:5174).
// One Chromium for the whole run (global setup), files run one after another to keep memory low.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/**/*.e2e.ts'],
    globalSetup: ['e2e/support/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
