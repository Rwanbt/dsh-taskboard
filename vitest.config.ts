import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup-storage.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text-summary', 'json-summary'],
    },
  },
})
