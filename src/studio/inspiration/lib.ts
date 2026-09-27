import { COMPOSER_FILL_EVENT, dispatchStudioEvent, type ComposerFillDetail as SharedFillDetail } from '@/shared/events'
/** Pure helpers for the 灵感 view (tested in lib.test.ts). */

import type { AssetUrls, CaseImage, InspirationCase } from '@/shared/contracts'

import type { CaseKind } from '@/shared/contracts'
export type { CaseKind, CaseVideo } from '@/shared/contracts'
/**
 * A case as the gateway serves it (`GET /api/public/cases?kind=`). The static manifest is mapped into this shape.
 * `video` is the example clip of a video / 数字人 case (A 级 may have none); the cover stays in `image`.
 */
export type CaseItem = InspirationCase

/** One row of data/cases.manifest.json (built by scripts/build-cases-manifest.mjs). Only `fromManifest` reads it. */
export interface ManifestCase {
  id: string
  title: string
  prompt: string
  category: string
  categoryZh: string
  tags: string[]
  model?: string | null
  params?: Record<string, string | number | boolean>
  image: { url: string; orig: string; width: number; height: number }
  author?: string | null
  author_url?: string | null
  source_url?: string | null
  source_repo: 'awesome-gpt-image-2' | 'Punk-Skill'
  license_note: string
  /** §2.8 case template (ecommerce product sets). */
  template?: { items: { key: string; label: string; description: string; count: number; references: { slot: string }[] }[] }
}

export const fromManifest = (m: ManifestCase): CaseItem => ({
  id: m.id, title: m.title, prompt: m.prompt, category: m.category, category_zh: m.categoryZh, tags: m.tags,
  model: m.model ?? null, params: m.params ?? {}, template: m.template ?? null,
  author: m.author ?? null, author_url: m.author_url ?? null, source_url: m.source_url ?? null, source_repo: m.source_repo, license_note: m.license_note,
  image: { width: m.image.width, height: m.image.height, urls: { w480: m.image.url, w960: null, orig: m.image.orig } },
  kind: 'image', video: null, license_tier: null,
})

/** CaseImage urls (nullable variants) → MediaImage urls (absent variants). */
export const caseUrls = (img: CaseImage): AssetUrls => ({
  orig: img.urls.orig, ...(img.urls.w480 && { w480: img.urls.w480 }), ...(img.urls.w960 && { w960: img.urls.w960 }),
})
export const caseAspect = (img: CaseImage) => img.width && img.height ? img.height / img.width : 1
const primitiveParams = (p: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))) as Record<string, string | number | boolean>

/** `cat` is a comma-separated list (`a,b` = either category), same as the gateway's `cat=a,b`. */
export type CaseFilter = { cat: string; q: string; kind?: CaseKind }

export const splitCats = (cat: string) => cat.split(',').filter(Boolean)
/** Toggle one category in a `cat` list; '' clears. */
export function toggleCat(cat: string, id: string): string {
  if (!id) return ''
  const cats = splitCats(cat)
  return (cats.includes(id) ? cats.filter((c) => c !== id) : [...cats, id]).join(',')
}

/* ---------- URL (?cat=&q=&case=) ---------- */

export type InspirationParams = CaseFilter & { case: string | null }

export function readParams(search: URLSearchParams | string): InspirationParams {
  const p = typeof search === 'string' ? new URLSearchParams(search) : search
  return { cat: p.get('cat') ?? '', q: (p.get('q') ?? '').trim(), case: p.get('case') || null }
}

/** Apply a patch to the query string, dropping empty values. Unrelated params (e.g. ?kind=) are kept. */
export function patchParams(search: URLSearchParams | string, patch: Partial<InspirationParams>): URLSearchParams {
  const p = new URLSearchParams(search)
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === '') p.delete(k)
    else p.set(k, String(v))
  }
  return p
}

/* ---------- filter / search ---------- */

export function matchesCase(c: CaseItem, { cat, q }: CaseFilter): boolean {
  if (cat && !splitCats(cat).includes(c.category)) return false
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const hay = `${c.title}\n${c.prompt}\n${c.tags.join(' ')}`.toLowerCase()
  return terms.every((t) => hay.includes(t))
}

export const PAGE_SIZE = 60

export function pageCases(all: CaseItem[], filter: CaseFilter, cursor: string | null, size = PAGE_SIZE) {
  const hits = all.filter((c) => matchesCase(c, filter))
  const start = cursor ? Math.max(0, Number(cursor) || 0) : 0
  const end = start + size
  return { items: hits.slice(start, end), next_cursor: end < hits.length ? String(end) : null, total: hits.length }
}

export type CategoryCount = { id: string; label: string; count: number }

/** Counts per category for the current search (so chips show what a click would yield). */
export function categoryCounts(all: CaseItem[], q: string): { total: number; categories: CategoryCount[] } {
  const map = new Map<string, CategoryCount>()
  // Keep manifest order of first appearance for categories, even with zero hits.
  for (const c of all) if (!map.has(c.category)) map.set(c.category, { id: c.category, label: c.category_zh ?? c.category, count: 0 })
  let total = 0
  for (const c of all) if (matchesCase(c, { cat: '', q })) { total++; map.get(c.category)!.count++ }
  return { total, categories: [...map.values()] }
}

/* ---------- similar ---------- */

/** Same category = 2 points, each shared tag = 1 point. Ties keep manifest order. */
export function similarCases(all: CaseItem[], target: CaseItem, limit = 12): CaseItem[] {
  const tags = new Set(target.tags)
  return all
    .map((c, i) => ({ c, i, score: c.id === target.id ? -1 : (c.category === target.category ? 2 : 0) + c.tags.filter((t) => tags.has(t)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.c)
}

/* ---------- copyright (§14) ---------- */

// TODO: real takedown mailbox (§14 「提供邮箱供权利人要求下架」).
export const TAKEDOWN_EMAIL = 'support@ipzsk.com'

export function copyrightLabel(c: Pick<CaseItem, 'id' | 'title' | 'source_repo' | 'author'> & { license_tier?: CaseItem['license_tier'] }) {
  if (c.source_repo === 'Punk-Skill') {
    return { card: '来源：Punk-Skill（MIT）', detail: `来源：Punk-Skill（MIT）${c.author ? ` · 作者 ${c.author}` : ''}` }
  }
  // A 级 = the repo's own work under its license; otherwise (B 级, and the awesome-gpt-image-2 images) the author keeps the rights.
  const repo = c.source_repo ?? 'awesome-gpt-image-2'
  return {
    card: `来源：${repo}`,
    detail: `来源：${repo}${c.author ? ` · ${c.license_tier === 'A' ? '作者' : '原作者'} ${c.author}` : ''}${c.license_tier === 'A' ? '' : ' · 示例内容版权归原作者，仅供学习参考'}`,
  }
}

export const takedownHref = (c: Pick<CaseItem, 'id' | 'title'>) =>
  `mailto:${TAKEDOWN_EMAIL}?subject=${encodeURIComponent(`请求下架案例 #${c.id} ${c.title}`)}`

/* ---------- 做同款 → composer ---------- */

export { COMPOSER_FILL_EVENT } from '@/shared/events'

/** 做同款 detail (shape documented in src/shared/events.ts, source 'case'). */
export type ComposerFillDetail = Extract<SharedFillDetail, { source: 'case' }> & { case_id: string; kind: 'image' | 'video'; model: string | null; prompt: string; params: Record<string, string | number | boolean> }

/** A 数字人 case fills the avatar draft (kind video + mode avatar, prompt = script); a video case switches the composer to video. */
export function fillDetail(c: CaseItem, promptOnly = false): ComposerFillDetail {
  const base: ComposerFillDetail = { source: 'case', case_id: c.id, kind: c.kind === 'video' || c.kind === 'avatar' ? 'video' : 'image',
    ...(c.kind === 'avatar' && { mode: 'avatar' as const }), model: null, prompt: c.prompt, params: {}, reference_urls: [],
    preview: { url: c.image.urls.w480 ?? c.image.urls.orig, title: c.title } }
  if (promptOnly) return base
  return {
    ...base,
    model: c.model ?? null,
    params: primitiveParams(c.params ?? {}),
    ...(c.template && {
      template: {
        name: c.title,
        items: c.template.items.map((it, i) => ({
          key: it.key ?? `item-${i}`, label: it.label, count: it.count ?? 1, references: it.references ?? [],
          prompt: it.description ? `${c.prompt}\n\n${it.label}：${it.description}` : `${c.prompt}\n\n${it.label}`,
        })),
      },
    }),
  }
}

export function dispatchComposerFill(detail: ComposerFillDetail) {
  dispatchStudioEvent(COMPOSER_FILL_EVENT, detail)
}

/* ---------- ?mock=1: video / 数字人 examples (the manifest only has images) ---------- */

// CC0 sample clip (MDN), small enough for a hover preview.
const MOCK_MP4 = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'

/** Re-labels a few manifest images as video / 数字人 cases so mock mode shows those feeds. Every other video case has a clip (B 级), the rest are prompt-only (A 级). */
export function mockKindCases(all: CaseItem[], kind: Exclude<CaseKind, 'image'>, n = 8): CaseItem[] {
  const cats: [string, string][] = kind === 'video' ? [['cinematic', '电影感'], ['product-ad', '产品广告']] : [['ugc-sales', '口播带货']]
  return all.slice(0, n).map((c, i) => {
    const [category, category_zh] = cats[i % cats.length]!
    const clip = kind === 'video' && i % 2 === 0
    return {
      ...c, id: `mock-${kind}-${i}`, kind, category, category_zh, template: null, model: null, params: { aspect_ratio: '16:9' },
      title: `${kind === 'video' ? '视频' : '数字人'}示例 ${i + 1} · ${c.title}`,
      video: clip ? { urls: { orig: MOCK_MP4, poster: null }, width: 1280, height: 720, duration_ms: 5000 } : null,
      license_tier: clip ? 'B' : 'A', source_repo: 'mock', source_url: clip ? 'https://x.com/example/status/1' : null,
    }
  })
}
