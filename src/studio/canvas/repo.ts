import { del, get, set } from 'idb-keyval'
import { API_BASE, UNAUTHORIZED_EVENT } from '@/shared/api'
import { isMock } from '../api/catalog'
import { emptyDocument, previewBoxes, fromDocument, type CanvasDocument, type NodeKind } from './graph'

/** Mirrors canvas_projects (§8.6) minus user_id/document. */
export interface CanvasProjectMeta {
  id: string
  title: string
  revision: number
  created_at: string
  updated_at: string
  /** Local thumbnail source until thumb_id (server-rendered) exists. */
  preview: { x: number; y: number; w: number; h: number; kind: NodeKind }[]
  /** Local changes not yet accepted by the server (the offline queue). */
  dirty?: boolean
  /** Never accepted by the server (created / copied locally): sync POSTs it instead of PUT → 404 → POST. */
  unsynced?: boolean
}

export interface CanvasProjectSnapshot { meta: CanvasProjectMeta; document: CanvasDocument }

export type SyncResult = 'synced' | 'offline' | { conflict: CanvasProjectSnapshot }

export interface CanvasRepo {
  list(): Promise<CanvasProjectMeta[]>
  create(title?: string): Promise<CanvasProjectMeta>
  get(id: string): Promise<CanvasProjectSnapshot | null>
  /** Local write; must be cheap enough to call on every change. */
  save(id: string, document: CanvasDocument): Promise<void>
  rename(id: string, title: string): Promise<void>
  duplicate(id: string): Promise<CanvasProjectMeta | null>
  /** Returns the removed project so the caller can offer undo via restore(). */
  remove(id: string): Promise<CanvasProjectSnapshot | null>
  restore(snapshot: CanvasProjectSnapshot): Promise<void>
  /** Push to server. Local impl only reports connectivity. */
  sync(id: string): Promise<SyncResult>
}

export type LocalRepo = CanvasRepo & { setMeta(id: string, p: Partial<CanvasProjectMeta>): Promise<void> }

export interface KV {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  del(key: string): Promise<void>
}
const idbKV: KV = { get, set, del }

const LIST_KEY = 'ipzsk.canvas.projects'
const docKey = (id: string) => `ipzsk.canvas.doc.${id}`
const now = () => new Date().toISOString()

const navOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine)

export function createLocalRepo(kv: KV = idbKV, online = navOnline): LocalRepo {
  const list = async () => (await kv.get<CanvasProjectMeta[]>(LIST_KEY)) ?? []
  const writeList = (xs: CanvasProjectMeta[]) => kv.set(LIST_KEY, xs)
  // ponytail: list writes are read-modify-write without a lock; fine for one tab, BroadcastChannel/locks if multi-tab edits matter.
  const patchMeta = async (id: string, p: Partial<CanvasProjectMeta>) => {
    const xs = await list()
    await writeList(xs.map(m => (m.id === id ? { ...m, ...p } : m)))
  }

  const repo: LocalRepo = {
    setMeta: patchMeta,
    async list() {
      return (await list()).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    },
    async create(title = '未命名画布') {
      const t = now()
      const meta: CanvasProjectMeta = { id: crypto.randomUUID(), title: title.slice(0, 80), revision: 1, created_at: t, updated_at: t, preview: [], dirty: true, unsynced: true }
      await kv.set(docKey(meta.id), emptyDocument())
      await writeList([meta, ...(await list())])
      return meta
    },
    async get(id) {
      const meta = (await list()).find(m => m.id === id)
      if (!meta) return null
      return { meta, document: (await kv.get<CanvasDocument>(docKey(id))) ?? emptyDocument() }
    },
    async save(id, document) {
      await kv.set(docKey(id), document)
      await patchMeta(id, { updated_at: now(), preview: previewBoxes(fromDocument(document).nodes), dirty: true })
    },
    async rename(id, title) {
      await patchMeta(id, { title: title.trim().slice(0, 80) || '未命名画布', updated_at: now(), dirty: true })
    },
    async duplicate(id) {
      const src = await repo.get(id)
      if (!src) return null
      const t = now()
      const meta: CanvasProjectMeta = { ...src.meta, id: crypto.randomUUID(), title: `${src.meta.title} 副本`.slice(0, 80), revision: 1, created_at: t, updated_at: t, dirty: true, unsynced: true }
      await kv.set(docKey(meta.id), structuredClone(src.document))
      await writeList([meta, ...(await list())])
      return meta
    },
    async remove(id) {
      const snap = await repo.get(id)
      if (!snap) return null
      await writeList((await list()).filter(m => m.id !== id))
      await kv.del(docKey(id))
      return snap
    },
    async restore({ meta, document }) {
      await kv.set(docKey(meta.id), document)
      await writeList([meta, ...(await list()).filter(m => m.id !== meta.id)])
    },
    async sync() {
      // No server: only reports connectivity. createSyncedRepo does the real PUT.
      return online() ? 'synced' : 'offline'
    },
  }
  return repo
}

// ---------- server sync (§8.6) ----------

/**
 * Contract: GET/POST /api/me/canvas, GET/PUT/DELETE /api/me/canvas/:id.
 * Body `{ title, document, revision }`. PUT with a stale revision → 409 `{ error: { code: 'canvas_conflict' }, project }`.
 * Assumption: POST accepts a client-generated `id` (uuid PK) so offline-created projects keep their URL.
 */
export interface ServerProject { id: string; title: string; document: CanvasDocument; revision: number; created_at: string; updated_at: string }

/** Resolves with any HTTP status; throws only when the network is unreachable. */
export type Transport = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<{ status: number; data: any }>

export const httpTransport: Transport = async (method, path, body) => {
  const r = await fetch(API_BASE + path, {
    method, credentials: 'include', cache: 'no-store',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (r.status === 401) window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
  return { status: r.status, data: await r.json().catch(() => null) }
}

const isServerProject = (p: any): p is ServerProject =>
  !!p && typeof p.id === 'string' && typeof p.revision === 'number' && !!p.document && Array.isArray(p.document.nodes)

export const toSnapshot = (p: ServerProject): CanvasProjectSnapshot => ({
  meta: { id: p.id, title: p.title, revision: p.revision, created_at: p.created_at, updated_at: p.updated_at, preview: previewBoxes(fromDocument(p.document).nodes), dirty: false },
  document: p.document,
})

/** Local-first: every read/write hits IndexedDB; the server is reconciled by sync() (dirty flag = offline queue). */
export function createSyncedRepo(local: LocalRepo, send: Transport, online = navOnline): LocalRepo {
  const pull = async (id: string, known?: CanvasProjectMeta) => {
    const r = await send('GET', `/api/me/canvas/${id}`)
    const p = r.data?.project ?? r.data
    if (r.status === 200 && isServerProject(p) && (!known || (!known.dirty && p.revision > known.revision))) await local.restore(toSnapshot(p))
  }
  return {
    ...local,
    async list() {
      if (online()) {
        try {
          const r = await send('GET', '/api/me/canvas')
          if (r.status === 200) {
            const items: { id: string; revision: number }[] = Array.isArray(r.data) ? r.data : r.data?.items ?? []
            const mine = await local.list()
            for (const it of items) {
              const m = mine.find(x => x.id === it.id)
              if (!m || (!m.dirty && it.revision > m.revision)) await pull(it.id, m)
            }
            // ponytail: local projects missing remotely are treated as never-synced and re-uploaded (also resurrects ones deleted on another device).
            for (const m of mine) if (!m.dirty && !items.some(it => it.id === m.id)) await local.setMeta(m.id, { dirty: true, unsynced: true })
          }
        } catch { /* offline: local list */ }
      }
      return local.list()
    },
    async get(id) {
      const snap = await local.get(id)
      if (online() && !snap?.meta.dirty) await pull(id, snap?.meta).catch(() => {})
      return local.get(id)
    },
    async remove(id) {
      const snap = await local.remove(id)
      // ponytail: offline deletes aren't queued; the project comes back on next list() if the DELETE never reached the server.
      if (snap && online()) await send('DELETE', `/api/me/canvas/${id}`).catch(() => {})
      return snap
    },
    async sync(id) {
      const snap = await local.get(id)
      if (!snap || !snap.meta.dirty) return 'synced'
      if (!online()) return 'offline'
      try {
        const { title, revision } = snap.meta
        const put = () => send('PUT', `/api/me/canvas/${id}`, { title, document: snap.document, revision })
        const post = () => send('POST', '/api/me/canvas', { id, title, document: snap.document })
        // New projects POST directly (no console 404); older local metas without the flag keep PUT → 404 → POST.
        let r = snap.meta.unsynced ? await post() : await put()
        if (r.status === 404 && !snap.meta.unsynced) r = await post()
        else if (r.status === 409 && snap.meta.unsynced && !isServerProject(r.data?.project)) r = await put() // an earlier POST landed but its response was lost
        if (r.status === 409) {
          const remote = r.data?.project
          return isServerProject(remote) ? { conflict: toSnapshot(remote) } : 'offline'
        }
        if (r.status < 200 || r.status >= 300) return 'offline' // ponytail: 5xx/401 look like offline; add an 'error' status if users need to tell them apart
        const next = r.data?.project?.revision ?? r.data?.revision ?? revision + 1
        const cur = await local.get(id)
        // Edits saved while the request was in flight stay dirty for the next round.
        await local.setMeta(id, { revision: next, dirty: cur?.meta.updated_at !== snap.meta.updated_at, unsynced: false })
        return 'synced'
      } catch {
        return 'offline'
      }
    },
  }
}

export type ConflictChoice = 'remote' | 'mine' | 'copy'

/**
 * 用远端覆盖本地 → local = remote. 保留我的并覆盖远端 → rebase my doc on remote revision, stays dirty (next sync wins).
 * 另存为副本 → my doc becomes a new dirty project, local original = remote. Returns the copy id.
 */
export async function resolveConflict(repo: CanvasRepo, id: string, choice: ConflictChoice, remote: CanvasProjectSnapshot): Promise<string | undefined> {
  const mine = await repo.get(id)
  if (!mine) return undefined
  if (choice === 'mine') {
    await repo.restore({ meta: { ...mine.meta, revision: remote.meta.revision, dirty: true, updated_at: now() }, document: mine.document })
    return undefined
  }
  let copyId: string | undefined
  if (choice === 'copy') {
    const t = now()
    copyId = crypto.randomUUID()
    await repo.restore({ meta: { ...mine.meta, id: copyId, title: `${mine.meta.title} 副本`.slice(0, 80), revision: 1, created_at: t, updated_at: t, dirty: true, unsynced: true }, document: mine.document })
  }
  await repo.restore({ meta: { ...remote.meta, dirty: false }, document: remote.document })
  return copyId
}

/** Offline queue flush: push every dirty project (skip = the open one, the editor syncs it itself). */
export async function syncDirty(repo: CanvasRepo, skip?: string | null) {
  const out: Record<string, SyncResult> = {}
  for (const m of await repo.list()) if (m.dirty && m.id !== skip) out[m.id] = await repo.sync(m.id)
  return out
}

// ---------- mock server (?mock=1) ----------

/** In-IndexedDB fake of the §8.6 endpoints. Throws like fetch when the browser is offline. */
export function createMockServer(kv: KV = idbKV, online = navOnline, delayMs = 150) {
  const KEY = 'ipzsk.canvas.mockserver'
  const load = async () => (await kv.get<Record<string, ServerProject>>(KEY)) ?? {}
  const transport: Transport = async (method, path, body: any) => {
    if (!online()) throw new TypeError('Failed to fetch')
    if (delayMs) await new Promise(r => setTimeout(r, delayMs))
    const db = await load()
    const id = path.match(/^\/api\/me\/canvas\/([^/]+)$/)?.[1]
    const t = now()
    if (!id && method === 'GET') return { status: 200, data: { items: Object.values(db).map(({ document: _d, ...m }) => m) } }
    if (!id && method === 'POST') {
      const p: ServerProject = { id: body.id ?? crypto.randomUUID(), title: body.title ?? '未命名画布', document: body.document, revision: 1, created_at: t, updated_at: t }
      await kv.set(KEY, { ...db, [p.id]: p })
      return { status: 201, data: { project: p } }
    }
    const cur = id ? db[id] : undefined
    if (!cur) return { status: 404, data: { error: { code: 'not_found' } } }
    if (method === 'GET') return { status: 200, data: { project: cur } }
    if (method === 'DELETE') { const { [cur.id]: _, ...rest } = db; await kv.set(KEY, rest); return { status: 204, data: null } }
    if (body.revision !== cur.revision) return { status: 409, data: { error: { code: 'canvas_conflict' }, project: cur } }
    const p: ServerProject = { ...cur, title: body.title ?? cur.title, document: body.document, revision: cur.revision + 1, updated_at: t }
    await kv.set(KEY, { ...db, [p.id]: p })
    return { status: 200, data: { project: p } }
  }
  /** Dev hook: pretend another device edited the project (adds a text node, bumps revision). */
  const simulateRemoteEdit = async (id: string) => {
    const db = await load()
    const cur = db[id]
    if (!cur) return false
    const node = { id: crypto.randomUUID(), type: 'text' as const, position: { x: 40, y: -200 }, data: { text: '另一台设备上的改动' } }
    const p = { ...cur, document: { ...cur.document, nodes: [...cur.document.nodes, node] }, revision: cur.revision + 1, updated_at: now() }
    await kv.set(KEY, { ...db, [id]: p })
    return true
  }
  return { transport, simulateRemoteEdit }
}

export const mockServer = isMock ? createMockServer() : null
export const canvasRepo = createSyncedRepo(createLocalRepo(), mockServer?.transport ?? httpTransport)
