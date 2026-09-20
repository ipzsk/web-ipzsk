import type { LooseMediaAsset } from '@/shared/contracts'

/** Generated `MediaAsset`; `source` / `thumb_state` / `created_at` optional so locally built assets fit. w480/w960/poster may be absent. */
export type MediaAsset = LooseMediaAsset

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
