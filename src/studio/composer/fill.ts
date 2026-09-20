// `ipzsk:composer-fill` → composer draft / queue (pure; tested in fill.test.ts).
// Senders: inspiration (case), assets view (asset), create view (record / batch), canvas (canvas). Never auto-submits.
import type { JSONContent } from '@tiptap/core'
import type { GenerationParams, MediaKind, ModelSpec } from '@/shared/contracts'
import type { MediaAsset } from '@/media'
import type { ComposerFillDetail, FillBase } from '@/shared/events'
import { QUEUE_MAX, type Mention, type QueueEntry, type RefSlot } from '../api/queue'
import { addManual, docFromText, normalizeParams, referenceMax, sentReferenceIds, serializePrompt } from './logic'

export { COMPOSER_FILL_EVENT, parseComposerFill as parseFill } from '@/shared/events'
export type FillDetail = ComposerFillDetail
type Params = GenerationParams
type Base = FillBase

/** URL-only reference (case / canvas nodes without an asset id): shown in the slots, never sent as reference_asset_ids. */
export const urlAsset = (url: string): MediaAsset => ({ id: `url:${url}`, kind: 'image', status: 'ready', width: null, height: null, duration_ms: null, urls: { orig: url } })
const urlSlots = (urls: string[]): RefSlot[] => urls.map(u => ({ asset: urlAsset(u), by: [], manual: true, url_only: true }))

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
    reference_asset_ids: sentReferenceIds(model, slots), anchor_of: null,
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
    // §2.3: 发送 would append a non-empty draft as an extra item — a template replaces the draft too (Composer confirms if it had a prompt).
    return { kind, model: model?.id, params: items[0]?.params, doc: null, slots: [], queue: capQueue(items, notices), notices, toast: false }
  }

  // case / record / canvas → replace the draft. Record chips come back from prompt_doc; their references as manual slots.
  const b: Base = d.source === 'canvas' ? { prompt: d.prompt } : d
  const kind = b.kind ?? ctx.kind
  const model = resolveModel(ctx, kind, b.model, notices)
  const slots = [...addManual([], d.source === 'case' ? [] : d.reference_assets), ...urlSlots(d.source === 'record' ? [] : d.reference_urls)]
  if (slots.some(s => s.url_only)) notices.push('案例/画布里没有素材 id 的参考图只作展示，不会随请求发送；需要时请上传到素材后再加入')
  const doc = docFor(b)
  return {
    kind, model: model?.id,
    params: model ? normalizeParams(model, { ...ctx.memory[kind]?.params, ...b.params }).params : ctx.memory[kind]?.params,
    doc, slots, notices, toast: d.source === 'record',
  }
}
