import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-auto';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: { adapter: adapter() },
  vitePlugin: { inspector: false }
};

export default config;