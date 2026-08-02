import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'esnext',
  },
  resolve: {
    alias: [{
      find: /^neorest$/,
      replacement: fileURLToPath(new URL('../../neorest/src/browser/index.ts', import.meta.url)),
    }],
  },
  server: {
    port: 3001,
    fs: {
      allow: [fileURLToPath(new URL('../..', import.meta.url))],
    },
  },
});
