import { request } from '@/shared/api'
import type { MediaAsset, UploadApi } from '@/media'
import { isMock, mockDelay } from '../api/catalog'

/** §10.1 presigned direct upload. Mock: PUT goes to the dev server (answers 200), asset is a picsum placeholder. */
export const uploadApi: UploadApi = isMock ? {
  async createUpload() {
    await mockDelay(150)
    const asset_id = crypto.randomUUID()
    // ponytail: mock asset shows a placeholder, not the uploaded bytes; real R2 flow replaces this.
    return { asset_id, put_url: '/studio.html' }
  },
  async completeUpload(id) {
    await mockDelay(300)
    const u = (w: number) => `https://picsum.photos/seed/${id.slice(0, 8)}/${w}/${w}`
    return { id, kind: 'image', status: 'ready', width: 960, height: 960, duration_ms: null, urls: { w480: u(480), w960: u(960), orig: u(960) } } satisfies MediaAsset
  },
} : {
  createUpload: (req, signal) => request('/api/me/uploads', { body: req, signal }),
  completeUpload: (id, signal) => request(`/api/me/uploads/${id}/complete`, { method: 'POST', body: {}, signal }),
}
