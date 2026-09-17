import { request } from '@/shared/api'
import type { MediaAsset } from '@/media'
import { isMock, mockDelay } from './catalog'

export type SubjectKind = 'person' | 'character' | 'product' | 'object' | 'scene'
export const SUBJECT_KIND_LABEL: Record<SubjectKind, string> = { person: '人物', character: '角色', product: '商品', object: '物体', scene: '场景' }

/** §2.9 / §8.7 subjects + subject_assets (ordered, 1–8). */
export interface Subject { id: string; name: string; kind: SubjectKind; cover: MediaAsset | null; assets: MediaAsset[] }

const pic = (seed: string, w = 600, h = 600): MediaAsset => ({
  id: `mock-${seed}`, kind: 'image', status: 'ready', width: w, height: h, duration_ms: null,
  urls: { w480: `https://picsum.photos/seed/${seed}/480/${Math.round((480 * h) / w)}`, w960: `https://picsum.photos/seed/${seed}/960/${Math.round((960 * h) / w)}`, orig: `https://picsum.photos/seed/${seed}/${w}/${h}` },
})

const mk = (id: string, name: string, kind: SubjectKind, seeds: string[]): Subject =>
  ({ id, name, kind, cover: pic(seeds[0]!), assets: seeds.map(s => pic(s)) })

export const MOCK_SUBJECTS: Subject[] = [
  mk('sub-orange', '橘猫阿福', 'character', ['cat1', 'cat2', 'cat3']),
  mk('sub-lin', '林小满', 'person', ['lin1', 'lin2', 'lin3', 'lin4']),
  mk('sub-bottle', '青柠气泡水', 'product', ['bottle1', 'bottle2', 'cat2']), // cat2 shared on purpose: dedupe demo
  mk('sub-studio', '白色摄影棚', 'scene', ['studio1']),
]

export async function listSubjects(): Promise<Subject[]> {
  if (isMock) { await mockDelay(300); return MOCK_SUBJECTS }
  const data = await request<{ items: Subject[] }>('/api/me/subjects')
  return data.items
}
