import { cpSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

mkdirSync('dist/image-studio', { recursive: true })
cpSync('assets', 'dist/assets', { recursive: true })
cpSync('image-studio/assets', 'dist/image-studio/assets', { recursive: true })

for (const file of ['aup.html', 'pricing.html', 'privacy.html', 'terms.html', 'legal.css', 'home-downloads.css']) {
  copyFileSync(file, `dist/${file}`)
}

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { render } = await server.ssrLoadModule('/src/prerender.tsx')
  for (const page of ['home', 'workstation']) {
    const file = `dist/pages/${page}.html`
    let html = readFileSync(file, 'utf8').replace('<div id="root"></div>', () => `<div id="root">${render(page)}</div>`)
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, `${page} must have one prerendered H1`)
    assert.ok(html.includes('<main'), `${page} must contain crawlable content`)
    if (page === 'home') {
      html = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/g, tag => {
        const href = /href="([^"]+)"/.exec(tag)?.[1]
        assert.ok(href?.startsWith('/assets/'))
        return `<style>${readFileSync(`dist${href}`, 'utf8')}</style>`
      })
    }
    writeFileSync(file, html)
  }
} finally { await server.close() }

const origin = 'https://www.ipzsk.com'
const publicPages = ['/', '/workstation', '/pricing.html', '/aup.html', '/terms.html', '/privacy.html']
for (const path of publicPages.filter(p => p !== '/')) {
  const file = path === '/workstation' ? 'dist/pages/workstation.html' : `dist${path}`
  let html = readFileSync(file, 'utf8')
  const title = /<title>(.*?)<\/title>/.exec(html)?.[1]
  html = html.replace('</head>', `<link rel="canonical" href="${origin}${path}"><meta property="og:title" content="${title}"><meta property="og:url" content="${origin}${path}"><meta property="og:type" content="website"><meta property="og:image" content="${origin}/assets/ipzsk-lockup.png"><meta name="twitter:card" content="summary"></head>`)
  writeFileSync(file, html)
}
for (const page of ['account', 'developer', 'workspace']) {
  const file = `dist/pages/${page}.html`
  writeFileSync(file, readFileSync(file, 'utf8').replace('</head>', '<meta name="robots" content="noindex, follow"></head>'))
}
writeFileSync('dist/robots.txt', `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\n\nSitemap: ${origin}/sitemap.xml\n`)
writeFileSync('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicPages.map(path => `<url><loc>${origin}${path}</loc></url>`).join('')}</urlset>\n`)
