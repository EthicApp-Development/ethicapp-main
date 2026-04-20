import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => {
  const isDev = command === 'serve';

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true
    },
    base: isDev ? '/' : '/auth-assets/'
  };
});