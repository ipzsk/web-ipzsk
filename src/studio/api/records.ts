import type { JSONContent } from '@tiptap/core'
import { get, set } from 'idb-keyval'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { request } from '@/shared/api'
import { queryClient, useCurrentUser } from '@/shared/query'
import type { GenerationParams, GenerationRecord as GenRecord, Page, Thread } from '@/shared/contracts'
import type { MediaAsset } from '@/media'
import { mockSignUrls } from '@/media/fresh'
import { isMock, mockDelay, mockFailRate } from './catalog'
import { isAvatarParams } from '../avatar/logic'
import { mockAvatarCharge, mockAvatarResults } from '../avatar/mock'
import { GENERATION_SUBMIT_KEY, type PendingGeneration, type SubmitOutcome } from './generation'
import { onAnchorFailed, onAnchorSucceeded, sender } from '../composer/send'
import { useComposer } from '../store'
import { anchorCalls, itemIdOf, todayTitle } from '../create/lib'

/*
 * §8.5 / §10.1 generation records + threads (gateway B3, in progress). Assumptions until it lands:
 *   GET  /api/me/generations?thread=&status=active&cursor=  → { items, next_cursor }, newest first
 *   records carry `idempotency_key` ("q:{item_id}") so optimistic placeholders can be matched even on 409 (no record_id)
 *   GET/PATCH {thread_id}/DELETE /api/me/generations/:id, DELETE /api/me/generations?batch_id=
 *   GET/POST/PATCH/DELETE /api/me/threads[/:id] → Thread / { items }
 */

export type { GenerationStatus, Page, Thread } from '@/shared/contracts'
export type ResultAsset = MediaAsset

/**
 * Generated `GenerationRecord`, narrowed where the website knows more: `prompt_doc` is a TipTap doc, params are primitives.
 * `references` / `results` may contain MissingAsset (deleted) — create/lib.ts fromRecord drops those before rendering.
 */
export interface GenerationRecord extends Omit<GenRecord, 'prompt_doc' | 'params'> {
  prompt_doc: JSONContent | null
  params: GenerationParams
}

export interface RecordQuery { thread?: string; status?: 'active'; cursor?: string | null }

export interface RecordsApi {
  list: (q: RecordQuery) => Promise<Page<GenerationRecord>>
  get: (id: string) => Promise<GenerationRecord>
  /** Record id for a submitted item via `?idempotency_key=q:{item_id}` (the submit response carries none). */
  findByItem: (itemId: string) => Promise<string | null>
  move: (id: string, thread_id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  removeBatch: (batch_id: string) => Promise<void>
  threads: () => Promise<Thread[]>
  createThread: (title: string) => Promise<Thread>
  renameThread: (id: string, title: string) => Promise<void>
  deleteThread: (id: string) => Promise<void>
}

const qs = (o: Record<string, string | null | undefined>) => new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => !!e[1])).toString()

const realApi: RecordsApi = {
  list: q => request(`/api/me/generations?${qs({ thread: q.thread, status: q.status, cursor: q.cursor })}`),
  get: id => request(`/api/me/generations/${id}`),
  findByItem: async itemId => (await request<Page<GenerationRecord>>(`/api/me/generations?${qs({ idempotency_key: `q:${itemId}` })}`)).items[0]?.id ?? null,
  move: async (id, thread_id) => { await request(`/api/me/generations/${id}`, { method: 'PATCH', body: { thread_id } }) },
  remove: async id => { await request(`/api/me/generations/${id}`, { method: 'DELETE' }) },
  removeBatch: async batch_id => { await request(`/api/me/generations?${qs({ batch_id })}`, { method: 'DELETE' }) },
  threads: async () => (await request<{ items: Thread[] }>('/api/me/threads')).items,
  createThread: title => request('/api/me/threads', { body: { title } }),
  renameThread: async (id, title) => { await request(`/api/me/threads/${id}`, { method: 'PATCH', body: { title } }) },
  deleteThread: async id => { await request(`/api/me/threads/${id}`, { method: 'DELETE' }) },
}

/* ---------- mock (?mock=1): IndexedDB, time-driven status so a refresh resumes where it was ---------- */

export type MockRecord = GenerationRecord & { _dur: number; _fail: boolean; _deleted?: boolean }
interface MockDb { records: MockRecord[]; threads: (Thread & { _deleted?: boolean })[] }
const DB_KEY = 'ipzsk.mock.generations.v1'
let dbPromise: Promise<MockDb> | undefined
const db = () => (dbPromise ??= get<MockDb>(DB_KEY).then(d => d ?? { records: [], threads: [] }))
const save = async () => { await set(DB_KEY, await db()) }

const RATIO: Record<string, [number, number]> = { '16:9': [16, 9], '9:16': [9, 16], '3:2': [3, 2], '2:3': [2, 3], '4:3': [4, 3], '3:4': [3, 4], '4:5': [4, 5], '5:4': [5, 4], '21:9': [21, 9] }

function mockResults(r: MockRecord): GenRecord['results'] {
  const [rw, rh] = RATIO[String(r.params.aspect_ratio)] ?? [1, 1]
  const h = (w: number) => Math.round((w * rh) / rw)
  return Array.from({ length: r.kind === 'video' ? 1 : Number(r.params.n ?? 1) }, (_, i) => {
    const pic = (w: number) => `https://picsum.photos/seed/gen-${r.id}-${i}/${w}/${h(w)}`
    return {
      id: `${r.id}-r${i}`, kind: r.kind, source: 'generation', status: 'ready', width: 1200, height: h(1200), duration_ms: r.kind === 'video' ? 5000 : null, thumb_state: 'done', created_at: r.updated_at,
      urls: r.kind === 'video'
        ? { orig: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', poster: pic(960), w480: pic(480) }
        : mockSignUrls({ w480: pic(480), w960: pic(960), orig: pic(1200) }),
    }
  })
}

function advance(r: MockRecord, now = Date.now()): GenerationRecord {
  const { _dur, _fail, _deleted, ...rec } = r
  void _deleted
  const t = now - Date.parse(r.created_at)
  const at = (ms: number) => new Date(Date.parse(r.created_at) + ms).toISOString()
  if (t < 1000) return { ...rec, status: 'queued' }
  if (t < _dur) return { ...rec, status: 'running', updated_at: at(t) }
  if (_fail) return { ...rec, status: 'failed', failure_code: 'upstream_unavailable', charged_points: '0', updated_at: at(_dur) }
  const avatar = isAvatarParams(r.params)
  const price = avatar ? mockAvatarCharge(r) : (r.model === 'z-image-turbo' ? 2 : 6) * Number(r.params.n ?? 1)
  return { ...rec, status: 'succeeded', results: avatar ? mockAvatarResults(r) : mockResults(r), charged_points: t > _dur + 1500 ? String(price) : null, updated_at: at(t > _dur + 1500 ? _dur + 1500 : _dur) }
}

const PAGE = 30
const mockApi: RecordsApi = {
  async list(q) {
    await mockDelay(150)
    const all = (await db()).records.filter(r => !r._deleted).map(r => advance(r))
      .filter(r => (!q.thread || r.thread_id === q.thread) && (q.status !== 'active' || r.status === 'queued' || r.status === 'running'))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
    const start = Number(q.cursor ?? 0)
    return { items: all.slice(start, start + PAGE), next_cursor: start + PAGE < all.length ? String(start + PAGE) : null }
  },
  async get(id) {
    await mockDelay(100)
    const r = (await db()).records.find(x => x.id === id && !x._deleted)
    if (!r) throw new Error('not found')
    return advance(r)
  },
  async findByItem(itemId) {
    await mockDelay(50)
    return (await db()).records.find(r => !r._deleted && r.idempotency_key === `q:${itemId}`)?.id ?? null
  },
  async move(id, thread_id) {
    const r = (await db()).records.find(x => x.id === id)
    if (r) { r.thread_id = thread_id; await save() }
  },
  async remove(id) {
    await mockDelay(200)
    const r = (await db()).records.find(x => x.id === id)
    if (r) { r._deleted = true; await save() }
  },
  async removeBatch(batch_id) {
    await mockDelay(200)
    ;(await db()).records.forEach(r => { if (r.batch_id === batch_id) r._deleted = true })
    await save()
  },
  async threads() {
    await mockDelay(150)
    return (await db()).threads.filter(t => !t._deleted).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  },
  async createThread(title) {
    await mockDelay(150)
    const now = new Date().toISOString()
    const t = { id: crypto.randomUUID(), title, created_at: now, updated_at: now }
    ;(await db()).threads.push(t)
    await save()
    return t
  },
  async renameThread(id, title) {
    await mockDelay(150)
    const t = (await db()).threads.find(x => x.id === id)
    if (t) { t.title = title; t.updated_at = new Date().toISOString(); await save() }
  },
  async deleteThread(id) {
    await mockDelay(150)
    const d = await db()
    const t = d.threads.find(x => x.id === id)
    if (t) t._deleted = true
    d.records.forEach(r => { if (r.thread_id === id) r._deleted = true })
    await save()
  },
}

/** Pure: the mock gateway's record for a submit (exported for contracts/mocks.test.ts). */
export function mockRecord(v: PendingGeneration, id: string, now = new Date().toISOString()): MockRecord {
  return {
    id, thread_id: v.thread_id, batch_id: v.batch_id, batch_position: v.batch_position, anchor_record_id: v.anchor_record_id,
    parent_record_id: v.parent_record_id ?? null, idempotency_key: `q:${v.item_id}`, kind: v.kind, model: v.model, prompt: v.prompt,
    prompt_doc: v.prompt_doc, mentions: v.mentions, params: v.params, source: 'studio', status: 'queued', failure_code: null,
    charged_points: null, request_id: null, task_id: null, references: v.references.map(a => ({ source: 'upload' as const, thumb_state: 'done' as const, created_at: now, ...a })),
    results: [], created_at: now, updated_at: now,
    _dur: 3000 + Math.random() * 5000, _fail: Math.random() < mockFailRate() * 2,
  }
}
export const advanceMockRecord = (r: MockRecord, now?: number) => advance(r, now)

async function mockCreate(v: PendingGeneration, id: string) {
  const d = await db()
  if (d.records.some(r => r.id === id || r.idempotency_key === `q:${v.item_id}`)) return
  d.records.push(mockRecord(v, id))
  await save()
}

export const recordsApi: RecordsApi = isMock ? mockApi : realApi

/* ---------- queries ---------- */

export const recordKeys = {
  all: ['generations'] as const,
  thread: (id: string) => ['generations', 'thread', id] as const,
  active: ['generations', 'active'] as const,
  threads: ['threads'] as const,
}

const hasUnsettled = (items: GenerationRecord[]) =>
  items.some(r => (r.status === 'succeeded' && r.charged_points == null && Date.now() - Date.parse(r.updated_at) < 120_000) || r.status === 'queued' || r.status === 'running')

export const useThreadRecords = (threadId: string | null) => useInfiniteQuery({
  queryKey: recordKeys.thread(threadId ?? ''),
  queryFn: ({ pageParam }) => recordsApi.list({ thread: threadId!, cursor: pageParam }),
  initialPageParam: null as string | null,
  getNextPageParam: last => last.next_cursor,
  enabled: !!threadId,
  // Active progress comes from the single active poll; this only re-reads briefly while charges settle.
  refetchInterval: q => hasUnsettled(q.state.data?.pages[0]?.items ?? []) ? 5000 : false,
})

/** One request for all active records (§2.5 任务恢复), every 3s while any, refetch on focus. */
export const useActiveGenerations = () => useQuery({
  queryKey: recordKeys.active,
  enabled: isMock || !!useCurrentUser().data, // signed out: nothing to poll (would 401 every time)
  queryFn: async () => (await recordsApi.list({ status: 'active' })).items,
  refetchInterval: q => q.state.data?.length ? 3000 : false,
  refetchOnWindowFocus: true,
  staleTime: 0,
})

export const useThreads = () => useQuery({ queryKey: recordKeys.threads, queryFn: recordsApi.threads, staleTime: 60_000 })

/* ---------- glue: accepted submits → records, default thread, anchors ---------- */

/** record_id → anchor item_id, for anchors that have dependents waiting in composer/send.ts. */
const watchedAnchors = new Map<string, string>()
const accepted = new Set<string>()
let todayThread: Promise<Thread> | undefined

/** Client-side default thread (§8.5): today's local date; created on the first send that had no thread. */
export function ensureTodayThread(): Promise<Thread> {
  return (todayThread ??= (async () => {
    const title = todayTitle()
    const list = await queryClient.fetchQuery({ queryKey: recordKeys.threads, queryFn: recordsApi.threads })
    const t = list.find(x => x.title === title) ?? await recordsApi.createThread(title)
    void queryClient.invalidateQueries({ queryKey: recordKeys.threads })
    return t
  })().catch(e => { todayThread = undefined; throw e }))
}

async function onAccepted(v: PendingGeneration, out: SubmitOutcome) {
  if (out.status !== 'accepted' || accepted.has(v.item_id)) return
  accepted.add(v.item_id)
  if (isMock) await mockCreate(v, crypto.randomUUID())
  // Submit responses are the upstream body passed through (no record id): look the record up by idempotency key.
  const id = await recordsApi.findByItem(v.item_id).catch(() => null)
  if (id && sender.waitingFor(v.item_id).length) watchedAnchors.set(id, v.item_id)
  else if (!id && sender.waitingFor(v.item_id).length) onAnchorFailed(v.item_id) // ponytail: no retry on lookup miss; dependents cancelled, user resends
  if (!v.thread_id && id) {
    try {
      const t = await ensureTodayThread()
      await recordsApi.move(id, t.id)
      if (!useComposer.getState().threadId) useComposer.setState({ threadId: t.id })
    } catch { /* stays unfiled; still visible via the active poll */ }
  }
  void queryClient.invalidateQueries({ queryKey: recordKeys.all })
}

function fireAnchors(records: GenerationRecord[]) {
  for (const c of anchorCalls(records, watchedAnchors)) {
    if (c.assetId) void onAnchorSucceeded(c.itemId, c.assetId, c.recordId)
    else onAnchorFailed(c.itemId)
  }
}

let prevActive = new Set<string>()
if (typeof window !== 'undefined') {
  queryClient.getMutationCache().subscribe(e => {
    if (e.type !== 'updated' || e.action.type !== 'success') return
    const key = e.mutation.options.mutationKey
    if (!key || key[0] !== GENERATION_SUBMIT_KEY[0] || key[1] !== GENERATION_SUBMIT_KEY[1]) return
    void onAccepted(e.mutation.state.variables as PendingGeneration, e.action.data as SubmitOutcome)
  })
  queryClient.getQueryCache().subscribe(e => {
    if (e.type !== 'updated' || e.action.type !== 'success') return
    const key = e.query.queryKey
    if (key[0] !== 'generations') return
    if (key[1] === 'active') {
      const items = e.action.data as GenerationRecord[]
      const now = new Set(items.map(r => r.id))
      const finished = [...prevActive].filter(id => !now.has(id))
      prevActive = now
      if (finished.length) void queryClient.invalidateQueries({ queryKey: ['generations', 'thread'] })
      // Anchors that left the active list (or finished before ever being listed): read them once.
      for (const [rid] of watchedAnchors) if (!now.has(rid)) void recordsApi.get(rid).then(r => fireAnchors([r])).catch(() => {})
    } else {
      const data = e.action.data as { pages: Page<GenerationRecord>[] } | undefined
      fireAnchors(data?.pages.flatMap(p => p.items) ?? [])
    }
  })
}

