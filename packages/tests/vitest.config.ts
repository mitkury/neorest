import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      'neorest': path.resolve(__dirname, '../neorest/src'),
      'neorest/node': path.resolve(__dirname, '../neorest/src/node'),
      'neorest/core': path.resolve(__dirname, '../neorest/src/core'),
    }
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    watch: false,
    pool: 'threads',
    testTimeout: 30000,
    maxConcurrency: 1,
  },
});