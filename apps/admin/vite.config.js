import { defineConfig } from 'vite';

// The admin is served at /admin/ by Caddy and talks to /api/admin/* on the same origin.
export default defineConfig({
  base: '/admin/',
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
