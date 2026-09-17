import { defineConfig, type Plugin, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

// Transitional multi-page build: only new React entries go through Vite.
// Legacy static pages at the repo root are still served as-is by Vercel (see vercel.json).
const SITE_ORIGIN = 'https://www.ipzsk.com' // backend CORS/CSRF only trusts www

// Same behaviour as dev-server.mjs: pretend to be www, keep the session cookie on http://localhost.
const api: ProxyOptions = {
  target: 'https://api.ipzsk.com',
  changeOrigin: true,
  configure: proxy => {
    proxy.on('proxyReq', req => {
      req.setHeader('origin', SITE_ORIGIN)
      req.setHeader('referer', SITE_ORIGIN + '/')
    })
    proxy.on('proxyRes', res => {
      const cookies = res.headers['set-cookie']
      if (cookies) res.headers['set-cookie'] = cookies.map(c => c.replace(/;\s*Domain=[^;]*/i, '').replace(/;\s*Secure/i, ''))
    })
  },
}

// History fallback for /studio and /admin deep links in dev (Vite's SPA fallback would serve the legacy index.html).
const studioFallback: Plugin = {
  name: 'studio-fallback',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const m = req.url && /^\/(studio|admin)(\/|\?|$)/.exec(req.url)
      if (m) req.url = `/${m[1]}.html` + (req.url!.split('?')[1] ? '?' + req.url!.split('?')[1] : '')
      next()
    })
  },
}

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), studioFallback],
  publicDir: false,
  // Built files live at /dist/* on Vercel (project root is the output dir), so asset URLs need that prefix.
  base: command === 'build' ? '/dist/' : '/',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        studio: fileURLToPath(new URL('./studio.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin.html', import.meta.url)),
      },
    },
  },
  server: { port: 5174, proxy: { '/api': api, '/v1': api } },
}))
