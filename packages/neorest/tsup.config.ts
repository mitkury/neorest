import { defineConfig } from 'tsup'

export default defineConfig([
  // Node.js build
  {
    entry: {
      'index': 'src/index.ts',
      'node': 'src/node/index.ts',
      'core': 'src/core/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: false,
    splitting: false,
    sourcemap: true,
    clean: true,
    treeshake: true,
    external: ['ws'],
    outDir: 'dist',
    target: 'node18',
    platform: 'node',
    outExtension({ format }) {
      return {
        js: format === 'esm' ? '.mjs' : '.cjs',
      }
    },
  },
  // Browser build
  {
    entry: {
      'index.browser': 'src/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: false,
    splitting: false,
    sourcemap: true,
    clean: false,
    treeshake: true,
    external: [],
    outDir: 'dist',
    target: 'es2020',
    platform: 'browser',
  },
  // Deno build
  {
    entry: {
      'mod': 'src/index.ts',
    },
    format: ['esm'],
    dts: false,
    splitting: false,
    sourcemap: true,
    clean: false,
    treeshake: true,
    external: [],
    outDir: 'deno',
    target: 'es2020',
    platform: 'neutral',
  },
])