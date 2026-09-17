// Pure composer rules (§2.2 / §2.3). No React, no store — unit-tested in logic.test.ts.
import type { JSONContent } from '@tiptap/core'
import type { GenerationParams, MediaKind, ModelSpec, ParamSpec } from '@/shared/contracts'
import type { MediaAsset } from '@/media'
import type { QuoteEntry } from '../api/catalog'
import type { Mention, ParamChange, ParamValue, QueueEntry, RefSlot } from '../api/queue'
import { QUEUE_MAX } from '../api/queue'

// ── params ────────────────────────────────────────────────────────────────

export const visibleParams = (model: ModelSpec) => model.params.filter(p => !model.unsupported?.includes(p.name))

export function defaultOf(spec: ParamSpec): ParamValue {
  return spec.default ?? spec.values?.[0] ?? spec.min ?? (spec.type === 'boolean' ? false : '')
}

export function optionsOf(spec: ParamSpec): ParamValue[] {
  if (spec.values) return spec.values
  if (spec.type === 'boolean') return [true, false]
  if (spec.type === 'integer' && spec.min != null && spec.max != null && spec.max - spec.min < 24)
    return Array.from({ length: spec.max - spec.min + 1 }, (_, i) => spec.min! + i)
  return []
}

function valid(spec: ParamSpec, v: ParamValue): boolean {
  if (spec.values) return spec.values.includes(v as string | number) // verbatim: '1K' ≠ '1k'
  if (spec.type === 'integer') return Number.isInteger(v) && (spec.min == null || (v as number) >= spec.min) && (spec.max == null || (v as number) <= spec.max)
  if (spec.type === 'boolean') return typeof v === 'boolean'
  return typeof v === 'string'
}

/** Keep only params the model declares; values outside the model's range fall back to its default and are reported. */
export function normalizeParams(model: ModelSpec, params: GenerationParams): { params: GenerationParams; changes: ParamChange[] } {
  const out: GenerationParams = {}
  const changes: ParamChange[] = []
  for (const spec of visibleParams(model)) {
    const v = params[spec.name]
    if (v !== undefined && valid(spec, v)) { out[spec.name] = v; continue }
    out[spec.name] = defaultOf(spec)
    if (v !== undefined) changes.push({ name: spec.name, from: v, to: out[spec.name]! })
  }
  return { params: out, changes }
}

export function formatParam(name: string, v: ParamValue): string {
  if (name === 'n') return `${v}张`
  if (name === 'duration') return `${v}秒`
  if (typeof v === 'boolean') return v ? '开' : '关'
  return String(v)
}

// ── references ────────────────────────────────────────────────────────────

export const referenceMax = (model: ModelSpec | undefined) => model?.references?.max ?? 0

export interface ReferenceState { max: number; count: number; supported: boolean; over: boolean; message: string | null }
export function referenceState(model: ModelSpec | undefined, count: number): ReferenceState {
  const max = referenceMax(model)
  const supported = max > 0
  const over = supported && count > max
  const message = !model ? null
    : !supported && count > 0 ? '当前型号不使用参考图'
    : over ? `${model.name} 最多 ${max} 张参考图，当前 ${count} 张` : null
  return { max, count, supported, over, message }
}

/** Ids actually sent: none when the model ignores references (slots are kept, not deleted). */
export const sentReferenceIds = (model: ModelSpec | undefined, slots: RefSlot[]) => referenceMax(model) > 0 ? slots.map(s => s.asset.id) : []

export function addManual(slots: RefSlot[], assets: MediaAsset[]): RefSlot[] {
  const next = slots.map(s => assets.some(a => a.id === s.asset.id) ? { ...s, manual: true } : s)
  for (const a of assets) if (!next.some(s => s.asset.id === a.id)) next.push({ asset: a, by: [], manual: true })
  return next
}

/** @subject inserted: add its references (dedupe by asset id), remembering which chip brought them. */
export function addFromChip(slots: RefSlot[], uid: string, assets: MediaAsset[]): RefSlot[] {
  const next = slots.map(s => assets.some(a => a.id === s.asset.id) && !s.by.includes(uid) ? { ...s, by: [...s.by, uid] } : s)
  for (const a of assets) if (!next.some(s => s.asset.id === a.id)) next.push({ asset: a, by: [uid], manual: false })
  return next
}

/**
 * After an edit: forget chips that no longer exist; drop slots that only those chips introduced,
 * unless the user added them manually or a 图N chip still points at them.
 */
export function pruneChips(slots: RefSlot[], liveChipUids: Set<string>, referencedAssetIds: Set<string>): RefSlot[] {
  let changed = false
  const next: RefSlot[] = []
  for (const s of slots) {
    const by = s.by.filter(u => liveChipUids.has(u))
    if (by.length !== s.by.length) changed = true
    if (!by.length && s.by.length && !s.manual && !referencedAssetIds.has(s.asset.id)) { changed = true; continue }
    next.push(by.length === s.by.length ? s : { ...s, by })
  }
  return changed ? next : slots
}

// ── prompt doc ────────────────────────────────────────────────────────────

export interface ChipAttrs { id: string; label: string; kind: 'subject' | 'reference'; uid: string }

export function chipsOf(doc: JSONContent | null): ChipAttrs[] {
  const out: ChipAttrs[] = []
  const walk = (n: JSONContent) => {
    if (n.type === 'mention' && n.attrs) out.push(n.attrs as ChipAttrs)
    n.content?.forEach(walk)
  }
  if (doc) walk(doc)
  return out
}

export const refLabel = (slots: RefSlot[], assetId: string) => {
  const i = slots.findIndex(s => s.asset.id === assetId)
  return i < 0 ? '图?' : `图${i + 1}`
}

/** Plain text for the API: subject chips → `@名称`, reference chips → `图N` (by current slot order). */
export function serializePrompt(doc: JSONContent | null, slots: RefSlot[]): { prompt: string; mentions: Mention[] } {
  const mentions: Mention[] = []
  const inline = (n: JSONContent): string => {
    if (n.type === 'text') return n.text ?? ''
    if (n.type === 'hardBreak') return '\n'
    if (n.type === 'mention') {
      const a = n.attrs as ChipAttrs
      const name = a.kind === 'reference' ? refLabel(slots, a.id) : a.label
      if (!mentions.some(m => m.type === a.kind && m.id === a.id)) mentions.push({ type: a.kind, id: a.id, name })
      return a.kind === 'reference' ? name : `@${name}`
    }
    return (n.content ?? []).map(inline).join('')
  }
  const prompt = doc ? (doc.content ?? []).map(inline).join('\n') : ''
  return { prompt: prompt.trim(), mentions }
}

export const docFromText = (text: string): JSONContent => ({
  type: 'doc',
  content: text.split('\n').map(line => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) })),
})

// ── queue ─────────────────────────────────────────────────────────────────

export interface Draft {
  kind: MediaKind
  model: ModelSpec | undefined
  params: GenerationParams
  doc: JSONContent | null
  slots: RefSlot[]
}

export function itemFromDraft(d: Draft, item_id: string = crypto.randomUUID()): QueueEntry {
  const { prompt, mentions } = serializePrompt(d.doc, d.slots)
  return {
    item_id, kind: d.kind, model: d.model?.id ?? '', prompt, params: d.params,
    reference_asset_ids: sentReferenceIds(d.model, d.slots), anchor_of: null,
    mentions, prompt_doc: d.doc, slots: d.slots,
  }
}

/** Multi-model pick → N items, identical except model; params normalised per model with changes recorded. */
export function expandModels(d: Draft, models: ModelSpec[]): QueueEntry[] {
  return models.map(model => {
    const { params, changes } = normalizeParams(model, d.params)
    return { ...itemFromDraft({ ...d, model, params }), changes }
  })
}

export const queueRoom = (queueLength: number, adding: number) =>
  queueLength + adding > QUEUE_MAX ? `队列最多 ${QUEUE_MAX} 项，当前 ${queueLength} 项` : null

export interface ItemDiff { model: boolean; prompt: boolean; references: boolean; params: Set<string> }
/** What differs between a queued item and the composer — the queue bar bolds these (§2.3). */
export function diffItem(item: QueueEntry, current: QueueEntry): ItemDiff {
  const names = new Set([...Object.keys(item.params), ...Object.keys(current.params)])
  return {
    model: item.model !== current.model,
    prompt: item.prompt !== current.prompt,
    references: item.reference_asset_ids.join() !== current.reference_asset_ids.join(),
    params: new Set([...names].filter(k => item.params[k] !== current.params[k])),
  }
}

/** §2.3 发送: empty queue → composer only; otherwise queue (+ composer if it has a prompt). Red (4xx) items are skipped until edited. */
export function planSend(queue: QueueEntry[], composer: QueueEntry | null): QueueEntry[] {
  const hasPrompt = !!composer?.prompt.trim()
  if (!queue.length) return hasPrompt ? [composer!] : []
  const sendable = queue.filter(i => i.state !== 'failed' && i.state !== 'cancelled' && i.state !== 'waiting')
  return hasPrompt ? [...sendable, composer!] : sendable
}

export const quoteEntry = (i: Pick<QueueEntry, 'kind' | 'model' | 'params' | 'reference_asset_ids'>): QuoteEntry =>
  ({ kind: i.kind, model: i.model, params: i.params, reference_count: i.reference_asset_ids.length })
