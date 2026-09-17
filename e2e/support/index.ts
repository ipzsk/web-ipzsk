import { afterAll, beforeAll, describe, inject } from 'vitest'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { loadPlaywright } from './pw'

export const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:5174').replace(/\/$/, '')
export const DESKTOP = { width: 1440, height: 900 }
export const MOBILE = { width: 390, height: 844 }
export const SHOTS = process.env.E2E_SHOTS ?? '/private/tmp/claude-501/-Users-icycat-Code-github-icycat-ipzsk/e47fe5f9-7e50-4ab7-b01f-13abf01a3904/scratchpad/e2e'

const ws = inject('wsEndpoint')
/** describe() that skips (with the reason printed once by global setup) when no browser is available. */
export const e2eDescribe = (name: string, fn: () => void) => describe.skipIf(!ws)(name, fn)

export interface Ctx {
  browser: Browser
  context: BrowserContext
  page: Page
  /** Uncaught errors + console errors not matched by the allow-list. */
  errors: string[]
  /** Every /api/** or /v1/** request that reached the network (mock mode should make none). */
  apiCalls: { method: string; url: string; body: string | null }[]
}

export interface Options {
  viewport?: { width: number; height: number }
  /** Studio/admin mock adapters (localStorage ipzsk.mock=1, failRate 0). Default true. */
  mock?: boolean
  /** Extra console-error patterns to tolerate (resource 401/404 are always tolerated). */
  allow?: RegExp[]
  /** Fake /api/** responses: return [status, json] or undefined for the default 401. */
  api?: (method: string, path: string) => [number, unknown] | undefined
}

// Resource failures from the backend being absent in tests: "Failed to load resource: 401/404".
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAMAASsJTYQAAAAASUVORK5CYII=', 'base64')
const ALWAYS_ALLOWED = [/Failed to load resource: the server responded with a status of (401|404)/]

/**
 * Fresh context per test file, pages share the one browser from global setup.
 * No request under /api/ or /v1/ ever reaches the real backend: unhandled ones get 401.
 */
export function useBrowser(opts: Options = {}): Ctx {
  const ctx = { errors: [], apiCalls: [] } as unknown as Ctx
  beforeAll(async () => {
    const pw = loadPlaywright()!
    ctx.browser = await pw.chromium.connect(ws)
    ctx.context = await newContext(ctx, opts)
    ctx.page = await ctx.context.newPage()
  })
  afterAll(async () => {
    await ctx.context?.close()
    await ctx.browser?.close() // disconnects only; the server is closed by global setup
  })
  return ctx
}

export async function newContext(ctx: Ctx, opts: Options = {}) {
  const context = await ctx.browser.newContext({ viewport: opts.viewport ?? DESKTOP, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  context.setDefaultTimeout(10_000)
  const mock = opts.mock ?? true
  await context.addInitScript(`try {
    ${mock ? "localStorage.setItem('ipzsk.mock','1'); localStorage.setItem('ipzsk.mock.failRate','0');" : "localStorage.removeItem('ipzsk.mock');"}
  } catch {}`)
  // Pathname-anchored: /src/studio/api/*.ts modules and the legacy /api.js must still load.
  await context.route(u => /^\/(api|v1)\//.test(u.pathname), async route => {
    const req = route.request()
    const url = new URL(req.url())
    ctx.apiCalls.push({ method: req.method(), url: url.pathname + url.search, body: req.postData() })
    const [status, json] = opts.api?.(req.method(), url.pathname) ?? [401, { error: { code: 'customer_login_required' } }]
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) })
  })
  // Mute Vite HMR (a socket that never delivers updates): edits landing in src/ mid-run must not reload pages under a test.
  await context.routeWebSocket(u => u.origin.replace(/^ws/, 'http') === BASE, () => {})
  // Remote images (case covers, picsum mock results) → 1×1 PNG: no network dependency, less memory.
  await context.route(u => u.origin !== BASE, route => route.request().resourceType() === 'image'
    ? route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
    : route.continue())
  const allow = [...ALWAYS_ALLOWED, ...(opts.allow ?? [])]
  context.on('page', page => watch(page, ctx, allow))
  return context
}

function watch(page: Page, ctx: Ctx, allow: RegExp[]) {
  page.on('pageerror', e => ctx.errors.push(`pageerror: ${e.message}`))
  page.on('console', m => {
    if (m.type() !== 'error') return
    const text = m.text()
    if (!allow.some(re => re.test(text))) ctx.errors.push(`console: ${text}`)
  })
}

/** Navigate to a path, adding ?mock=1 unless mock is off. Waits for the app root to render. */
export async function gotoMock(page: Page, path: string, { mock = true } = {}) {
  const url = new URL(BASE + path)
  if (mock) url.searchParams.set('mock', '1')
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0, undefined, { timeout: 30_000 }) // first hit may wait on Vite transforms
}

/** Clear localStorage/sessionStorage/IndexedDB for the app origin (then the init script re-arms mock keys on next load). */
export async function resetStorage(page: Page) {
  if (!page.url().startsWith(BASE)) await page.goto(BASE + '/studio.html?blank', { waitUntil: 'commit' })
  await page.evaluate(async () => {
    localStorage.clear(); sessionStorage.clear()
    const dbs = (await indexedDB.databases?.()) ?? []
    await Promise.all(dbs.map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name!); q.onsuccess = q.onerror = q.onblocked = r })))
  })
}

/** Horizontal overflow in CSS px (0 = none). */
export const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

const require = createRequire(import.meta.url)
/** axe-core violations with impact serious/critical. */
export async function axe(page: Page, { exclude = [] as string[] } = {}) {
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') })
  return page.evaluate(async exclude => {
    const r = await (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[]; failureSummary?: string }[] }[] }> } })
      .axe.run({ exclude: exclude.map(s => [s]) }, { resultTypes: ['violations'] })
    return r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
      .map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.slice(0, 5).map(n => `${n.target.join(' ')} — ${(n.failureSummary ?? '').split('\n').slice(1, 2).join('').trim()}`) }))
  }, exclude)
}

export async function shot(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true })
  const path = `${SHOTS}/${name}.png`
  await page.screenshot({ path })
  return path
}

/** Dev-only composer store (window.__ipzskComposer): prompt text, slots, queue. */
export const composer = (page: Page) => page.evaluate(() => {
  const s = (window as unknown as { __ipzskComposer: { getState: () => Record<string, any> } }).__ipzskComposer.getState()
  const text = (n: any): string => n ? (n.text ?? '') + (n.type === 'mention' ? `@${n.attrs.label}` : '') + (n.content ?? []).map(text).join(n.type === 'doc' ? '\n' : '') : ''
  return {
    kind: s.kind as string, text: text(s.doc), doc: s.doc, editingId: s.editingId as string | null,
    slots: (s.slots as any[]).map(x => ({ id: x.asset.id as string, url_only: !!x.url_only })),
    queue: (s.queue as any[]).map(q => ({ item_id: q.item_id as string, model: q.model as string, anchor_of: q.anchor_of as string | null, params: q.params, changes: q.changes })),
  }
})

/** Mock generation submits recorded by src/studio/api/generation.ts. */
export const mockSubmits = (page: Page) => page.evaluate(() => ((window as unknown as { __ipzskMockSubmits?: { path: string; body: any }[] }).__ipzskMockSubmits ?? []))
