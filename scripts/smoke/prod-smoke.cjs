#!/usr/bin/env node
// 只读冒烟：页面加载 / CSP / 公开案例签名 URL / 鉴权 / CORS 预检 / mock 开关。见 docs/deploy-runbook.md §6、§7。
//   BASE_URL=https://www.ipzsk.com API_URL=https://api.ipzsk.com node scripts/smoke/prod-smoke.cjs
// 本地（不碰生产）：BASE_URL=http://localhost:5174 API_URL=http://127.0.0.1:9 BLOCK_API=1 node scripts/smoke/prod-smoke.cjs
// 绝不登录、绝不写：浏览器里非 GET/HEAD/OPTIONS 的请求一律拦下并记录；Node 侧只发 GET 与 OPTIONS。
// 输出一份 JSON；有 failures 时退出码 1。
let playwright
try { playwright = require('/Users/icycat/projects/opencontext/node_modules/playwright-core') } catch { playwright = require('playwright-core') }

const BASE = (process.env.BASE_URL || 'https://www.ipzsk.com').replace(/\/$/, '')
const API = (process.env.API_URL || 'https://api.ipzsk.com').replace(/\/$/, '')
const BLOCK_API = process.env.BLOCK_API === '1' // 本地：浏览器里的 /api/、/v1/ 不放行（vite 代理会转到生产）
const SITE_ORIGIN = 'https://www.ipzsk.com'
const PAGES = ['/', '/studio', '/studio/create', '/studio/assets', '/admin', '/account', '/developer', '/workspace', '/workstation']
const NEXT_PAGES = ['home', 'account', 'developer', 'workstation', 'workspace'].map((p) => '/next/' + p)
const SETTLE_MS = Number(process.env.SETTLE_MS || 2500)

const failures = []
const warnings = []
const fail = (check, detail) => failures.push({ check, detail })
const summary = { base: BASE, api: API, block_api: BLOCK_API, pages: [], api_checks: [], mock: null }

const isApiPath = (url) => { try { return /^\/(api|v1)\//.test(new URL(url).pathname) } catch { return false } }

async function visit(context, path, { optional = false } = {}) {
  const page = await context.newPage()
  const rec = { path, status: null, final_url: null, console_errors: [], page_errors: [], csp_violations: [], blocked_writes: [], api_requests: [], failed_requests: [] }
  page.on('console', (msg) => {
    const text = msg.text()
    if (text.startsWith('[csp] ')) return rec.csp_violations.push(JSON.parse(text.slice(6)))
    if (msg.type() !== 'error') return
    if (/status of 401\b/.test(text)) return // 未登录的预期 401
    rec.console_errors.push(text.slice(0, 300))
  })
  page.on('pageerror', (err) => rec.page_errors.push(String(err.message || err).slice(0, 300)))
  page.on('requestfailed', (req) => rec.failed_requests.push(`${req.method()} ${req.url().split('?')[0]} ${req.failure()?.errorText}`))
  await page.route('**/*', (route) => {
    const req = route.request()
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { rec.blocked_writes.push(`${req.method()} ${req.url().split('?')[0]}`); return route.abort('blockedbyclient') }
    if (isApiPath(req.url())) { rec.api_requests.push(new URL(req.url()).pathname); if (BLOCK_API) return route.abort('blockedbyclient') }
    return route.continue()
  })
  try {
    const res = await page.goto(BASE + path, { waitUntil: 'load', timeout: 30000 })
    rec.status = res ? res.status() : null
    await page.waitForTimeout(SETTLE_MS)
    rec.final_url = page.url()
  } catch (e) { rec.page_errors.push('navigation: ' + e.message.split('\n')[0]) }
  await page.close()
  if (optional && rec.status === 404) { rec.skipped = 'not_present'; return rec }
  if (!(rec.status >= 200 && rec.status < 400)) fail('page_load', `${path} → HTTP ${rec.status}`)
  if (rec.page_errors.length) fail('page_errors', `${path}: ${rec.page_errors.join(' | ')}`)
  // BLOCK_API 时被拦的 /api/ 请求会产生 net::ERR 控制台错误，只算预期内。
  const errors = BLOCK_API ? rec.console_errors.filter((t) => !/ERR_BLOCKED_BY_CLIENT|Failed to fetch|NetworkError|network_error/i.test(t)) : rec.console_errors
  if (errors.length) fail('console_errors', `${path}: ${errors.join(' | ')}`)
  if (rec.csp_violations.length) fail('csp_violation', `${path}: ${rec.csp_violations.map((v) => `${v.directive} ${v.blocked}`).join(' | ')}`)
  if (rec.blocked_writes.length) warnings.push(`${path} 匿名加载就发了写请求（已拦截）：${rec.blocked_writes.join(', ')}`)
  return rec
}

async function http(method, url, headers = {}) {
  const res = await fetch(url, { method, headers, redirect: 'manual', signal: AbortSignal.timeout(15000) })
  return res
}

async function apiCheck(name, fn) {
  const rec = { name, ok: false }
  try { Object.assign(rec, await fn()); rec.ok = !rec.error } catch (e) { rec.error = e.message }
  if (!rec.ok) fail('api:' + name, rec.error)
  summary.api_checks.push(rec)
}

async function apiChecks() {
  let firstOrig = null
  await apiCheck('public_cases_signed_urls', async () => {
    const res = await http('GET', API + '/api/public/cases')
    if (res.status !== 200) return { error: `HTTP ${res.status}` }
    const body = await res.json()
    const items = body.items || []
    if (!items.length) return { error: 'items 为空（案例还没导入？）' }
    firstOrig = items[0].image?.urls?.orig
    const loaded = []
    for (const it of items.slice(0, 3)) {
      const url = it.image?.urls?.w480 || it.image?.urls?.orig
      if (!url || !/X-Amz-Signature=/.test(url)) return { error: `案例 ${it.id} 没有签名 URL` }
      const img = await http('GET', url)
      const type = img.headers.get('content-type') || ''
      await img.body?.cancel()
      if (img.status !== 200 || !type.startsWith('image/')) return { error: `案例 ${it.id} 图片 HTTP ${img.status} ${type}` }
      loaded.push({ id: it.id, variant: it.image.urls.w480 ? 'w480' : 'orig', cache_control: img.headers.get('cache-control') })
    }
    const noThumb = items.filter((it) => !it.image?.urls?.w480 && (it.image?.width ?? 0) >= 480).length // 原图宽度不到 480 的不生成 w480，属正常
    if (noThumb) warnings.push(`首页 ${items.length} 个案例里 ${noThumb} 个还没有 w480 缩略图（缩略图队列未跑完？）`)
    return { count: items.length, loaded }
  })
  await apiCheck('signed_url_time_slice_stable', async () => {
    if (!firstOrig) return { error: '上一步没拿到 URL' }
    const again = (await (await http('GET', API + '/api/public/cases')).json()).items?.[0]?.image?.urls?.orig
    // 跨时间片边界时可能不同；重跑一次即可区分
    return again === firstOrig ? { same: true } : { error: '同一时间片内两次签出的 URL 不同' }
  })
  await apiCheck('public_case_categories', async () => {
    const res = await http('GET', API + '/api/public/case-categories')
    return res.status === 200 ? { count: ((await res.json()).items || []).length } : { error: `HTTP ${res.status}` }
  })
  for (const path of ['/api/me/media/models', '/api/me/roles', '/api/admin/me']) {
    await apiCheck('auth_enforced ' + path, async () => {
      const res = await http('GET', API + path)
      await res.body?.cancel()
      return res.status === 401 ? { status: 401 } : { error: `匿名访问期望 401，实际 ${res.status}` }
    })
  }
  for (const [path, method] of [['/api/public/cases', 'GET'], ['/api/me/media/models', 'GET'], ['/api/me/uploads', 'POST'], ['/api/admin/me', 'GET']]) {
    await apiCheck('cors_preflight ' + path, async () => {
      const res = await http('OPTIONS', API + path, { Origin: SITE_ORIGIN, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': 'content-type' })
      await res.body?.cancel()
      const h = (k) => res.headers.get(k)
      const got = { status: res.status, allow_origin: h('access-control-allow-origin'), allow_credentials: h('access-control-allow-credentials'), allow_methods: h('access-control-allow-methods'), allow_headers: h('access-control-allow-headers') }
      if (res.status !== 204 || got.allow_origin !== SITE_ORIGIN || got.allow_credentials !== 'true' || !(got.allow_methods || '').includes(method) || !/content-type/i.test(got.allow_headers || '')) return { ...got, error: `预检不符合：${JSON.stringify(got)}` }
      return got
    })
  }
  await apiCheck('cors_preflight_foreign_origin_rejected', async () => {
    const res = await http('OPTIONS', API + '/api/me/media/models', { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' })
    await res.body?.cancel()
    return res.status === 403 && !res.headers.get('access-control-allow-origin') ? { status: 403 } : { error: `外域预检期望 403，实际 ${res.status}` }
  })
}

// ?mock=1 在生产构建里必须无效。判据：/admin 真实模式会请求 /api/admin/*（门禁），mock 模式一个都不发。
async function mockCheck(context) {
  const plain = await visit(context, '/admin')
  const mocked = await visit(context, '/admin?mock=1')
  const real = (r) => r.api_requests.filter((p) => p.startsWith('/api/admin/')).length
  summary.mock = { admin_api_requests_plain: real(plain), admin_api_requests_mock: real(mocked), final_url_mock: mocked.final_url }
  if (real(plain) > 0 && real(mocked) === 0) fail('mock_active', '/admin?mock=1 没有请求 /api/admin/*：生产构建里 ?mock=1 仍然生效')
  if (real(plain) === 0) warnings.push('mock 判据不可用：/admin 普通模式也没有请求 /api/admin/*')
}

;(async () => {
  let browser
  try {
    browser = await playwright.chromium.launch({ headless: true }).catch(() => playwright.chromium.launch({ headless: true, channel: 'chrome' }))
    const context = await browser.newContext({ serviceWorkers: 'block' })
    await context.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => console.warn('[csp] ' + JSON.stringify({ directive: e.violatedDirective, blocked: e.blockedURI, source: e.sourceFile, line: e.lineNumber })))
    })
    for (const p of PAGES) summary.pages.push(await visit(context, p))
    for (const p of NEXT_PAGES) summary.pages.push(await visit(context, p, { optional: true }))
    await mockCheck(context)
    await apiChecks()
  } catch (e) {
    fail('runner', e.stack || e.message)
  } finally {
    await browser?.close()
  }
  summary.pages = summary.pages.map(({ api_requests, ...rest }) => ({ ...rest, api_requests: [...new Set(api_requests)] }))
  summary.warnings = warnings
  summary.failures = failures
  summary.ok = failures.length === 0
  console.log(JSON.stringify(summary, null, 2))
  process.exit(summary.ok ? 0 : 1)
})()
