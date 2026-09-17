import { StrictMode, useCallback, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Folder, Image as ImageIcon } from 'lucide-react'
import '@/styles/theme.css'
import {
  DropTarget, MasonryGrid, MediaCard, MediaDndProvider, MediaLightbox, UploadDropzone, useSelection, useUpload,
  type MasonryGridHandle, type MediaAsset, type UploadApi,
} from '..'

const RATIOS: [number, number][] = [[3, 4], [1, 1], [2, 3], [16, 9], [9, 16], [4, 5]]
const VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'

function makeAsset(i: number): MediaAsset {
  if (i % 97 === 5) {
    return { id: `v${i}`, kind: 'video', status: 'ready', width: 1280, height: 720, duration_ms: 5000,
      urls: { orig: VIDEO, poster: `https://picsum.photos/seed/v${i}/960/540` } }
  }
  const [rw, rh] = RATIOS[(i * 7 + 3) % RATIOS.length]!
  const pic = (w: number) => `https://picsum.photos/seed/${i}/${w}/${Math.round((w * rh) / rw)}`
  return { id: `a${i}`, kind: 'image', status: 'ready', width: rw * 400, height: rh * 400, duration_ms: null,
    urls: { w480: pic(480), w960: pic(960), orig: pic(rw * 400) } }
}

const PAGE = 60
const TOTAL = 1000
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms)
  signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('aborted', 'AbortError')) })
})

// Fake PUT: timer-driven XHR stand-in (no network), ~25% fail midway.
class DemoXHR {
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {}
  onload?: () => void; onerror?: () => void; onabort?: () => void
  status = 0
  private t?: ReturnType<typeof setInterval>
  open() {} setRequestHeader() {}
  send() {
    let loaded = 0
    const fail = Math.random() < 0.25
    this.t = setInterval(() => {
      loaded += 0.1
      this.upload.onprogress?.({ lengthComputable: true, loaded: Math.min(loaded, 1), total: 1 })
      if (fail && loaded > 0.55) { clearInterval(this.t); this.onerror?.() }
      else if (loaded >= 1) { clearInterval(this.t); this.status = 200; this.onload?.() }
    }, 200)
  }
  abort() { clearInterval(this.t); this.onabort?.() }
}
;(globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest = DemoXHR

const api: UploadApi = {
  async createUpload(req, signal) {
    await wait(150, signal)
    const asset_id = crypto.randomUUID()
    return { asset_id, put_url: `https://r2.example/${asset_id}`, headers: { 'content-type': req.content_type } }
  },
  async completeUpload(id, signal) {
    await wait(400, signal)
    const seed = parseInt(id.slice(0, 6), 16)
    const [rw, rh] = RATIOS[seed % RATIOS.length]!
    const pic = (w: number) => `https://picsum.photos/seed/up${seed}/${w}/${Math.round((w * rh) / rw)}`
    return { id, kind: 'image', status: 'ready', width: rw * 400, height: rh * 400, duration_ms: null, urls: { w480: pic(480), w960: pic(960), orig: pic(rw * 400) } }
  },
}

function Demo() {
  const [count, setCount] = useState(() => (new URLSearchParams(location.search).has("all") ? TOTAL : PAGE))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [empty, setEmpty] = useState(false)
  const all = useMemo(() => Array.from({ length: TOTAL }, (_, i) => makeAsset(i)), [])
  const upload = useUpload({ api })

  const items = useMemo(() => empty ? [] : [...upload.items.map((u): { asset: MediaAsset; state?: Parameters<typeof MediaCard>[0]['state'] } => ({
    asset: u.asset ?? { id: u.clientId, kind: u.kind, status: 'pending', width: null, height: null, duration_ms: null, urls: { orig: u.previewUrl ?? '' } },
    state: u.status === 'uploading' ? { kind: 'uploading', progress: u.progress }
      : u.status === 'processing' ? { kind: 'generating' }
      : u.status === 'failed' || u.status === 'interrupted' ? { kind: 'failed', reason: u.error ?? '上传失败', onRetry: u.file ? () => upload.retry(u.clientId) : undefined }
      : undefined,
  })), ...all.slice(0, count).map((asset, i) => ({ asset, state: i === 2 ? { kind: 'generating' as const } : undefined }))], [empty, upload.items, upload.retry, all, count])
  const ids = useMemo(() => items.map((x) => x.asset.id), [items])
  const sel = useSelection(ids)
  const grid = useRef<MasonryGridHandle>(null)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [dropped, setDropped] = useState({ folder: 0, images: 0 })

  const more = useCallback(() => {
    if (count >= TOTAL) return
    setLoading(true)
    setTimeout(() => {
      setLoading(false)
      if (Math.random() < 0.1) setError('加载失败：网络超时')
      else setCount((c) => Math.min(TOTAL, c + PAGE))
    }, 600)
  }, [count])

  const byId = new Map(items.map((x) => [x.asset.id, x.asset]))
  const selectedAssets = [...sel.selected].map((id) => byId.get(id)).filter((x): x is MediaAsset => !!x)

  return (
    <MediaDndProvider>
      <div className="mx-auto flex max-w-[1760px] flex-col gap-4 px-4 py-6 md:px-8">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold">媒体组件 Demo</h1>
          <span className="text-sm text-muted">{count} / {TOTAL} 条 · 已选 {sel.selected.size}</span>
          <button className="rounded-control border border-line bg-card px-3 py-1 text-sm hover:bg-subtle" onClick={() => grid.current?.scrollToIndex(500)}>跳到第 500 张</button>
          <button className="rounded-control border border-line bg-card px-3 py-1 text-sm hover:bg-subtle" onClick={() => setEmpty((e) => !e)}>切换空态</button>
          {sel.selected.size > 0 && <button className="rounded-control border border-line bg-card px-3 py-1 text-sm hover:bg-subtle" onClick={sel.clear}>清除选择</button>}
        </header>
        <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
          <UploadDropzone upload={upload} />
          <DropTarget id="folder" onDrop={(xs) => setDropped((d) => ({ ...d, folder: d.folder + xs.length }))} onFiles={(fs) => upload.add(fs)} className="flex flex-col items-center justify-center gap-1 border border-line bg-card p-4 text-sm" >
            <Folder size={24} className="text-muted" aria-hidden />文件夹（全部可放）<span className="text-xs text-muted">已放入 {dropped.folder}</span>
          </DropTarget>
          <DropTarget id="images" accept={(xs) => (xs.every((x) => x.kind === 'image') ? true : '参考图槽位只接受图片')} onDrop={(xs) => setDropped((d) => ({ ...d, images: d.images + xs.length }))} className="flex flex-col items-center justify-center gap-1 border border-line bg-card p-4 text-sm">
            <ImageIcon size={24} className="text-muted" aria-hidden />参考图槽位（仅图片）<span className="text-xs text-muted">已放入 {dropped.images}</span>
          </DropTarget>
        </div>
        <MasonryGrid
          ref={grid}
          aria-label="灵感瀑布流"
          items={items}
          getKey={(x) => x.asset.id}
          getAspect={(x) => (x.asset.width && x.asset.height ? x.asset.height / x.asset.width : null)}
          loading={loading}
          error={error}
          onRetry={() => { setError(null); more() }}
          onEndReached={more}
          renderItem={(x, i) => (
            <MediaCard
              asset={x.asset}
              title={`作品 #${i + 1}`}
              state={x.state}
              priority={i < 8}
              onOpen={() => setLightbox(i)}
              selected={sel.isSelected(x.asset.id)}
              selectionMode={sel.selected.size > 0}
              onSelect={(m) => sel.select(x.asset.id, m)}
              dragItems={sel.isSelected(x.asset.id) ? selectedAssets : [x.asset]}
              disabled={i === 4 ? '该作品已下架' : undefined}
            />
          )}
        />
        <MediaLightbox
          items={items.map((x, i) => ({ asset: x.asset, caption: `作品 #${i + 1}` }))}
          index={lightbox ?? 0}
          open={lightbox !== null}
          onIndexChange={setLightbox}
          onClose={() => setLightbox(null)}
        />
      </div>
    </MediaDndProvider>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Demo /></StrictMode>)
