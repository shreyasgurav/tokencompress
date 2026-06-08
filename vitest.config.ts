import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.validation.ts', 'tests/**/*.hardtest.ts'],
    environment: 'node',
  },
})
