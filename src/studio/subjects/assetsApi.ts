import { useQuery } from '@tanstack/react-query'
import type { MediaAsset } from '@/media'
import { api } from '../assets/api'

/** Subject editor 「从素材选择」: first page of the user's ready images — same adapter (and mock store) as the assets view. */
// ponytail: first page only, no infinite scroll; switch to the assets view's paged query if people have >50 images.
async function listMyImages(): Promise<MediaAsset[]> {
  return (await api.listAssets({ kind: 'image' }, null)).items.filter(a => a.status === 'ready')
}

export const useMyImages = (enabled: boolean) => useQuery({ queryKey: ['subject-picker', 'assets'], queryFn: listMyImages, enabled, staleTime: 0 })
