import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Unit tests use the static case manifest (the API is the app default).
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'], env: { VITE_CASES_SOURCE: 'static' } },
})
