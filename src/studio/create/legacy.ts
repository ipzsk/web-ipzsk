// F8 旧版本地历史导入（只读）：旧 /image 工作台的 IndexedDB `ipzsk-image-studio`（image-studio/web/storage.ts：store `records`，
// 键 ['user', uid, 'history' | 'gallery']，作品 images[].url 是 data: URL）与旧 /video 页的 localStorage
// （image-studio/web/video/api.ts：`ipzsk.video.tasks.v1.<uid>`，没有时读单条 `ipzsk.video.latest.v1.<uid>`，url 是上游签名地址）。
// 原数据只读不改；「导入」只在本机记一个标记，之后「旧版记录导入」会话每次现读原数据渲染，不调用任何生成接口。

export interface LegacyItem {
  id: string
  kind: 'image' | 'video'
  prompt: string
  model: string
  createdAt: number
  urls: string[]
  /** 展示用参数（比例 / 清晰度 / 时长）。 */
  meta: string[]
  /** 来源：旧生图「我的作品」/「作品集」/ 旧生视频。 */
  source: 'history' | 'gallery' | 'video'
}

export interface LegacyRaw { history: unknown; gallery: unknown; videoTasks: unknown; videoLatest: unknown }

const rows = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []
const str = (v: unknown) => typeof v === 'string' ? v : ''
const time = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : 0
const isMediaUrl = (u: string) => /^(https:|data:image\/)/.test(u)

/** 原始数据 → 展示条目：只保留有媒体地址的，按 id 去重（作品集与我的作品可能重复），新的在前。 */
export function toLegacyItems(raw: LegacyRaw): LegacyItem[] {
  const out = new Map<string, LegacyItem>()
  const image = (source: 'history' | 'gallery') => (e: Record<string, unknown>) => {
    const urls = rows(e.images).map(i => str(i.url)).filter(isMediaUrl)
    const id = str(e.id)
    if (!id || !urls.length || out.has(`image:${id}`)) return
    out.set(`image:${id}`, {
      id: `image:${id}`, kind: 'image', source, prompt: str(e.prompt), model: str(e.model), createdAt: time(e.createdAt), urls,
      meta: [str(e.size), str(e.quality).toUpperCase()].filter(Boolean),
    })
  }
  rows(raw.history).forEach(image('history'))
  rows(raw.gallery).forEach(image('gallery'))
  const tasks = Array.isArray(raw.videoTasks) ? rows(raw.videoTasks) : rows(raw.videoLatest ? [raw.videoLatest] : [])
  for (const t of tasks) {
    const url = str(t.url), id = str(t.id)
    if (!id || !isMediaUrl(url) || out.has(`video:${id}`)) continue
    out.set(`video:${id}`, {
      id: `video:${id}`, kind: 'video', source: 'video', prompt: str(t.prompt), model: str(t.modelName) || str(t.model), createdAt: time(t.createdAt), urls: [url],
      meta: [str(t.resolution), typeof t.duration === 'number' ? `${t.duration}秒` : ''].filter(Boolean),
    })
  }
  return [...out.values()].sort((a, b) => b.createdAt - a.createdAt)
}

/** 签名地址会过期；data: URL 是存在本机的原图，不会失效。 */
export const mayBeExpired = (i: LegacyItem) => i.urls.some(u => !u.startsWith('data:'))

// ── 读取（浏览器）──────────────────────────────────────────────────────────

const DB = 'ipzsk-image-studio'

/** 读旧库的一个键。库不存在时绝不新建（onupgradeneeded 里中止），免得旧页面以后打开时拿到没有 store 的空库。 */
export function readImageStudio(key: IDBValidKey, idb: IDBFactory | undefined = globalThis.indexedDB): Promise<unknown> {
  return new Promise(resolve => {
    if (!idb) { resolve(undefined); return }
    let req: IDBOpenDBRequest
    try { req = idb.open(DB) } catch { resolve(undefined); return }
    req.onupgradeneeded = () => req.transaction?.abort()
    req.onerror = () => resolve(undefined)
    req.onblocked = () => resolve(undefined)
    req.onsuccess = () => {
      const db = req.result
      try {
        if (!db.objectStoreNames.contains('records')) { db.close(); resolve(undefined); return }
        const get = db.transaction('records').objectStore('records').get(key)
        get.onsuccess = () => { db.close(); resolve(get.result) }
        get.onerror = () => { db.close(); resolve(undefined) }
      } catch { db.close(); resolve(undefined) }
    }
  })
}

const parse = (s: string | null) => { try { return s ? JSON.parse(s) : undefined } catch { return undefined } }

export async function loadLegacy(uid: string, deps: { read?: (key: IDBValidKey) => Promise<unknown>; getItem?: (k: string) => string | null } = {}): Promise<LegacyItem[]> {
  const read = deps.read ?? (k => readImageStudio(k))
  const getItem = deps.getItem ?? (k => { try { return localStorage.getItem(k) } catch { return null } })
  const [history, gallery] = await Promise.all([read(['user', uid, 'history']), read(['user', uid, 'gallery'])])
  return toLegacyItems({ history, gallery, videoTasks: parse(getItem(`ipzsk.video.tasks.v1.${uid}`)), videoLatest: parse(getItem(`ipzsk.video.latest.v1.${uid}`)) })
}

// ── 每个用户一次的标记 ─────────────────────────────────────────────────────

export type LegacyMarker = { state: 'imported' | 'dismissed'; at: number }
const markerKey = (uid: string) => `ipzsk.legacy-import.v1.${uid}`
export const legacyMarker = {
  read: (uid: string): LegacyMarker | null => { try { return parse(localStorage.getItem(markerKey(uid))) ?? null } catch { return null } },
  write: (uid: string, state: LegacyMarker['state']) => { try { localStorage.setItem(markerKey(uid), JSON.stringify({ state, at: Date.now() })) } catch { /* private mode */ } },
}

/** 本地会话 id（不是服务端 thread；发送时不会带上）。 */
export const LEGACY_THREAD_ID = 'legacy-import'
export const LEGACY_THREAD_TITLE = '旧版记录导入'
