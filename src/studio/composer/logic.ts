// Pure composer rules (§2.2 / §2.3). No React, no store — unit-tested in logic.test.ts.
import type { JSONContent } from '@tiptap/core'
import type { GenerationParams, MediaKind, ModelSpec, ParamSpec } from '@/shared/contracts'
import { formatCharge } from '@/shared/points'
import type { MediaAsset } from '@/media'
import type { QuoteEntry, QuoteResult } from '../api/catalog'
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

/** 「约 ¥0.06/张」 from a default-params quote; falls back to the unit label when there is no price or no per-unit base. */
export function modelPriceLabel(model: ModelSpec, points: number | null | undefined): string {
  const unit = model.billing?.unit
  const params = defaultParams(model)
  const seconds = Number(params.duration)
  const per = (v: number, suffix: string) => `约 ${formatCharge(v)}/${suffix}`
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
  /** {{填空}} → 用户填的值，发送前替换（见 applyVars）。 */
  vars?: Record<string, string>
}

export function itemFromDraft(d: Draft, item_id: string = crypto.randomUUID()): QueueEntry {
  const { prompt: raw, mentions } = serializePrompt(d.doc, d.slots)
  const prompt = applyVars(raw, d.vars ?? {})
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

/** A partial/failed quote must never turn an unknown price into zero or permit a paid submit. */
export function quoteSummary(quotes: (QuoteResult | undefined)[], pending: boolean, failed: boolean): { total: number | null; reason: string | null } {
  if (!quotes.length) return { total: null, reason: null }
  if (pending) return { total: null, reason: '正在获取报价，请稍候' }
  if (failed) return { total: null, reason: '报价获取失败，请重新获取报价' }
  if (quotes.some(q => q?.error || q?.points == null || !Number.isFinite(q.points) || q.points < 0)) {
    return { total: null, reason: '部分项目暂无有效报价，请调整参数或重新获取报价' }
  }
  return { total: Math.round(quotes.reduce((sum, q) => sum + q!.points!, 0) * 10) / 10, reason: null }
}

// ── {{主体:…}} template variables (§2.8 / §2.9) ──────────────────────────────

const SUBJECT_VAR = /\{\{主体[:：]([^{}]{1,30})\}\}/g

/** Unfilled subject placeholders in order, deduped, e.g. ['{{主体:商品}}']. */
export const subjectVarsOf = (text: string) => [...new Set([...text.matchAll(SUBJECT_VAR)].map(m => m[0]))]
/** 「商品」 from 「{{主体:商品}}」. */
export const subjectVarLabel = (token: string) => token.replace(SUBJECT_VAR, '$1')

/** Replace every occurrence of `token` in text nodes with `make()`'s nodes (one fresh copy per occurrence). */
function replaceToken(doc: JSONContent, token: string, make: () => JSONContent[]): JSONContent {
  const walk = (n: JSONContent): JSONContent => {
    if (!n.content) return n
    return {
      ...n,
      content: n.content.flatMap((c): JSONContent[] => {
        if (c.type !== 'text' || !c.text?.includes(token)) return [walk(c)]
        return c.text.split(token).flatMap((part, i) => [
          ...(i > 0 ? make() : []),
          ...(part ? [{ ...c, text: part }] : []),
        ])
      }),
    }
  }
  return walk(doc)
}

/** Replace every occurrence of `token` in text nodes with a subject chip (all occurrences share the chip's uid). */
export const fillSubjectVar = (doc: JSONContent, token: string, attrs: ChipAttrs): JSONContent =>
  replaceToken(doc, token, () => [{ type: 'mention', attrs: { ...attrs } }])

/** Why a set of items can't be sent because of subjects (deleted chip / unfilled placeholder), or null. `subjectIds` undefined = not loaded yet. */
export function subjectBlockReason(items: Pick<QueueEntry, 'prompt' | 'mentions'>[], subjectIds: Set<string> | undefined): string | null {
  for (const it of items) {
    const v = subjectVarsOf(it.prompt)[0]
    if (v) return `请为 ${v} 选择主体`
  }
  if (subjectIds && items.some(it => it.mentions.some(m => m.type === 'subject' && !subjectIds.has(m.id)))) return '有主体已被删除，请先移除「主体已删除」标签'
  return null
}

// ── 填空 ────────────────────────────────────────────────────────────────────
// 案例提示词里的空位统一是 {{…}}：`[自定义标题]`、`【人物名称】`、`{DESTINATION}` 这些原始写法
// 在构建期就被 scripts/lib/case-blanks.mjs 改写掉了（那里还要绕开小标题、JSON 片段、编号小节，
// 规则住在构建期，改写结果进 manifest，提交时逐行可审）。运行时只认这一种，不再猜。
// {{主体:…}} 归上面那套（挑主体、插标签），这里排除。

const TEXT_VAR = /\{\{(?!主体[:：])([^{}]{1,40})\}\}/g

/** 提示词里还没填的空位，按出现顺序去重，例如 ['{{主题词}}']。 */
export const textVarsOf = (text: string) => [...new Set([...text.matchAll(TEXT_VAR)].map(m => m[0]))]

/**
 * 空位的短标签：`{{副标题，可留空}}` → 「副标题」，`{{自定义标题}}` → 「标题」。
 * 写法很杂——有的只有说明没有名字（`{{可留空；默认根据主题判断}}`、`{{建议 2–10 个汉字}}`），
 * 这种取不到名字就叫「补充」，完整说明走 title，不让「可留空 可留空」这种重复文案上屏。
 */
const HINT_ONLY = /^(可留空|选填|可选|建议|默认|自动)/
export function varLabel(token: string): string {
  const segs = token.slice(2, -2).replace(/^(自定义|你的|请填写?|请输入|填写|输入)/, '').split(/[，,；;]/).map(x => x.trim()).filter(Boolean)
  return segs.find(x => !HINT_ONLY.test(x)) ?? '补充'
}
/** 标了「可留空 / 选填 / 可选」：不填也能发送，发送时整段去掉。 */
export const isOptionalVar = (token: string) => /可留空|选填|可选/.test(token)

/**
 * 空位 → 用户填的值，发送前一次性替换。空位本身一直留在草稿里，所以格子能反复改；
 * 没填的「可留空」直接去掉，不会把 {{副标题，可留空}} 原样发给模型。
 */
export function applyVars(prompt: string, vars: Record<string, string>): string {
  return prompt.replace(TEXT_VAR, token => {
    const v = vars[token]
    if (v) return v
    // 空串只对「可留空」有意义（= 跳过，整段删掉）。必填的填了又清空要留着 token，
    // 否则格子还显示橙色「没填」，发送却解锁了，提示词里那句变成「标题：」发给模型。
    return isOptionalVar(token) ? '' : token
  }).trim()
}

/**
 * 「{{红色 / 绿色 / 自动判断}}」这种本身就是选项清单 → 给个下拉；自由填空返回 null。
 * 认的是带空格的 ` / `：`{{CITY/COUNTRY}}` 是「城市或国家名」，不是让你二选一。
 */
export function varOptions(token: string): string[] | null {
  const inner = token.slice(2, -2)
  if (!/\s\/\s/.test(inner)) return null
  const opts = inner.split(/\s\/\s/).map(o => o.trim()).filter(Boolean)
  // 第一项常常粘着说明：「画幅比例，例如 4:5」「请填写，例如：黑金」。不切掉的话用户选了第一项，
  // 「请填写，例如：黑金」这句话就被原样写进提示词发给模型。只认「例如」，免得误伤「如意」这种词。
  if (opts[0]) opts[0] = opts[0].replace(/^.*?例如\s*[:：]?\s*/, '').trim() || opts[0]
  return opts.length >= 2 && opts.length <= 12 && opts.every(o => o.length <= 12) ? opts : null
}

/** 必填空位还没填完 → 说清楚差哪个；「可留空」的不拦，serializePrompt 发送时已经去掉。 */
export function varBlockReason(items: Pick<QueueEntry, 'prompt'>[]): string | null {
  for (const it of items) {
    const t = textVarsOf(it.prompt).find(v => !isOptionalVar(v))
    // 选项型的空位没有名字（内容就是选项清单），拿标签念出来是「补充」或者一长串，
    // 跟屏幕上那个下拉对不上号——改成说「选一下 4:5 那个」。
    if (t) return varOptions(t) ? `请先选择「${varOptions(t)![0]} …」` : `请先填写「${varLabel(t)}」`
  }
  return null
}
