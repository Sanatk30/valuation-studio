import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the site under /<repo-name>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH || '/',
  // only the app is an entry — not the design-system mockups or the deposit copies in the repo
  optimizeDeps: { entries: ['index.html'] },
  server: {
    proxy: {
      // Yahoo Finance has no CORS headers, so the dev server fronts it.
      '/yf': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/yf/, ''),
        headers: { 'User-Agent': 'Mozilla/5.0' },
      },
    },
  },
});
