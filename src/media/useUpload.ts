import { useCallback, useEffect, useRef, useState } from 'react'
import { get, set } from 'idb-keyval'
import type { MediaAsset } from './types'

export type CreateUploadReq = { kind: 'image' | 'video'; content_type: string; bytes: number }
export type CreateUploadRes = { asset_id: string; put_url: string; headers?: Record<string, string> }
export type UploadApi = {
  createUpload: (req: CreateUploadReq, signal: AbortSignal) => Promise<CreateUploadRes>
  completeUpload: (assetId: string, signal: AbortSignal) => Promise<MediaAsset>
}

export type UploadStatus = 'uploading' | 'processing' | 'done' | 'failed' | 'interrupted'
export type UploadItem = {
  clientId: string
  name: string
  kind: 'image' | 'video'
  bytes: number
  status: UploadStatus
  /** 0..1 of the PUT */
  progress: number
  file?: File
  /** blob: URL while local; revoked once the server asset has been preloaded */
  previewUrl?: string
  asset?: MediaAsset
  error?: string
}

const TYPES: Record<string, 'image' | 'video'> = { 'image/png': 'image', 'image/jpeg': 'image', 'image/webp': 'image', 'video/mp4': 'video' }
const MB = 1024 * 1024

export function validateFile(file: { type: string; size: number }): string | null {
  const kind = TYPES[file.type]
  if (!kind) return '仅支持 PNG、JPEG、WebP 图片和 MP4 视频'
  if (kind === 'image' && file.size > 20 * MB) return '图片不能超过 20MB'
  if (kind === 'video' && file.size > 200 * MB) return '视频不能超过 200MB'
  return null
}

/** PUT with progress; rejects with AbortError on abort. */
export function putFile(url: string, file: Blob, headers: Record<string, string>, onProgress: (p: number) => void, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total) }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`上传失败（HTTP ${xhr.status}）`)))
    xhr.onerror = () => reject(new Error('网络错误，上传失败'))
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'))
    signal.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(file)
  })
}

const preload = (url?: string) => new Promise<void>((resolve) => {
  if (!url) return resolve()
  const img = new Image()
  img.onload = img.onerror = () => resolve()
  img.src = url
})

const STORE_KEY = 'ipzsk:media-uploads'
type Persisted = Pick<UploadItem, 'clientId' | 'name' | 'kind' | 'bytes'>
const safe = async <T,>(fn: () => Promise<T>) => { try { return await fn() } catch { return undefined } }

export function useUpload({ api, storageKey = STORE_KEY }: { api: UploadApi; storageKey?: string }) {
  const [items, setItems] = useState<UploadItem[]>([])
  const controllers = useRef(new Map<string, AbortController>())
  const apiRef = useRef(api)
  apiRef.current = api

  const patch = useCallback((clientId: string, p: Partial<UploadItem>) =>
    setItems((xs) => xs.map((x) => (x.clientId === clientId ? { ...x, ...p } : x))), [])

  // Restore uploads that never finished (page refreshed mid-upload). Files are gone; user must re-pick.
  useEffect(() => {
    void safe(() => get<Persisted[]>(storageKey)).then((saved) => {
      if (!saved?.length) return
      setItems((xs) => [
        ...saved.filter((s) => !xs.some((x) => x.clientId === s.clientId))
          .map((s): UploadItem => ({ ...s, status: 'interrupted', progress: 0, error: '上传中断 · 重新选择文件' })),
        ...xs,
      ])
    })
  }, [storageKey])

  // Persist unfinished metadata; skip writes when nothing relevant changed (progress ticks).
  const lastSaved = useRef('[]')
  useEffect(() => {
    const meta: Persisted[] = items.filter((x) => x.status !== 'done')
      .map(({ clientId, name, kind, bytes }) => ({ clientId, name, kind, bytes }))
    const json = JSON.stringify(meta)
    if (json === lastSaved.current) return
    lastSaved.current = json
    void safe(() => set(storageKey, meta))
  }, [items, storageKey])

  const run = useCallback(async (item: UploadItem) => {
    const { clientId, file } = item
    if (!file) return
    const ctrl = new AbortController()
    controllers.current.set(clientId, ctrl)
    const { signal } = ctrl
    try {
      const { asset_id, put_url, headers } = await apiRef.current.createUpload({ kind: item.kind, content_type: file.type, bytes: file.size }, signal)
      signal.throwIfAborted()
      await putFile(put_url, file, headers ?? {}, (p) => patch(clientId, { progress: p }), signal)
      patch(clientId, { status: 'processing', progress: 1 })
      const asset = await apiRef.current.completeUpload(asset_id, signal)
      signal.throwIfAborted()
      // Swap only once the server copy is in the browser cache, so the card never flashes empty.
      await preload(asset.kind === 'video' ? asset.urls.poster : asset.urls.w480 ?? asset.urls.orig)
      signal.throwIfAborted()
      setItems((xs) => xs.map((x) => {
        if (x.clientId !== clientId) return x
        if (x.previewUrl) URL.revokeObjectURL(x.previewUrl)
        return { ...x, status: 'done', asset, file: undefined, previewUrl: undefined, error: undefined }
      }))
    } catch (e) {
      if (signal.aborted) return
      patch(clientId, { status: 'failed', error: e instanceof Error ? e.message : '上传失败' })
    } finally {
      if (controllers.current.get(clientId) === ctrl) controllers.current.delete(clientId)
    }
  }, [patch])

  /** Returns per-file validation errors (already in Chinese). Valid files start uploading immediately. */
  const add = useCallback((files: File[]): string[] => {
    const errors: string[] = []
    const fresh: UploadItem[] = []
    for (const file of files) {
      const err = validateFile(file)
      if (err) { errors.push(`${file.name}：${err}`); continue }
      fresh.push({
        clientId: crypto.randomUUID(), name: file.name, kind: TYPES[file.type]!, bytes: file.size,
        status: 'uploading', progress: 0, file, previewUrl: URL.createObjectURL(file),
      })
    }
    if (fresh.length) {
      setItems((xs) => [...fresh, ...xs])
      fresh.forEach((it) => void run(it))
    }
    return errors
  }, [run])

  const remove = useCallback((clientId: string) => {
    controllers.current.get(clientId)?.abort()
    setItems((xs) => xs.filter((x) => {
      if (x.clientId !== clientId) return true
      if (x.previewUrl) URL.revokeObjectURL(x.previewUrl)
      return false
    }))
  }, [])

  const itemsRef = useRef(items)
  itemsRef.current = items
  const retry = useCallback((clientId: string) => {
    const x = itemsRef.current.find((i) => i.clientId === clientId)
    if (!x?.file || x.status !== 'failed') return
    const next: UploadItem = { ...x, status: 'uploading', progress: 0, error: undefined }
    patch(clientId, next)
    void run(next)
  }, [patch, run])

  useEffect(() => () => controllers.current.forEach((c) => c.abort()), [])

  return { items, add, cancel: remove, remove, retry }
}

export type UploadController = ReturnType<typeof useUpload>
