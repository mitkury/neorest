import { sveltekit } from '@sveltejs/kit/vite';

/** @type {import('@sveltejs/kit').Config} */
import adapter from '@sveltejs/adapter-auto';

const config = {
  kit: {
    adapter: adapter()
  },
  vitePlugin: { inspector: false }
};

export default config;