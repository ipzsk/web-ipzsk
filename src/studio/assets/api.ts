import { CANVAS_ADD_EVENT, COMPOSER_FILL_EVENT, dispatchStudioEvent } from '@/shared/events'
import { ApiError, request } from '@/shared/api'
import type { CreateUploadReq, CreateUploadRes, MediaAsset, UploadApi } from '@/media'
import { createMockApi } from './mock'
import { isMock } from '../api/catalog'

/*
 * §2.6 素材 adapters. Contracts: §10.1 + gateway B1 (uploads/assets) and B3 (folders/favorites, in progress).
 * Assumptions for B3 until the gateway lands (adjust here only, the view doesn't care):
 *   GET  /api/me/folders                → { items: Folder[] }  (count = live assets in the folder)
 *   POST /api/me/folders {name}         → Folder
 *   PATCH /api/me/folders/:id {name?, position?} → Folder
 *   PUT  /api/me/folders/:id/items {asset_ids} → adds (idempotent); assets may live in several folders (PK folder_id+asset_id)
 *   GET  /api/me/assets?folder=:id      → folder contents
 *   GET  /api/me/favorites?type=asset   → { items: { target_id }[] }
 */

export type AssetSource = 'upload' | 'generation' | 'poster'
export type ThumbState = 'none' | 'queued' | 'running' | 'done' | 'skipped' | 'failed'
export type Asset = MediaAsset & { source: AssetSource; created_at: string; thumb_state: ThumbState }
export type Folder = { id: string; name: string; position: number; count: number }
export type AssetQuery = { kind?: 'image' | 'video'; source?: AssetSource; folder?: string }
export type Page<T> = { items: T[]; next_cursor: string | null }

export interface AssetsApi extends UploadApi {
  listAssets: (q: AssetQuery, cursor: string | null) => Promise<Page<Asset>>
  deleteAsset: (id: string) => Promise<void>
  listFolders: () => Promise<Folder[]>
  createFolder: (name: string) => Promise<Folder>
  updateFolder: (id: string, patch: { name?: string; position?: number }) => Promise<Folder>
  deleteFolder: (id: string) => Promise<void>
  addToFolder: (id: string, assetIds: string[]) => Promise<void>
  listFavoriteAssets: () => Promise<string[]>
  setFavorite: (assetId: string, on: boolean) => Promise<void>
}

const qs = (o: Record<string, string | null | undefined>) =>
  new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => !!e[1])).toString()

const realApi: AssetsApi = {
  listAssets: (q, cursor) => request(`/api/me/assets?${qs({ cursor, kind: q.kind, source: q.source, folder: q.folder })}`),
  deleteAsset: async (id) => { await request(`/api/me/assets/${id}`, { method: 'DELETE' }) },
  listFolders: async () => (await request<{ items: Folder[] }>('/api/me/folders')).items,
  createFolder: (name) => request('/api/me/folders', { body: { name } }),
  updateFolder: (id, patch) => request(`/api/me/folders/${id}`, { method: 'PATCH', body: patch }),
  deleteFolder: async (id) => { await request(`/api/me/folders/${id}`, { method: 'DELETE' }) },
  addToFolder: async (id, asset_ids) => { await request(`/api/me/folders/${id}/items`, { method: 'PUT', body: { asset_ids } }) },
  listFavoriteAssets: async () => (await request<{ items: { target_id: string }[] }>('/api/me/favorites?type=asset')).items.map((x) => x.target_id),
  setFavorite: async (id, on) => { await request(`/api/me/favorites/asset/${id}`, { method: on ? 'PUT' : 'DELETE' }) },
  createUpload: (req: CreateUploadReq, signal) => request<CreateUploadRes>('/api/me/uploads', { body: req, signal }),
  completeUpload: (id, signal) => request<MediaAsset>(`/api/me/uploads/${id}/complete`, { method: 'POST', body: {}, signal }),
}

export const api: AssetsApi = isMock ? createMockApi() : realApi

/* ---------- upload: Chinese errors + one retry on 409 upload_not_found (R2 eventual consistency) ---------- */

const UPLOAD_ERRORS: Record<string, string> = {
  file_too_large: '文件太大：图片不能超过 20MB，视频不能超过 200MB',
  storage_quota_exceeded: '存储空间已满（每人 2GB / 2000 个），请先删除不用的素材',
  rate_limited: '上传太频繁（每分钟最多 20 个），请稍后重试',
  upload_size_mismatch: '文件大小与声明不一致，请重新上传',
  upload_type_mismatch: '文件实际格式不受支持，仅支持 PNG、JPEG、WebP、MP4',
  upload_not_found: '文件还没有传完整，请重试',
  asset_not_found: '上传记录已失效，请重新上传',
}

export function uploadErrorMessage(e: unknown): string {
  if (e instanceof ApiError) return UPLOAD_ERRORS[e.code] ?? e.message
  return e instanceof Error && e.message ? e.message : '上传失败，请重试'
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')) }, { once: true })
})

async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn() } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e
    throw new Error(uploadErrorMessage(e))
  }
}

export function makeUploadApi(a: UploadApi, retryDelay = 1000): UploadApi {
  return {
    createUpload: (req, signal) => mapped(() => a.createUpload(req, signal)),
    completeUpload: (id, signal) => mapped(async () => {
      try { return await a.completeUpload(id, signal) } catch (e) {
        if (!(e instanceof ApiError && e.code === 'upload_not_found')) throw e
        await sleep(retryDelay, signal)
        return a.completeUpload(id, signal)
      }
    }),
  }
}

export const uploadApi = makeUploadApi(api)

/* ---------- cross-view events (shapes: src/shared/events.ts) ---------- */

export const fillComposerWithAssets = (assets: MediaAsset[]) => dispatchStudioEvent(COMPOSER_FILL_EVENT, { source: 'asset', reference_assets: assets })
export const addAssetsToCanvas = (assets: MediaAsset[]) => dispatchStudioEvent(CANVAS_ADD_EVENT, { source: 'asset', assets })
