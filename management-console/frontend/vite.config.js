import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import nginxStaticAssets from './vite/nginx-static-assets.js';

export default defineConfig({
  // The shared logo, favicons, manifest and font from nginx/static, under
  // `vite` and `vite preview` only (#999).
  plugins: [react(), nginxStaticAssets()],
  base: '/mng/',
  server: {
    host: '0.0.0.0',
    port: 5175,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
