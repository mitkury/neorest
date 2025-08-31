import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'index.browser': 'src/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: false, // Disable DTS for now to avoid TypeScript issues
  splitting: false,
  sourcemap: true,
  clean: false, // Don't clean since we're building alongside other configs
  treeshake: true,
  external: [], // No external dependencies for browser
  outDir: 'dist',
  target: 'es2020',
  platform: 'browser',
  esbuildOptions(options) {
    // Remove banner to avoid warnings
  },
})