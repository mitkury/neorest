import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'mod': 'src/index.ts',
  },
  format: ['esm'],
  dts: false, // Disable DTS for now to avoid TypeScript issues
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: [],
  outDir: 'deno',
  target: 'es2020',
  platform: 'neutral',
  esbuildOptions(options) {
    // Remove banner to avoid warnings
  },
})