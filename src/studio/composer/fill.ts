// `ipzsk:composer-fill` → composer draft / queue (pure; tested in fill.test.ts).
// Senders: inspiration (case), assets view (asset), create view (record / batch), canvas (canvas). Never auto-submits.
import type { JSONContent } from '@tiptap/core'
import type { GenerationParams, MediaKind, ModelSpec } from '@/shared/contracts'
import type { MediaAsset } from '@/media'
import { QUEUE_MAX, type Mention, type QueueEntry, type RefSlot } from '../api/queue'
import { addManual, docFromText, normalizeParams, referenceMax, serializePrompt } from './logic'

export const COMPOSER_FILL_EVENT = 'ipzsk:composer-fill'

type Params = GenerationParams
interface Base { kind?: MediaKind; model?: string | null; prompt?: string; prompt_doc?: JSONContent | null; mentions?: Mention[]; params?: Params }
export type FillDetail =
  | Base & { source: 'case'; reference_urls: string[]; template?: { name: string; items: { key: string; label: string; prompt: string; count: number; references: { slot: string }[] }[] } }
  | { source: 'asset'; reference_assets: MediaAsset[] }
  | Base & { source: 'record'; record_id: string; reference_assets: MediaAsset[] }
  | { source: 'batch'; items: (Base & { item_id?: string; anchor_of?: string | null; reference_assets?: MediaAsset[] })[] }
  | { source: 'canvas'; project_id: string; node_id: string; prompt: string; reference_urls: string[] }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isAsset = (v: unknown): v is MediaAsset => isObj(v) && isStr(v.id) && (v.kind === 'image' || v.kind === 'video') && isObj(v.urls) && isStr(v.urls.orig)
const assetsOf = (v: unknown) => Array.isArray(v) ? v.filter(isAsset) : []
const urlsOf = (v: unknown) => Array.isArray(v) ? v.filter(isStr) : []
const kindOf = (v: unknown): MediaKind | undefined => v === 'image' || v === 'video' ? v : undefined
const paramsOf = (v: unknown): Params => isObj(v)
  ? Object.fromEntries(Object.entries(v).filter(([, x]) => ['string', 'number', 'boolean'].includes(typeof x))) as Params : {}
const docOf = (v: unknown) => isObj(v) && v.type === 'doc' ? v as JSONContent : null
const baseOf = (d: Record<string, unknown>): Base => ({
  kind: kindOf(d.kind), model: isStr(d.model) ? d.model : null, prompt: isStr(d.prompt) ? d.prompt : '',
  prompt_doc: docOf(d.prompt_doc), params: paramsOf(d.params),
  mentions: Array.isArray(d.mentions) ? d.mentions.filter((m): m is Mention => isObj(m) && (m.type === 'subject' || m.type === 'reference') && isStr(m.id) && isStr(m.name)) : [],
})

/** Validate an untrusted event detail; unknown sources / bad shapes → null. */
export function parseFill(raw: unknown): FillDetail | null {
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
      return { ...baseOf(raw), source: 'case', reference_urls: urlsOf(raw.reference_urls), ...(items.length && { template: { name: String((t as Record<string, unknown>).name ?? ''), items } }) }
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
    case 'canvas':
      return { source: 'canvas', project_id: String(raw.project_id ?? ''), node_id: String(raw.node_id ?? ''), prompt: isStr(raw.prompt) ? raw.prompt : '', reference_urls: urlsOf(raw.reference_urls) }
    default:
      return null
  }
}

/** URL-only reference (case / canvas senders only have URLs). */
// ponytail: id = URL, so the gateway can't resolve it as an asset id; senders should move to reference_assets once they have ids.
export const urlAsset = (url: string): MediaAsset => ({ id: url, kind: 'image', status: 'ready', width: null, height: null, duration_ms: null, urls: { orig: url } })

export interface FillContext {
  models: ModelSpec[]
  kind: MediaKind
  memory: Record<MediaKind, { model?: string; params: Params }>
  slots: RefSlot[]
  queue: QueueEntry[]
  newId?: () => string
}

export interface FillPlan {
  kind?: MediaKind
  model?: string
  params?: Params
  /** Replace the draft doc (undefined = keep). */
  doc?: JSONContent | null
  slots?: RefSlot[]
  /** Replace the queue (confirm first when the current queue is non-empty). */
  queue?: QueueEntry[]
  notices: string[]
  /** Composer should toast 「已填入输入框」 (senders that already toast: case, canvas). */
  toast: boolean
}

function resolveModel(ctx: FillContext, kind: MediaKind, wanted: string | null | undefined, notices: string[]) {
  const list = ctx.models.filter(m => m.kind === kind)
  const remembered = list.find(m => m.id === ctx.memory[kind]?.model) ?? list[0]
  if (!wanted) return remembered
  const hit = list.find(m => m.id === wanted)
  if (!hit && remembered && !notices.some(n => n.includes('暂不可用'))) notices.push(`型号「${wanted}」暂不可用，已换成 ${remembered.name}`)
  return hit ?? remembered
}

const docFor = (b: Base) => b.prompt_doc ?? docFromText(b.prompt ?? '')

function itemOf(ctx: FillContext, b: Base, refs: MediaAsset[], notices: string[], id: string): QueueEntry {
  const kind = b.kind ?? ctx.kind
  const model = resolveModel(ctx, kind, b.model, notices)
  const params = model ? normalizeParams(model, { ...ctx.memory[kind]?.params, ...b.params }).params : b.params ?? {}
  const slots = addManual([], refs)
  const doc = docFor(b)
  const { prompt, mentions } = serializePrompt(doc, slots)
  return {
    item_id: id, kind, model: model?.id ?? b.model ?? '', prompt, params,
    reference_asset_ids: referenceMax(model) > 0 ? slots.map(s => s.asset.id) : [], anchor_of: null,
    mentions: mentions.length ? mentions : b.mentions ?? [], prompt_doc: doc, slots,
  }
}

function capQueue(items: QueueEntry[], notices: string[]) {
  if (items.length > QUEUE_MAX) notices.push(`队列最多 ${QUEUE_MAX} 项，超出的 ${items.length - QUEUE_MAX} 项已忽略`)
  const kept = items.slice(0, QUEUE_MAX)
  const ids = new Set(kept.map(i => i.item_id))
  return kept.map(i => i.anchor_of && !ids.has(i.anchor_of) ? { ...i, anchor_of: null } : i)
}

export function planFill(d: FillDetail, ctx: FillContext): FillPlan {
  const newId = ctx.newId ?? (() => crypto.randomUUID())
  const notices: string[] = []

  if (d.source === 'asset') {
    const model = resolveModel(ctx, ctx.kind, null, notices)
    const max = referenceMax(model)
    if (!max) return { notices: [model ? `${model.name} 不使用参考图，素材未加入` : '型号加载中，素材未加入'], toast: false }
    const images = d.reference_assets.filter(a => a.kind === 'image')
    if (images.length < d.reference_assets.length) notices.push('参考图只能是图片，视频已忽略')
    const fresh = images.filter(a => !ctx.slots.some(s => s.asset.id === a.id))
    const room = Math.max(0, max - ctx.slots.length)
    if (fresh.length > room) notices.push(`${model!.name} 最多 ${max} 张参考图，已忽略 ${fresh.length - room} 张`)
    const add = [...images.filter(a => ctx.slots.some(s => s.asset.id === a.id)), ...fresh.slice(0, room)]
    return { slots: addManual(ctx.slots, add), notices, toast: add.length > 0 }
  }

  if (d.source === 'batch') {
    const idMap = new Map<string, string>()
    const items = d.items.map(b => {
      const id = newId()
      if (b.item_id) idMap.set(b.item_id, id)
      return { ...itemOf(ctx, b, b.reference_assets ?? [], notices, id), anchor_of: b.anchor_of ?? null }
    }).map(i => ({ ...i, anchor_of: i.anchor_of ? idMap.get(i.anchor_of) ?? null : null }))
    return { queue: capQueue(items, notices), notices, toast: true }
  }

  if (d.source === 'case' && d.template) {
    const kind = d.kind ?? ctx.kind
    const model = resolveModel(ctx, kind, d.model, notices)
    const anchorId = newId()
    const items = d.template.items.map((t, i) => {
      const item = itemOf(ctx, { ...d, prompt: t.prompt, prompt_doc: null, params: { ...d.params, n: t.count } }, [], notices, i === 0 ? anchorId : newId())
      return { ...item, anchor_of: i === 0 ? null : anchorId }
    })
    const slotNames = [...new Set(d.template.items.flatMap(t => t.references.map(r => r.slot)))]
    if (slotNames.length) notices.push(`套图需要放入：${slotNames.join('、')}（编辑队列项后添加参考图）`)
    return { kind, model: model?.id, params: items[0]?.params, queue: capQueue(items, notices), notices, toast: false }
  }

  // case / record / canvas → replace the draft. Record chips come back from prompt_doc; their references as manual slots.
  const b: Base = d.source === 'canvas' ? { prompt: d.prompt } : d
  const kind = b.kind ?? ctx.kind
  const model = resolveModel(ctx, kind, b.model, notices)
  const refs = d.source === 'record' ? d.reference_assets : d.reference_urls.map(urlAsset)
  const doc = docFor(b)
  return {
    kind, model: model?.id,
    params: model ? normalizeParams(model, { ...ctx.memory[kind]?.params, ...b.params }).params : ctx.memory[kind]?.params,
    doc, slots: addManual([], refs), notices, toast: d.source === 'record',
  }
}
