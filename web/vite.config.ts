import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.PLOU_API ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          leaflet: ['leaflet'],
        },
      },
    },
  },
});
