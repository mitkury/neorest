import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    watch: false,
    pool: 'threads',
    testTimeout: 30000,
  },
});