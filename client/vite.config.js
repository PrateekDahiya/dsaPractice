import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev: /api proxied to the local Node server (same-origin in production,
// so no CORS handling is needed anywhere in the app).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 600,
  },
})
