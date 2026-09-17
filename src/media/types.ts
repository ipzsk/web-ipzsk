export type MediaAsset = {
  id: string
  kind: 'image' | 'video'
  status: 'pending' | 'ready' | 'failed' | 'deleted'
  width: number | null
  height: number | null
  duration_ms: number | null
  urls: { w480?: string; w960?: string; orig: string; poster?: string }
}

export type MediaSize = 'thumb' | 'detail' | 'orig'

export function pickUrl(urls: MediaAsset['urls'], size: MediaSize): string {
  if (size === 'thumb') return urls.w480 ?? urls.w960 ?? urls.orig
  if (size === 'detail') return urls.w960 ?? urls.orig
  return urls.orig
}

/** height / width, or null when unknown. */
export function aspectOf(a: { width: number | null; height: number | null }): number | null {
  return a.width && a.height ? a.height / a.width : null
}

export const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
