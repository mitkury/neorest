import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-auto';
import preprocess from 'svelte-preprocess';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: preprocess({ typescript: true }),
  kit: { adapter: adapter() },
  vitePlugin: { inspector: false }
};

export default config;