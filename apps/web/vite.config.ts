/// <reference types="vitest/config" />
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: { '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:4000' },
  },
  preview: { port: 4173, proxy: { '/api': 'http://localhost:4000' } },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Framework code changes rarely: its own long-cached chunks; pages are split per route (routes.tsx).
        manualChunks(id) {
          if (/\/node_modules\/(react|react-dom|react-router|scheduler)\//.test(id)) return 'react';
          if (/\/node_modules\/(zod|decimal\.js|@tanstack\/[^/]+|react-hook-form|@hookform\/[^/]+)\//.test(id)) return 'vendor';
          return undefined;
        },
      },
    },
  },
  // Unit tests only; e2e/ is Playwright (pnpm e2e).
  test: { include: ['src/**/*.test.{ts,tsx}'] },
});
