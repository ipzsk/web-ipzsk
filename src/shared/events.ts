/**
 * Cross-view window events for /studio — the ONE place their detail shapes live.
 * Senders call dispatchStudioEvent, receivers onStudioEvent; both validate at runtime (a bad detail never reaches a receiver).
 *
 * `ipzsk:composer-fill` → composer draft / queue. Never auto-submits.
 *   case    inspiration 做同款. `reference_urls` are DISPLAY-ONLY (no asset id): shown in the slots, never sent.
 *           `preview` is the case's own result image — context for 「照着这张做」, never sent either.
 *   asset   以此为参考 / 加入输入框 (assets view, create results). Appends to reference slots.
 *   record  编辑后重发 of one record. Replaces the draft.
 *   batch   批次编辑后重发. Replaces the queue.
 *   canvas  canvas node 「加入输入框」. `reference_assets` carry asset ids (sent), `reference_urls` are URL-only (display).
 *
 * `ipzsk:canvas-add` → 放到画布 (receiver: canvas/CanvasAddReceiver.tsx).
 *   asset   { assets }                                          one image / video node per ready asset
 *   record  { record_id, results, prompt, model, params }       text node → generation node with results
 *   case    { case_id, image: { url, width, height }, prompt }  URL-only image node + text node
 */
import type { JSONContent } from '@tiptap/core'
import type { CaseTemplateItem, GenerationParams, MediaKind } from './contracts'
import type { MediaAsset } from '@/media'

export const COMPOSER_FILL_EVENT = 'ipzsk:composer-fill'
export const CANVAS_ADD_EVENT = 'ipzsk:canvas-add'

export interface FillMention { type: 'subject' | 'reference'; id: string; name: string }
export interface FillBase { kind?: MediaKind; model?: string | null; prompt?: string; prompt_doc?: JSONContent | null; mentions?: FillMention[]; params?: GenerationParams }
/** Case templates name slots with strings (`CaseTemplateItem.references`); user templates use integer slots (`TemplateReference`) and never travel through this event. */
export interface CaseTemplate { name: string; items: { key: string; label: string; prompt: string; count: number; references: NonNullable<CaseTemplateItem['references']> }[] }

export type ComposerFillDetail =
  | FillBase & { source: 'case'; case_id?: string; reference_urls: string[]; preview?: { url: string; title?: string }; template?: CaseTemplate }
  | { source: 'asset'; reference_assets: MediaAsset[] }
  | FillBase & { source: 'record'; record_id: string; reference_assets: MediaAsset[] }
  | { source: 'batch'; items: (FillBase & { item_id?: string; anchor_of?: string | null; reference_assets?: MediaAsset[] })[] }
  | { source: 'canvas'; project_id: string; node_id: string; prompt: string; reference_assets: MediaAsset[]; reference_urls: string[] }

export type CanvasAddDetail =
  | { source: 'asset'; assets: MediaAsset[] }
  | { source: 'record'; record_id: string; results: MediaAsset[]; prompt: string; model: string; params: GenerationParams }
  | { source: 'case'; case_id: string; image: { url: string; width: number | null; height: number | null }; prompt: string }

interface Details { [COMPOSER_FILL_EVENT]: ComposerFillDetail; [CANVAS_ADD_EVENT]: CanvasAddDetail }
export type StudioEvent = keyof Details

// ── validation ──

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isAsset = (v: unknown): v is MediaAsset =>
  isObj(v) && isStr(v.id) && (v.kind === 'image' || v.kind === 'video') && isObj(v.urls) && isStr(v.urls.orig) && (v.status === undefined || v.status === 'ready')
/** Assets arrive from other views in varying completeness; fill the MediaAsset fields receivers rely on. */
const assetsOf = (v: unknown): MediaAsset[] => Array.isArray(v)
  ? v.filter(isAsset).map(a => ({ ...a, status: 'ready', width: a.width ?? null, height: a.height ?? null, duration_ms: a.duration_ms ?? null }))
  : []
const urlsOf = (v: unknown) => Array.isArray(v) ? v.filter(isStr) : []
const kindOf = (v: unknown): MediaKind | undefined => v === 'image' || v === 'video' ? v : undefined
const dim = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
const paramsOf = (v: unknown): GenerationParams => isObj(v)
  ? Object.fromEntries(Object.entries(v).filter(([, x]) => ['string', 'number', 'boolean'].includes(typeof x))) as GenerationParams : {}
const baseOf = (d: Record<string, unknown>): FillBase => ({
  kind: kindOf(d.kind), model: isStr(d.model) ? d.model : null, prompt: isStr(d.prompt) ? d.prompt : '',
  prompt_doc: isObj(d.prompt_doc) && d.prompt_doc.type === 'doc' ? d.prompt_doc as JSONContent : null, params: paramsOf(d.params),
  mentions: Array.isArray(d.mentions) ? d.mentions.filter((m): m is FillMention => isObj(m) && (m.type === 'subject' || m.type === 'reference') && isStr(m.id) && isStr(m.name)) : [],
})
/** URLs are never asset ids. */
const looksLikeUrl = (s: string) => /^(https?:|blob:|data:|\/)/.test(s)

export function parseComposerFill(raw: unknown): ComposerFillDetail | null {
  if (!isObj(raw)) return null
  switch (raw.source) {
    case 'case': {
      const t = raw.template
      const items = isObj(t) && Array.isArray(t.items)
        ? t.items.filter(isObj).filter(i => isStr(i.prompt)).map(i => ({
          key: String(i.key ?? ''), label: String(i.label ?? ''), prompt: i.prompt as string,
          count: Number.isInteger(i.count) ? i.count as number : 1,
          references: Array.isArray(i.references) ? i.references.filter(isObj).filter(r => isStr(r.slot)).map(r => ({ slot: r.slot as string })) : [],
        }))
        : []
      return {
        ...baseOf(raw), source: 'case', ...(isStr(raw.case_id) && { case_id: raw.case_id }), reference_urls: urlsOf(raw.reference_urls),
        ...(isObj(raw.preview) && isStr(raw.preview.url) && { preview: { url: raw.preview.url, ...(isStr(raw.preview.title) && { title: raw.preview.title }) } }),
        ...(items.length && { template: { name: String((t as Record<string, unknown>).name ?? ''), items } }),
      }
    }
    case 'asset': {
      const reference_assets = assetsOf(raw.reference_assets)
      return reference_assets.length ? { source: 'asset', reference_assets } : null
    }
    case 'record':
      return { ...baseOf(raw), source: 'record', record_id: String(raw.record_id ?? ''), reference_assets: assetsOf(raw.reference_assets) }
    case 'batch': {
      const items = Array.isArray(raw.items) ? raw.items.filter(isObj).map(i => ({
        ...baseOf(i), item_id: isStr(i.item_id) ? i.item_id : undefined, anchor_of: isStr(i.anchor_of) ? i.anchor_of : null, reference_assets: assetsOf(i.reference_assets),
      })) : []
      return items.length ? { source: 'batch', items } : null
    }
    case 'canvas': {
      let reference_assets = assetsOf(raw.reference_assets)
      let reference_urls = urlsOf(raw.reference_urls)
      // Legacy canvas shape: reference_urls[] + reference_asset_ids[] — only pairable when every URL has its id.
      const ids = urlsOf(raw.reference_asset_ids).filter(id => !looksLikeUrl(id))
      if (!reference_assets.length && ids.length && ids.length === reference_urls.length) {
        reference_assets = ids.map((id, i) => ({ id, kind: 'image', status: 'ready', width: null, height: null, duration_ms: null, urls: { orig: reference_urls[i]! } }))
        reference_urls = []
      }
      return { source: 'canvas', project_id: String(raw.project_id ?? ''), node_id: String(raw.node_id ?? ''), prompt: isStr(raw.prompt) ? raw.prompt : '', reference_assets, reference_urls }
    }
    default:
      return null
  }
}

export function parseCanvasAdd(d: unknown): CanvasAddDetail | null {
  if (!isObj(d)) return null
  if (d.source === 'asset' || (d.source === undefined && Array.isArray(d.assets))) {
    const assets = assetsOf(d.assets)
    return assets.length ? { source: 'asset', assets } : null
  }
  if (d.source === 'record') {
    const results = assetsOf(d.results)
    if (!isStr(d.record_id) || !results.length) return null
    return { source: 'record', record_id: d.record_id, results, prompt: isStr(d.prompt) ? d.prompt : '', model: isStr(d.model) ? d.model : '', params: paramsOf(d.params) }
  }
  if (d.source === 'case') {
    if (!isStr(d.case_id) || !isObj(d.image) || !isStr(d.image.url)) return null
    return { source: 'case', case_id: d.case_id, image: { url: d.image.url, width: dim(d.image.width), height: dim(d.image.height) }, prompt: isStr(d.prompt) ? d.prompt : '' }
  }
  return null
}

const parsers: { [K in StudioEvent]: (raw: unknown) => Details[K] | null } = {
  [COMPOSER_FILL_EVENT]: parseComposerFill,
  [CANVAS_ADD_EVENT]: parseCanvasAdd,
}

/** Returns false (and logs) when the detail doesn't validate — a sender bug, not a user error. */
export function dispatchStudioEvent<K extends StudioEvent>(name: K, detail: Details[K]): boolean {
  if (!parsers[name](detail)) { console.error(`[${name}] invalid detail, not dispatched`, detail); return false }
  window.dispatchEvent(new CustomEvent(name, { detail }))
  return true
}

/** Subscribe with a validated detail; `onInvalid` gets the raw detail of a malformed event. Returns the unsubscribe. */
export function onStudioEvent<K extends StudioEvent>(name: K, handler: (detail: Details[K]) => void, onInvalid?: (raw: unknown) => void): () => void {
  const on = (e: Event) => {
    const raw = (e as CustomEvent).detail
    const d = parsers[name](raw)
    if (d) handler(d); else onInvalid?.(raw)
  }
  window.addEventListener(name, on)
  return () => window.removeEventListener(name, on)
}
