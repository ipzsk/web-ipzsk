import { useQuery } from '@tanstack/react-query'
import { request } from '@/shared/api'
import type { MediaAsset } from '@/media'
import { isMock, mockDelay } from '../api/catalog'
import { mockPic } from '../api/subjects'

/** Minimal read-only `GET /api/me/assets?kind=image` for the subject editor's picker (first page only). */
// ponytail: first page only, no infinite scroll; switch to the assets view's paged query once it is shared.
async function listMyImages(): Promise<MediaAsset[]> {
  if (isMock) {
    await mockDelay(350)
    return ['bag1', 'bag2', 'shoe1', 'shoe2', 'girl1', 'girl2', 'dog1', 'dog2', 'lamp1', 'lamp2', 'room1', 'room2'].map((s, i) => mockPic(s, 600, i % 3 ? 600 : 800))
  }
  return (await request<{ items: MediaAsset[] }>('/api/me/assets?kind=image')).items.filter(a => a.status === 'ready')
}

export const useMyImages = (enabled: boolean) => useQuery({ queryKey: ['subject-picker', 'assets'], queryFn: listMyImages, enabled, staleTime: 60_000 })
