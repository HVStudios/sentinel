import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves project sites under /<repo>/.
  base: process.env.VITE_BASE ?? '/',
  server: {
    port: 5173,
    proxy: { '/api': `http://127.0.0.1:${process.env.PORT ?? 8787}` },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
