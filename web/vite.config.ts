import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const apiTarget = process.env.PLOU_API ?? 'http://127.0.0.1:8787';
const webRoot = fileURLToPath(new URL('.', import.meta.url));

interface ManifestEntry {
  file: string;
  css?: string[];
  assets?: string[];
}

const SHELL_FILES = [
  'index.html',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'fonts/roboto-latin.woff2',
  'fonts/roboto-latin-ext.woff2',
] as const;

/** Inyecta en el service worker todos los bundles con hash del build. */
function serviceWorkerAssets(): Plugin {
  return {
    name: 'plou-service-worker-assets',
    apply: 'build',
    async closeBundle() {
      const dist = resolve(webRoot, 'dist');
      const manifestText = await readFile(resolve(dist, '.vite/manifest.json'), 'utf8');
      const manifest = JSON.parse(manifestText) as Record<string, ManifestEntry>;
      const assets = [
        ...new Set(
          Object.values(manifest).flatMap((entry) => [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]),
        ),
      ]
        .sort()
        .map((path) => `/${path}`);
      const buildHash = createHash('sha256').update(manifestText);
      for (const path of SHELL_FILES) buildHash.update(await readFile(resolve(dist, path)));
      const buildId = buildHash.digest('hex').slice(0, 12);
      const swPath = resolve(dist, 'sw.js');
      const sw = await readFile(swPath, 'utf8');
      await writeFile(
        swPath,
        sw
          .replace("'__PLOU_BUILD_ID__'", JSON.stringify(buildId))
          .replace('/* __PLOU_BUILD_ASSETS__ */ []', JSON.stringify(assets)),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorkerAssets()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    manifest: true,
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
