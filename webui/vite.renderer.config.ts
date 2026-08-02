import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const apiPort = process.env.CB8_PORT ?? '8008';

export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Split the stable framework code into its own cacheable chunks so app
        // updates don't re-download them, and the app chunk stays small. The
        // heavy reader libraries (epub.js, pdf.js) are NOT listed here — they
        // already split into lazy chunks via the React.lazy readers and must
        // not be pulled into an eagerly-loaded vendor chunk.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query', 'zustand'],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': `http://localhost:${apiPort}`, // dev: proxy API to embedded server
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },
});
