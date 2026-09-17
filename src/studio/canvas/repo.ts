import { del, get, set } from 'idb-keyval'
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

export interface KV {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  del(key: string): Promise<void>
}
const idbKV: KV = { get, set, del }

const LIST_KEY = 'ipzsk.canvas.projects'
const docKey = (id: string) => `ipzsk.canvas.doc.${id}`
const now = () => new Date().toISOString()

export function createLocalRepo(kv: KV = idbKV, online = () => (typeof navigator === 'undefined' ? true : navigator.onLine)): CanvasRepo {
  const list = async () => (await kv.get<CanvasProjectMeta[]>(LIST_KEY)) ?? []
  const writeList = (xs: CanvasProjectMeta[]) => kv.set(LIST_KEY, xs)
  // ponytail: list writes are read-modify-write without a lock; fine for one tab, BroadcastChannel/locks if multi-tab edits matter.
  const patchMeta = async (id: string, p: Partial<CanvasProjectMeta>) => {
    const xs = await list()
    await writeList(xs.map(m => (m.id === id ? { ...m, ...p } : m)))
  }

  const repo: CanvasRepo = {
    async list() {
      return (await list()).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    },
    async create(title = '未命名画布') {
      const t = now()
      const meta: CanvasProjectMeta = { id: crypto.randomUUID(), title: title.slice(0, 80), revision: 1, created_at: t, updated_at: t, preview: [] }
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
      await patchMeta(id, { updated_at: now(), preview: previewBoxes(fromDocument(document).nodes) })
    },
    async rename(id, title) {
      await patchMeta(id, { title: title.trim().slice(0, 80) || '未命名画布', updated_at: now() })
    },
    async duplicate(id) {
      const src = await repo.get(id)
      if (!src) return null
      const t = now()
      const meta: CanvasProjectMeta = { ...src.meta, id: crypto.randomUUID(), title: `${src.meta.title} 副本`.slice(0, 80), revision: 1, created_at: t, updated_at: t }
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
      // TODO(§8.6): PUT /api/me/canvas/:id { document, revision }; 200 → bump local revision;
      // 409 → return { conflict: remote } and let the editor offer 「覆盖远端 / 另存副本」 (TriangleAlert status).
      return online() ? 'synced' : 'offline'
    },
  }
  return repo
}

export const canvasRepo = createLocalRepo()
