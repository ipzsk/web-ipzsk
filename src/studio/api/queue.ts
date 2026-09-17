import type { JSONContent } from '@tiptap/core'
import { ApiError, request } from '@/shared/api'
import type { GenerationParams, QueueItem } from '@/shared/contracts'
import type { MediaAsset } from '@/media'
import { isMock, mockDelay } from './catalog'

export const QUEUE_MAX = 12

export interface Mention { type: 'subject' | 'reference'; id: string; name: string }
export type ParamValue = GenerationParams[string]
export interface ParamChange { name: string; from: ParamValue; to: ParamValue }
/** A reference slot. `by` = uids of @ chips that introduced it; `manual` = user added it directly (§2.2). */
export interface RefSlot { asset: MediaAsset; by: string[]; manual: boolean }

/**
 * composer_queues.items[] (§8.5) plus composer extras. Extras ride along in the same JSON
 * (server only checks size); `reference_asset_ids` stays the source of truth for sending.
 */
export interface QueueEntry extends QueueItem {
  mentions: Mention[]
  prompt_doc: JSONContent | null
  slots: RefSlot[]
  /** Normalisation applied when expanded from a multi-model pick, e.g. resolution 2K→1K. */
  changes?: ParamChange[]
  /** Local submit state. failed = 4xx (stays red), retryable = 5xx/network, waiting = anchor pending, cancelled = anchor failed. */
  state?: 'failed' | 'retryable' | 'waiting' | 'cancelled'
  error?: { code: string; message: string }
}

export interface QueueDoc { items: QueueEntry[]; revision: number }

const MOCK_KEY = 'ipzsk.mock.queue'
const LOCAL_KEY = 'ipzsk.queue.local'

const readLocal = (key: string): QueueDoc => {
  try { return JSON.parse(localStorage.getItem(key) ?? '') as QueueDoc } catch { return { items: [], revision: 0 } }
}
const writeLocal = (key: string, doc: QueueDoc) => { try { localStorage.setItem(key, JSON.stringify(doc)) } catch { /* quota / private mode */ } }

export async function getQueue(): Promise<QueueDoc> {
  if (isMock) { await mockDelay(150); return readLocal(MOCK_KEY) }
  return request<QueueDoc>('/api/me/queue')
}

/**
 * PUT with revision. Throws ApiError status 409 when another device wrote first; caller then GETs and replaces.
 * Mock: bump `revision` in localStorage['ipzsk.mock.queue'] to simulate another device.
 */
export async function putQueue(items: QueueEntry[], revision: number): Promise<{ revision: number }> {
  if (isMock) {
    await mockDelay(150)
    const server = readLocal(MOCK_KEY)
    if (server.revision !== revision) throw new ApiError('队列已在其他设备更新', { status: 409, code: 'revision_conflict' })
    writeLocal(MOCK_KEY, { items, revision: revision + 1 })
    return { revision: revision + 1 }
  }
  return request<{ revision: number }>('/api/me/queue', { method: 'PUT', body: { items, revision } })
}

/** Signed-out queue lives in localStorage; appended to the server queue after login (§2.3). */
export const localQueue = { read: () => readLocal(LOCAL_KEY).items ?? [], write: (items: QueueEntry[]) => writeLocal(LOCAL_KEY, { items, revision: 0 }), clear: () => { try { localStorage.removeItem(LOCAL_KEY) } catch { /* ignore */ } } }
