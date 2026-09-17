import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

// Transitional multi-page build: only new React entries go through Vite.
// Legacy static pages at the repo root are still served as-is.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: false,
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input: { studio: fileURLToPath(new URL('./studio.html', import.meta.url)) } },
  },
  server: { port: 5174 },
})
