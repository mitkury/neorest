import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'node': 'src/node/index.ts',
    'core': 'src/core/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: false, // Disable DTS for now to avoid TypeScript issues
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ['ws'],
  outDir: 'dist',
  target: 'node18',
  platform: 'node',
  esbuildOptions(options) {
    // Remove banner to avoid warnings
  },
})