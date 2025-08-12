import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@neorest/core': path.resolve(__dirname, '../core/src'),
      '@neorest/router-core': path.resolve(__dirname, '../router-core/src'),
      '@neorest/router-node': path.resolve(__dirname, '../router-node/src'),
      'neorest': path.resolve(__dirname, '../neorest/src'),
    }
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    watch: false,
    pool: 'threads',
    testTimeout: 30000,
  },
});