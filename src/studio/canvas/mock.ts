import { useEffect, useState } from 'react'
import { get, set } from 'idb-keyval'
import type { ModelSpec } from '@/shared/contracts'
import type { AssetRef } from './graph'

/** Local stand-ins until the model catalog / generation API / upload API are wired (§10). */

export const MOCK_MODELS: ModelSpec[] = [
  {
    id: 'gpt-image-2', kind: 'image', name: 'GPT Image 2', description: '通用图像，擅长文字与排版', billing_unit: '张',
    references: { max: 15 },
    params: [
      { name: 'aspect_ratio', label: '比例', type: 'enum', values: ['1:1', '3:4', '4:3', '9:16', '16:9'], default: '1:1' },
      { name: 'resolution', label: '清晰度', type: 'enum', values: ['1K', '2K'], default: '1K' },
      { name: 'n', label: '张数', type: 'integer', values: [1, 2, 3, 4], default: 1 },
    ],
  },
  {
    id: 'gpt-image-2.5-flare', kind: 'image', name: 'GPT Image 2.5 Flare', description: '高清出图', billing_unit: '张',
    references: { max: 4 },
    params: [
      { name: 'aspect_ratio', label: '比例', type: 'enum', values: ['1:1', '3:4', '16:9'], default: '1:1' },
      { name: 'resolution', label: '清晰度', type: 'enum', values: ['1K', '2K', '4K'], default: '2K' },
      { name: 'n', label: '张数', type: 'integer', values: [1, 2, 4], default: 2 },
    ],
  },
  {
    id: 'sketch-fast', kind: 'image', name: '草图快出', description: '不支持参考图', billing_unit: '张',
    params: [{ name: 'n', label: '张数', type: 'integer', values: [1, 2, 3, 4], default: 4 }],
  },
  {
    id: 'video-v1', kind: 'video', name: '视频 V1', description: '5–10 秒短片', billing_unit: '条',
    params: [
      { name: 'aspect_ratio', label: '比例', type: 'enum', values: ['16:9', '9:16', '1:1'], default: '16:9' },
      { name: 'duration', label: '时长', type: 'enum', values: [5, 10], default: 5 },
    ],
  },
]

export const modelsFor = (kind: 'image' | 'video') => MOCK_MODELS.filter(m => m.kind === kind)
export const findModel = (id?: string) => MOCK_MODELS.find(m => m.id === id)
export const defaultParams = (m: ModelSpec) => Object.fromEntries(m.params.filter(p => p.default !== undefined).map(p => [p.name, p.default!]))

const SAMPLE_VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'

const ratioOf = (r: unknown): [number, number] => {
  const m = String(r ?? '1:1').match(/^(\d+):(\d+)$/)
  return m ? [Number(m[1]), Number(m[2])] : [1, 1]
}

export function picsumAsset(seed: string, aspect: unknown = '1:1'): AssetRef {
  const [rw, rh] = ratioOf(aspect)
  const pic = (w: number) => `https://picsum.photos/seed/${seed}/${w}/${Math.round((w * rh) / rw)}`
  return { id: `mock-${seed}`, kind: 'image', width: 1024, height: Math.round((1024 * rh) / rw), urls: { w480: pic(480), w960: pic(960), orig: pic(1024) } }
}

/** 2–5s, progress ticks, 15% failure. */
export function mockGenerate(opts: { kind: 'image' | 'video'; params: Record<string, unknown>; onProgress: (p: number) => void; rng?: () => number }): Promise<AssetRef[]> {
  const rng = opts.rng ?? Math.random
  const total = 2000 + rng() * 3000
  const fail = rng() < 0.15
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const t = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / total)
      opts.onProgress(p)
      if (fail && p > 0.6) { clearInterval(t); reject(new Error('上游服务繁忙，本次未扣点，请重试')); return }
      if (p < 1) return
      clearInterval(t)
      if (opts.kind === 'video') {
        const [rw, rh] = ratioOf(opts.params.aspect_ratio ?? '16:9')
        resolve([{ id: `mock-v-${start}`, kind: 'video', width: rw * 100, height: rh * 100, urls: { orig: SAMPLE_VIDEO } }])
        return
      }
      const n = Number(opts.params.n ?? 1)
      resolve(Array.from({ length: n }, (_, i) => picsumAsset(`${start}-${i}`, opts.params.aspect_ratio)))
    }, 120)
  })
}

// ---------- upload ----------
// ponytail: mock keeps the File in IndexedDB under a `local:` url so it survives reload.
// Real flow = useUpload's createUpload → PUT → completeUpload, then node stores media_assets.id only.

const blobKey = (id: string) => `ipzsk.canvas.blob.${id}`

export async function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith('image/')) return null
  try { const b = await createImageBitmap(file); const r = { width: b.width, height: b.height }; b.close(); return r } catch { return null }
}

export async function mockUpload(file: File, onProgress: (p: number) => void): Promise<AssetRef> {
  const id = crypto.randomUUID()
  const size = await readImageSize(file)
  for (let p = 0.1; p < 1; p += 0.15) { onProgress(p); await new Promise(r => setTimeout(r, 90)) }
  await set(blobKey(id), file)
  onProgress(1)
  const kind = file.type.startsWith('video/') ? 'video' : 'image'
  return { id, kind, width: size?.width ?? null, height: size?.height ?? null, urls: { orig: `local:${id}` } }
}

const resolved = new Map<string, string>()
/**
 * Resolves `local:` urls to blob urls (cached for the page lifetime); otherwise returns the cached `urls` payload.
 * TODO(§7.2): signed URLs expire. When `asset.asset_id` is set, accept an injected resolver
 * (e.g. `(ids) => GET /api/me/media/assets?ids=` from the media module) and refresh on load error / near expiry
 * instead of trusting the cached payload.
 */
export function useAssetUrls(asset?: AssetRef): AssetRef['urls'] | undefined {
  const orig = asset?.urls.orig
  const local = orig?.startsWith('local:') ? orig.slice(6) : null
  const [url, setUrl] = useState(() => (local ? resolved.get(local) : undefined))
  useEffect(() => {
    if (!local || resolved.has(local)) { if (local) setUrl(resolved.get(local)); return }
    let live = true
    void get<Blob>(blobKey(local)).then(b => {
      if (!b || !live) return
      const u = URL.createObjectURL(b)
      resolved.set(local, u)
      setUrl(u)
    }).catch(() => {})
    return () => { live = false }
  }, [local])
  if (!asset) return undefined
  return local ? { orig: url ?? '' } : asset.urls
}

/** Best-effort sync resolution for payloads leaving the canvas (e.g. 加入输入框). */
export const resolveUrl = (u: string) => (u.startsWith('local:') ? resolved.get(u.slice(6)) ?? u : u)
export const seedResolved = (id: string, blobUrl: string) => { resolved.set(id, blobUrl) }
