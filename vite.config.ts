import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const projectRoot = process.cwd();
const apiOrigin = new URL(process.env.ATLAS_API_ORIGIN ?? 'http://127.0.0.1:8765').origin;

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    open: '/',
    strictPort: true,
    proxy: {
      '/api': {
        target: apiOrigin,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyRequest, request) => {
            if (request.headers.origin) proxyRequest.setHeader('Origin', apiOrigin);
          });
        },
      },
    },
  },
  build: {
    outDir: resolve(projectRoot, 'dist'),
    assetsDir: 'frontend-preview/assets',
    emptyOutDir: true,
    // MapLibre v5 is a prebuilt ~1,026 kB module, loaded only by the open map views.
    // Chunk grouping cannot split a single module; allow a small size margin.
    chunkSizeWarningLimit: 1100,
    rolldownOptions: {
      input: resolve(projectRoot, 'index.html'),
      output: {
        codeSplitting: {
          groups: [{ name: 'vendor', test: /[\\/]node_modules[\\/](?!maplibre-gl[\\/])/ }],
        },
      },
    },
  },
});
