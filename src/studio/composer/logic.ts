// Pure composer rules (§2.2 / §2.3). No React, no store — unit-tested in logic.test.ts.
import type { JSONContent } from '@tiptap/core'
import type { GenerationParams, MediaKind, ModelSpec, ParamSpec } from '@/shared/contracts'
import { pointsNumber } from '@/shared/points'
import type { MediaAsset } from '@/media'
import type { QuoteEntry } from '../api/catalog'
import type { Mention, ParamChange, ParamInput, ParamValue, QueueEntry, RefSlot } from '../api/queue'
import { QUEUE_MAX } from '../api/queue'

// ── params ────────────────────────────────────────────────────────────────

/** Chip / select labels. The catalog only declares `field`; the wording is ours. Unknown fields fall back to the raw key. */
export const PARAM_LABELS: Record<string, string> = {
  aspect_ratio: '比例', resolution: '分辨率', quality: '画质', n: '张数', duration: '时长',
  seed: '种子', sound: '声音', generate_audio: '声音', enhance_prompt: '提示词增强',
}
export const paramLabel = (field: string) => PARAM_LABELS[field] ?? field

/** `unsupported` maps field → reason; those params are hidden. */
export const visibleParams = (model: ModelSpec) => model.params.filter(p => !(p.field in (model.unsupported ?? {})))

/** Some catalogs advertise a boolean as an enum of the strings "true"/"false" — still a switch to us. */
const BOOL_STRINGS = ['true', 'false']
export const isBooleanParam = (spec: ParamSpec) =>
  spec.type === 'boolean' || (spec.values?.length === 2 && spec.values.every(v => BOOL_STRINGS.includes(String(v))))

/** Which control renders the param. `text` is the fallback for anything we don't recognise — never drop it silently. */
export type ParamControl = 'boolean' | 'enum' | 'number' | 'text'
export function controlOf(spec: ParamSpec): ParamControl {
  if (isBooleanParam(spec)) return 'boolean'
  if (spec.values?.length) return 'enum'
  return spec.type === 'integer' ? 'number' : 'text'
}

/** The two values a boolean param is sent as — real booleans, or the catalog's own "true"/"false" strings. */
export const boolValues = (spec: ParamSpec): [on: ParamValue, off: ParamValue] =>
  [spec.values?.find(v => String(v) === 'true') ?? true, spec.values?.find(v => String(v) === 'false') ?? false]
export const isOn = (v: ParamInput) => v === true || v === 'true'

/** The value to start from, or undefined for an optional free field (seed) the catalog gives no default for. */
export function defaultOf(spec: ParamSpec): ParamInput {
  if (spec.default != null) return spec.default
  if (isBooleanParam(spec)) return boolValues(spec)[1] // no declared default → off
  if (spec.values?.length) return spec.values[0]
  return undefined
}

export function optionsOf(spec: ParamSpec): ParamValue[] {
  if (spec.values) return spec.values
  if (spec.type === 'boolean') return [true, false]
  return []
}

function valid(spec: ParamSpec, v: ParamInput): v is ParamValue {
  if (v === '' || v == null) return false
  if (spec.values) return spec.values.includes(v as string | number) // verbatim: '1K' ≠ '1k'
  if (spec.type === 'integer') return Number.isInteger(v)
  if (spec.type === 'boolean') return typeof v === 'boolean'
  return typeof v === 'string'
}

/** Keep only params the model declares; values outside the model's range fall back to its default and are reported. */
export function normalizeParams(model: ModelSpec, params: GenerationParams): { params: GenerationParams; changes: ParamChange[] } {
  const out: GenerationParams = {}
  const changes: ParamChange[] = []
  for (const spec of visibleParams(model)) {
    const v = params[spec.field]
    if (valid(spec, v)) { out[spec.field] = v; continue }
    const d = defaultOf(spec)
    if (d !== undefined) out[spec.field] = d // a param with no default stays unset rather than being sent as ''
    if (v !== undefined && v !== '' && v !== d) changes.push({ name: spec.field, from: v, to: d })
  }
  return { params: out, changes }
}

/** Catalog `billing.unit` → Chinese label (never show the raw unit string). */
const UNIT_LABELS: Record<string, string> = { per_call: '按次', image: '按次', per_second: '按秒', second: '按秒', per_minute: '按分钟', per_minute_output: '按分钟', per_1m_tokens: '按 token' }
export const unitLabel = (unit: string | null | undefined) => (unit && UNIT_LABELS[unit]) ?? ''

/** A model's default params (empty defaults dropped) — what the model picker quotes. */
export const defaultParams = (model: ModelSpec): GenerationParams => normalizeParams(model, {}).params

/** 「约 5.7 点/张」 from a default-params quote; falls back to the unit label when there is no price or no per-unit base. */
export function modelPriceLabel(model: ModelSpec, points: number | null | undefined): string {
  const unit = model.billing?.unit
  const params = defaultParams(model)
  const seconds = Number(params.duration)
  const per = (v: number, suffix: string) => `约 ${pointsNumber(v)} 点/${suffix}`
  if (points == null) return unitLabel(unit)
  if (unit === 'per_call' || unit === 'image') return model.kind === 'image' ? per(points / (Number(params.n) || 1), '张') : per(points, '次')
  if (!(seconds > 0)) return unitLabel(unit)
  if (unit === 'per_second' || unit === 'second') return per(points / seconds, '秒')
  if (unit === 'per_minute' || unit === 'per_minute_output') return per((points / seconds) * 60, '分钟')
  return unitLabel(unit)
}

/** Param entries worth showing in a summary row (「型号 · 1k · 21:9」): empty values would leave stray 「·」 separators. */
export const summaryParams = (params: GenerationParams) => Object.entries(params).filter(([, v]) => v !== '' && v != null)

export function formatParam(name: string, v: ParamInput): string {
  if (v === undefined || v === '' || v === null) return name === 'seed' ? '随机' : '默认'
  if (name === 'n') return `${v}张`
  if (name === 'duration') return `${v}秒`
  if (v === true || v === 'true') return '开'
  if (v === false || v === 'false') return '关'
  return String(v)
}

// ── references ────────────────────────────────────────────────────────────

export const referenceMax = (model: ModelSpec | undefined) => model?.references?.maxImages ?? 0

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
export const sentReferenceIds = (model: ModelSpec | undefined, slots: RefSlot[]) => referenceMax(model) > 0 ? slots.filter(s => !s.url_only).map(s => s.asset.id) : []

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

/** Queue items that can go out now: not red (4xx), cancelled, waiting for an anchor, or pointing at a deleted asset. */
export const isSendable = (i: QueueEntry) => !i.missing && !i.issues?.length && i.state !== 'failed' && i.state !== 'cancelled' && i.state !== 'waiting'

/** §2.3 发送: empty queue → composer only; otherwise queue (+ composer if it has a prompt). Red (4xx) / missing items are skipped until edited. */
export function planSend(queue: QueueEntry[], composer: QueueEntry | null): QueueEntry[] {
  const hasPrompt = !!composer?.prompt.trim()
  if (!queue.length) return hasPrompt ? [composer!] : []
  const sendable = queue.filter(isSendable)
  return hasPrompt ? [...sendable, composer!] : sendable
}

export const quoteEntry = (i: Pick<QueueEntry, 'kind' | 'model' | 'params' | 'reference_asset_ids'>): QuoteEntry =>
  ({ kind: i.kind, model: i.model, params: i.params, reference_asset_ids: [...i.reference_asset_ids] })

// ── {{主体:…}} template variables (§2.8 / §2.9) ──────────────────────────────

const SUBJECT_VAR = /\{\{主体[:：]([^{}]{1,30})\}\}/g

/** Unfilled subject placeholders in order, deduped, e.g. ['{{主体:商品}}']. */
export const subjectVarsOf = (text: string) => [...new Set([...text.matchAll(SUBJECT_VAR)].map(m => m[0]))]
/** 「商品」 from 「{{主体:商品}}」. */
export const subjectVarLabel = (token: string) => token.replace(SUBJECT_VAR, '$1')

/** Replace every occurrence of `token` in text nodes with a subject chip (all occurrences share the chip's uid). */
export function fillSubjectVar(doc: JSONContent, token: string, attrs: ChipAttrs): JSONContent {
  const walk = (n: JSONContent): JSONContent => {
    if (!n.content) return n
    return {
      ...n,
      content: n.content.flatMap((c): JSONContent[] => {
        if (c.type !== 'text' || !c.text?.includes(token)) return [walk(c)]
        return c.text.split(token).flatMap((part, i) => [
          ...(i > 0 ? [{ type: 'mention', attrs: { ...attrs } }] : []),
          ...(part ? [{ ...c, text: part }] : []),
        ])
      }),
    }
  }
  return walk(doc)
}

/** Why a set of items can't be sent because of subjects (deleted chip / unfilled placeholder), or null. `subjectIds` undefined = not loaded yet. */
export function subjectBlockReason(items: Pick<QueueEntry, 'prompt' | 'mentions'>[], subjectIds: Set<string> | undefined): string | null {
  for (const it of items) {
    const v = subjectVarsOf(it.prompt)[0]
    if (v) return `请为 ${v} 选择主体`
  }
  if (subjectIds && items.some(it => it.mentions.some(m => m.type === 'subject' && !subjectIds.has(m.id)))) return '有主体已被删除，请先移除「主体已删除」标签'
  return null
}
