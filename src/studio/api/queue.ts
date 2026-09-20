import type { JSONContent } from '@tiptap/core'
import { ApiError, request } from '@/shared/api'
import type { GenerationParams, Mention, Queue, QueueConflict, QueueItem } from '@/shared/contracts'
import type { MediaAsset } from '@/media'
import { isMock, mockDelay } from './catalog'
import { AVATAR_WIRE_FIELDS } from '../avatar/contract'
import { avatarItemFromWire, avatarItemToWire } from '../avatar/logic'

export const QUEUE_MAX = 12

export type { Mention }
export type ParamValue = GenerationParams[string]
/** `undefined` = param left unset (the catalog declares no default, e.g. seed → 随机). */
export type ParamInput = ParamValue | undefined
export interface ParamChange { name: string; from: ParamValue; to: ParamInput }
/** A reference slot. `by` = uids of @ chips that introduced it; `manual` = user added it directly (§2.2). */
export interface RefSlot { asset: MediaAsset; by: string[]; manual: boolean; /** URL without an asset id (case / canvas): displayed, never sent. */ url_only?: true }

/**
 * composer_queues.items[] (§8.5) plus composer extras. Extras ride along in the same JSON
 * (server only checks size); `reference_asset_ids` stays the source of truth for sending.
 */
export interface QueueEntry extends Omit<QueueItem, 'params' | 'reference_asset_ids' | 'mentions' | 'prompt_doc' | 'missing'> {
  params: GenerationParams
  reference_asset_ids: string[]
  mentions: Mention[]
  prompt_doc: JSONContent | null
  slots: RefSlot[]
  /** Normalisation applied when expanded from a multi-model pick, e.g. resolution 2K→1K. */
  changes?: ParamChange[]
  /** Local submit state. failed = 4xx (stays red), retryable = 5xx/network, waiting = anchor pending, cancelled = anchor failed. */
  state?: 'failed' | 'retryable' | 'waiting' | 'cancelled'
  /** `field` = the rejected parameter (gateway `error.field`), highlighted on the item. */
  error?: { code: string; message: string; field?: string }
  /** Set by the server on read: a referenced asset was deleted (§8.5). Not sendable until edited. */
  missing?: boolean
}

export interface QueueDoc { items: QueueEntry[]; revision: number }

const MOCK_KEY = 'ipzsk.mock.queue'
const LOCAL_KEY = 'ipzsk.queue.local'

const readLocal = (key: string): QueueDoc => {
  try { return JSON.parse(localStorage.getItem(key) ?? '') as QueueDoc } catch { return { items: [], revision: 0 } }
}
const writeLocal = (key: string, doc: QueueDoc) => { try { localStorage.setItem(key, JSON.stringify(doc)) } catch { /* quota / private mode */ } }

/** Fields the gateway accepts in composer_queues.items (it rejects anything else with 400 unsupported_item_field). */
const WIRE_FIELDS = ['item_id', 'kind', 'model', 'prompt', 'params', 'anchor_of', 'mentions', 'prompt_doc', 'reference_asset_ids', ...AVATAR_WIRE_FIELDS] as const
/** 数字人项：字段从 params 挪到顶层、prompt 置空（avatar/logic.ts）。 */
export const toWire = (items: QueueEntry[]) => items.map(avatarItemToWire).map(i => Object.fromEntries(WIRE_FIELDS.filter(k => i[k] !== undefined).map(k => [k, i[k]])))

/**
 * Client-only extras (slot thumbnails, local submit state) are cached per item_id on this device and merged back on read.
 * ponytail: another device only sees reference ids (placeholder thumbnails); send an asset lookup if that matters.
 */
const EXTRAS_KEY = 'ipzsk.queue.extras'
type Extras = Pick<QueueEntry, 'slots' | 'changes' | 'state' | 'error'>
export function reviveQueue(items: (Omit<QueueEntry, 'slots' | 'mentions' | 'prompt_doc'> & Partial<QueueEntry>)[], extras: Record<string, Extras> = readExtras()): QueueEntry[] {
  return items.map(avatarItemFromWire).map(i => {
    const x = extras[i.item_id]
    const stub = (id: string) => ({ asset: { id, kind: 'image' as const, status: 'ready' as const, width: null, height: null, duration_ms: null, urls: { orig: '' } }, by: [], manual: true })
    const slots = i.slots ?? x?.slots?.filter(s => s.url_only || i.reference_asset_ids.includes(s.asset.id)) ?? i.reference_asset_ids.map(stub)
    return {
      ...i, mentions: i.mentions ?? [], prompt_doc: i.prompt_doc ?? null, slots,
      ...(x && !i.state && { changes: x.changes, state: x.state === 'waiting' ? undefined : x.state, error: x.error }),
      ...(i.state === 'waiting' && { state: undefined }), // reloaded page: nothing is in flight any more
    }
  })
}
const readExtras = (): Record<string, Extras> => { try { return JSON.parse(localStorage.getItem(EXTRAS_KEY) ?? '{}') } catch { return {} } }
const writeExtras = (items: QueueEntry[]) => {
  try { localStorage.setItem(EXTRAS_KEY, JSON.stringify(Object.fromEntries(items.map(i => [i.item_id, { slots: i.slots, changes: i.changes, state: i.state, error: i.error }])))) } catch { /* ignore */ }
}

export async function getQueue(): Promise<QueueDoc> {
  const doc = isMock ? (await mockDelay(150), readLocal(MOCK_KEY)) : await request<Queue>('/api/me/queue')
  return { items: reviveQueue(doc.items as QueueEntry[]), revision: doc.revision ?? 0 }
}

/** The server copy carried by a 409 (`body.queue`), revived; null when the body doesn't have one. */
export function conflictQueue(e: unknown): QueueDoc | null {
  const q = e instanceof ApiError && e.status === 409 ? (e.body as Partial<QueueConflict> | null)?.queue : null
  return q && Array.isArray(q.items) ? { items: reviveQueue(q.items as QueueEntry[]), revision: q.revision ?? 0 } : null
}

/**
 * PUT with revision. Throws ApiError 409 with `body.queue` (server copy) when another device wrote first.
 * Mock: bump `revision` in localStorage['ipzsk.mock.queue'] to simulate another device.
 */
/** Resolves to the full server `Queue` (generated contract); callers currently only need `revision`. */
export async function putQueue(items: QueueEntry[], revision: number): Promise<Queue> {
  writeExtras(items)
  const wire = toWire(items)
  if (isMock) {
    await mockDelay(150)
    const server = readLocal(MOCK_KEY)
    if (server.revision !== revision) throw new ApiError('队列已在其他设备更新', { status: 409, code: 'queue_conflict', body: { error: { code: 'queue_conflict' }, queue: server } })
    const next = { items: wire as unknown as QueueItem[], revision: revision + 1 }
    writeLocal(MOCK_KEY, next as unknown as QueueDoc)
    return next
  }
  return request<Queue>('/api/me/queue', { method: 'PUT', body: { items: wire, revision } })
}

/** Signed-out queue lives in localStorage; appended to the server queue after login (§2.3). */
export const localQueue = { read: () => readLocal(LOCAL_KEY).items ?? [], write: (items: QueueEntry[]) => writeLocal(LOCAL_KEY, { items, revision: 0 }), clear: () => { try { localStorage.removeItem(LOCAL_KEY) } catch { /* ignore */ } } }
