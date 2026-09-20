/** Pure helpers for the 创作 view (tested in lib.test.ts). */
import type { JSONContent } from '@tiptap/core'
import type { GenerationParams, MediaKind, MissingAsset, RecordAsset } from '@/shared/contracts'
import type { MediaAsset } from '@/media'
import { formatPoints } from '@/shared/points'
import type { Mention } from '../api/queue'
import { AVATAR_ERRORS } from '../avatar/contract'
import type { GenerationRecord, GenerationStatus } from '../api/records'
import type { PendingGeneration, SubmitOutcome } from '../api/generation'
import { formatParam, paramLabel } from '../composer/logic'

/** One cell of a bubble: a server record, or a submission the server hasn't listed yet. */
export interface ItemView {
  key: string
  record_id: string | null
  item_id: string | null
  kind: MediaKind
  model: string
  prompt: string
  prompt_doc: JSONContent | null
  mentions: Mention[]
  params: GenerationParams
  references: MediaAsset[]
  batch_id: string | null
  batch_position: number
  thread_id: string | null
  anchor_record_id: string | null
  /** Another item in the batch references this one's result. */
  anchor: boolean
  /** submitting = request in flight; submit_failed = never accepted (retry via composer retryItem). */
  status: GenerationStatus | 'submitting' | 'submit_failed'
  failure: string | null
  charged_points: string | null
  results: MediaAsset[]
  created_at: string
}

export interface PendingState { status: 'idle' | 'pending' | 'success' | 'error'; item: PendingGeneration; result?: SubmitOutcome; error?: { outcome?: SubmitOutcome } | null; submittedAt: number }

export const FAILURE_MESSAGES: Record<string, string> = {
  ...Object.fromEntries(Object.entries(AVATAR_ERRORS).map(([k, v]) => [k, v.message])), // 数字人（avatar/contract.ts）
  // Gateway error codes (endpoints.json) that can end a media task / submit. Unknown codes fall back to 「生成失败（code）」.
  insufficient_balance: '点数不足',
  too_many_active: '同时进行的任务太多，请稍后再试',
  unknown_model: '型号不可用',
  model_not_media: '型号不可用',
  unsupported_parameter: '参数不被当前型号支持',
  unsupported_parameter_for_model: '参数不被当前型号支持',
  conflicting_parameter: '参数互相冲突',
  invalid_prompt: '提示词不符合要求',
  reference_asset_not_found: '参考图已被删除',
  too_many_references: '参考图数量超过上限',
  too_many_reference_images: '参考图数量超过上限',
  reference_images_too_large: '参考图过大',
  anchor_not_succeeded: '锚图未成功',
  media_storage_unavailable: '存储服务暂不可用',
  upstream_unavailable: '上游服务暂不可用',
  rate_limited: '请求太频繁，请稍后再试',
  queue_timeout: '排队超时，请重试',
  // Client-side status only (anchor failed → dependents cancelled in composer/send.ts); never a server code.
  anchor_failed: '锚图失败',
}
export const failureText = (code: string | null) => code ? FAILURE_MESSAGES[code] ?? `生成失败（${code}）` : '生成失败'

export const itemIdOf = (r: Pick<GenerationRecord, 'idempotency_key'>) => r.idempotency_key?.startsWith('q:') ? r.idempotency_key.slice(2) : null

/** Drop MissingAsset entries (deleted references / results) — the bubble renders only real media. */
const present = (xs: RecordAsset[] | undefined): MediaAsset[] => (xs ?? []).filter((a): a is Exclude<RecordAsset, MissingAsset> => !('missing' in a))

export function fromRecord(r: GenerationRecord): ItemView {
  return {
    key: r.id, record_id: r.id, item_id: itemIdOf(r), kind: r.kind, model: r.model, prompt: r.prompt, prompt_doc: r.prompt_doc ?? null,
    mentions: r.mentions ?? [], params: r.params, references: present(r.references), batch_id: r.batch_id, batch_position: r.batch_position ?? 1,
    thread_id: r.thread_id, anchor_record_id: r.anchor_record_id, anchor: false, status: r.status,
    failure: r.status === 'failed' || r.status === 'cancelled' ? failureText(r.failure_code) : null,
    charged_points: r.charged_points, results: present(r.results), created_at: r.created_at,
  }
}

/**
 * Server records + in-flight submissions → items, without duplicates. A submission disappears as soon as a record
 * with its idempotency key (`q:item_id`) is listed (submit responses carry no record id); accepted-but-unlisted ones show as 排队中 (no flicker).
 * Several mutations for the same item (retries) → the latest wins.
 */
export function mergeItems(records: GenerationRecord[], pendings: PendingState[]): ItemView[] {
  const itemIds = new Set(records.map(itemIdOf).filter(Boolean))
  const latest = new Map<string, PendingState>()
  for (const p of pendings) latest.set(p.item.item_id, p)
  const items = records.map(fromRecord)
  for (const p of latest.values()) {
    if (itemIds.has(p.item.item_id)) continue
    const out = p.error?.outcome
    const v = p.item
    items.push({
      key: `p:${v.item_id}`, record_id: null, item_id: v.item_id, kind: v.kind, model: v.model, prompt: v.prompt, prompt_doc: v.prompt_doc,
      mentions: v.mentions, params: v.params, references: v.references, batch_id: v.batch_id, batch_position: v.batch_position ?? 0, thread_id: v.thread_id,
      anchor_record_id: v.anchor_record_id, anchor: false, status: p.status === 'success' ? 'queued' : p.status === 'error' ? 'submit_failed' : 'submitting',
      failure: p.status === 'error' ? (out && out.status !== 'accepted' ? out.error.message : '提交失败') : null,
      charged_points: null, results: [], created_at: new Date(p.submittedAt).toISOString(),
    })
  }
  return items
}

export interface Group { key: string; batch_id: string | null; items: ItemView[]; created_at: string }

/** Pairs by batch_id (null → its own group); groups in submit order, items by batch_position. Marks anchors. */
export function groupItems(items: ItemView[]): Group[] {
  const map = new Map<string, Group>()
  const anchorIds = new Set(items.map(i => i.anchor_record_id).filter(Boolean))
  for (const it of items) {
    const key = it.batch_id ?? `single:${it.key}`
    const g = map.get(key) ?? { key, batch_id: it.batch_id, items: [], created_at: it.created_at }
    g.items.push(it)
    if (it.created_at < g.created_at) g.created_at = it.created_at
    map.set(key, g)
  }
  return [...map.values()]
    .map(g => ({ ...g, items: [...g.items].sort((a, b) => a.batch_position - b.batch_position).map(i => i.record_id && anchorIds.has(i.record_id) ? { ...i, anchor: true } : i) }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
}

/** Prompt shown once at the top when identical across the batch; otherwise per item. */
export const sharedPrompt = (items: ItemView[]) => items.every(i => i.prompt === items[0]?.prompt) ? items[0]?.prompt ?? '' : null

/** Param names (plus 'model') whose values differ across items — highlighted in the request bubble. */
export function differingParams(items: ItemView[]): Set<string> {
  const out = new Set<string>()
  if (items.length < 2) return out
  if (new Set(items.map(i => i.model)).size > 1) out.add('model')
  const names = new Set(items.flatMap(i => Object.keys(i.params)))
  for (const n of names) if (new Set(items.map(i => JSON.stringify(i.params[n] ?? null))).size > 1) out.add(n)
  return out
}

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled'])
export const isActive = (s: ItemView['status']) => s === 'queued' || s === 'running' || s === 'submitting'

/** 「消耗积分 N 点」 once every finished item is settled; 「结算中」 while any finished item still has null; null when nothing finished. */
export function chargeLabel(items: Pick<ItemView, 'status' | 'charged_points'>[]): string | null {
  const done = items.filter(i => TERMINAL.has(i.status))
  if (!done.length) return null
  if (done.some(i => i.status === 'succeeded' && i.charged_points == null)) return '结算中'
  const sum = done.reduce((a, i) => a + Number(i.charged_points ?? 0), 0)
  return `消耗积分 ${formatPoints(sum)}`
}

/** Anchors that reached a terminal state → composer calls. `watched` (record_id → item_id) is consumed, so repeat calls are no-ops. */
export function anchorCalls(records: Pick<GenerationRecord, 'id' | 'status' | 'results'>[], watched: Map<string, string>) {
  const calls: { itemId: string; recordId: string; assetId: string | null }[] = []
  for (const r of records) {
    const itemId = watched.get(r.id)
    if (!itemId || !TERMINAL.has(r.status)) continue
    const first = r.results.find(a => !('missing' in a))
    const assetId = r.status === 'succeeded' ? first?.id ?? null : null
    if (r.status === 'succeeded' && !assetId) continue // not archived yet
    watched.delete(r.id)
    calls.push({ itemId, recordId: r.id, assetId })
  }
  return calls
}

/** Signature of what's visible; a change while scrolled up shows 「有新结果 ↓」, at the bottom it scrolls. */
export const streamSignature = (groups: Group[]) =>
  groups.map(g => `${g.key}:${g.items.map(i => `${i.key}.${i.status}.${i.results.length}`).join(',')}`).join('|')

export function newResultsAction(prevSig: string | null, nextSig: string, atBottom: boolean): 'none' | 'jump' | 'scroll' | 'pill' {
  if (prevSig === null) return 'jump'
  if (prevSig === nextSig) return 'none'
  return atBottom ? 'scroll' : 'pill'
}

export const circled = (n: number) => n >= 1 && n <= 20 ? String.fromCharCode(0x245f + n) : `${n}.`

/** Default thread title = local date (§8.5: client decides, server never guesses the time zone). */
export const todayTitle = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const formatWait = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** One 「· 值」 in a request summary. Values that mean nothing on their own (switches, seed) carry their label. */
export const paramText = (v: GenerationParams[string], field = '') =>
  typeof v === 'boolean' || v === 'true' || v === 'false' || field === 'seed'
    ? `${paramLabel(field)}${formatParam(field, v)}`
    : formatParam(field, v)
