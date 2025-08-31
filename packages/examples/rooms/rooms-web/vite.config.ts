import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5177
  },
  resolve: {
    alias: {
      neorest: path.resolve(__dirname, '../../../neorest/src'),
      'neorest': path.resolve(__dirname, '../../../neorest/src')
    }
  }
});