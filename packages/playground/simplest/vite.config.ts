import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    // Ensure Vite pre-bundles deps, but exclude our workspace package to use source build
    exclude: ['neorest']
  },
  resolve: {
    // In case Vite struggles with the symlink, force resolution to the package root
    alias: {
      neorest: '/Users/dk/repos/neorest/packages/neorest'
    }
  },
  server: {
    port: 3001,
    fs: {
      // Allow serving files from the monorepo root
      allow: ['/Users/dk/repos/neorest']
    }
  }
})
