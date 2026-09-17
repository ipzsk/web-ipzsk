import { get, set } from 'idb-keyval'
import { ApiError, errorMessage } from '@/shared/api'
import type { MediaAsset } from '@/media'
import type { Asset, AssetsApi, Folder } from './api'

/*
 * `?mock=1` backend for the assets view: IndexedDB-persisted (idb-keyval), picsum images with random ratios,
 * 200–600ms latency, ~5% failures on writes (localStorage['ipzsk.mock.failRate'] overrides, e.g. '0'),
 * first `complete` of an upload answers 409 upload_not_found 35% of the time.
 */

type State = { assets: Asset[]; folders: Folder[]; items: Record<string, string[]>; favs: string[]; seq: number }
type Pending = { kind: 'image' | 'video'; bytes: number; tries: number }
type Opts = {
  load?: () => Promise<State | undefined>
  save?: (s: State) => Promise<void>
  latency?: () => number
  failRate?: number
  random?: () => number
  pageSize?: number
}

const KEY = 'ipzsk.mock.assets.v1'
const RATIOS: [number, number][] = [[3, 4], [1, 1], [2, 3], [16, 9], [9, 16], [4, 5], [4, 3]]
const MB = 1024 * 1024
const pic = (seed: string, w: number, h: number) => `https://picsum.photos/seed/${seed}/${w}/${h}`

function mkAsset(id: string, i: number, source: Asset['source'], created: number, random: () => number, kind: 'image' | 'video' = 'image'): Asset {
  const [rw, rh] = RATIOS[Math.floor(random() * RATIOS.length)]!
  const w = 1200, h = Math.round((1200 * rh) / rw)
  const seed = `ipzsk-${id}`
  const processing = i % 17 === 5
  const urls: MediaAsset['urls'] = kind === 'video'
    ? { orig: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', poster: pic(seed, 960, Math.round((960 * rh) / rw)), w480: pic(seed, 480, Math.round((480 * rh) / rw)) }
    : processing
      ? { orig: pic(seed, w, h) }
      : { orig: pic(seed, w, h), w480: pic(seed, 480, Math.round((480 * rh) / rw)), w960: pic(seed, 960, Math.round((960 * rh) / rw)) }
  return {
    id, kind, source, status: 'ready', width: w, height: h, duration_ms: kind === 'video' ? 5000 : null,
    created_at: new Date(created).toISOString(), thumb_state: processing ? 'running' : 'done', urls,
  }
}

function seedState(random: () => number): State {
  const now = Date.now()
  const assets = Array.from({ length: 64 }, (_, i) =>
    mkAsset(`seed-${i}`, i, i % 3 === 0 ? 'upload' : 'generation', now - i * 3_600_000, random, i === 7 || i === 30 ? 'video' : 'image'))
  const folders: Folder[] = [
    { id: 'f-brand', name: '品牌素材', position: 1, count: 0 },
    { id: 'f-portrait', name: '人像参考', position: 2, count: 0 },
  ]
  const items = { 'f-brand': assets.slice(0, 6).map((a) => a.id), 'f-portrait': assets.slice(10, 13).map((a) => a.id) }
  return { assets, folders, items, favs: [assets[1]!.id], seq: 64 }
}

export function createMockApi(opts: Opts = {}): AssetsApi {
  const random = opts.random ?? Math.random
  const load = opts.load ?? (() => get<State>(KEY))
  const save = opts.save ?? ((s: State) => set(KEY, s))
  const latency = opts.latency ?? (() => 200 + random() * 400)
  const pageSize = opts.pageSize ?? 50
  const failRate = () => {
    if (opts.failRate != null) return opts.failRate
    try { const v = localStorage['ipzsk.mock.failRate']; return v != null ? Number(v) : 0.05 } catch { return 0.05 }
  }

  let state: Promise<State> | undefined
  const db = () => (state ??= load().catch(() => undefined).then((s) => s ?? seedState(random)))
  const commit = async (s: State) => { try { await save(s) } catch { /* private mode: memory only */ } }
  const wait = () => new Promise((r) => setTimeout(r, latency()))
  const fail = (status: number, code: string): never => { throw new ApiError(errorMessage(code), { status, code }) }
  const flaky = () => { if (random() < failRate()) fail(503, 'mock_failure') }
  const live = (s: State) => s.assets.filter((a) => a.status !== 'deleted')
  const withCounts = (s: State) => {
    const alive = new Set(live(s).map((a) => a.id))
    return [...s.folders].sort((a, b) => a.position - b.position)
      .map((f) => ({ ...f, count: (s.items[f.id] ?? []).filter((id) => alive.has(id)).length }))
  }
  const pending = new Map<string, Pending>()

  return {
    async listAssets(q, cursor) {
      await wait()
      const s = await db()
      const inFolder = q.folder ? new Set(s.items[q.folder] ?? []) : null
      if (q.folder && !s.folders.some((f) => f.id === q.folder)) fail(404, 'folder_not_found')
      const all = live(s).filter((a) => (!q.kind || a.kind === q.kind) && (!q.source || a.source === q.source) && (!inFolder || inFolder.has(a.id)))
      const start = Number(cursor ?? 0)
      const end = start + pageSize
      return { items: all.slice(start, end), next_cursor: end < all.length ? String(end) : null }
    },
    async deleteAsset(id) {
      await wait(); flaky()
      const s = await db()
      const a = s.assets.find((x) => x.id === id)
      if (!a || a.status === 'deleted') fail(404, 'asset_not_found')
      a!.status = 'deleted'
      await commit(s)
    },
    async listFolders() { await wait(); return withCounts(await db()) },
    async createFolder(name) {
      await wait(); flaky()
      const s = await db()
      if (s.folders.some((f) => f.name === name)) fail(409, 'folder_name_taken')
      const f: Folder = { id: `f-${++s.seq}`, name, position: Math.max(0, ...s.folders.map((x) => x.position)) + 1, count: 0 }
      s.folders.push(f)
      await commit(s)
      return f
    },
    async updateFolder(id, patch) {
      await wait(); flaky()
      const s = await db()
      const f = s.folders.find((x) => x.id === id)
      if (!f) return fail(404, 'folder_not_found')
      if (patch.name != null && s.folders.some((x) => x.id !== id && x.name === patch.name)) fail(409, 'folder_name_taken')
      Object.assign(f, patch)
      await commit(s)
      return withCounts(s).find((x) => x.id === id)!
    },
    async deleteFolder(id) {
      await wait(); flaky()
      const s = await db()
      s.folders = s.folders.filter((f) => f.id !== id)
      delete s.items[id]
      await commit(s)
    },
    async addToFolder(id, assetIds) {
      await wait(); flaky()
      const s = await db()
      if (!s.folders.some((f) => f.id === id)) fail(404, 'folder_not_found')
      s.items[id] = [...new Set([...assetIds, ...(s.items[id] ?? [])])]
      await commit(s)
    },
    async listFavoriteAssets() { await wait(); return [...(await db()).favs] },
    async setFavorite(id, on) {
      await wait(); flaky()
      const s = await db()
      s.favs = on ? [...new Set([...s.favs, id])] : s.favs.filter((x) => x !== id)
      await commit(s)
    },
    async createUpload(req) {
      await wait()
      if (req.bytes > (req.kind === 'video' ? 200 : 20) * MB) fail(413, 'file_too_large')
      if (random() < failRate()) fail(429, 'rate_limited')
      const asset_id = crypto.randomUUID()
      pending.set(asset_id, { kind: req.kind, bytes: req.bytes, tries: 0 })
      // The Vite dev server answers PUT /studio.html with 200, so the real XHR progress path runs.
      return { asset_id, put_url: '/studio.html', headers: { 'Content-Type': req.content_type, 'Cache-Control': 'private, max-age=21600' } }
    },
    async completeUpload(id) {
      await wait()
      const p = pending.get(id)
      if (!p) return fail(404, 'asset_not_found')
      if (p.tries++ === 0 && random() < 0.35) fail(409, 'upload_not_found')
      const s = await db()
      s.seq++
      const asset = mkAsset(id, 0, 'upload', Date.now(), random, p.kind)
      pending.delete(id)
      s.assets.unshift(asset)
      await commit(s)
      return asset
    },
  }
}
