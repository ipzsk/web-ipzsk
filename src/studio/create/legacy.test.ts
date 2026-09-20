import { describe, expect, it } from 'vitest'
import { loadLegacy, mayBeExpired, toLegacyItems } from './legacy'

const png = 'data:image/png;base64,AAAA'
const history = [
  { id: 'h1', prompt: '橘猫', model: 'gpt-image-2', size: '1:1', quality: '2k', createdAt: 2000, images: [{ url: png, mime: 'image/png' }, { url: png }] },
  { id: 'h-empty', prompt: '没图', createdAt: 5000, images: [] },
  'garbage',
]
const gallery = [{ id: 'h1', prompt: '重复', createdAt: 9999, images: [{ url: png }] }, { id: 'g1', prompt: '作品集', createdAt: 1000, images: [{ url: 'javascript:alert(1)' }, { url: png }] }]
const video = { id: '0b4c7c1e-9d1f-4e0c-8a51-1c1b2f7d3a10', prompt: '海浪', model: 'veo', modelName: 'Veo 3', resolution: '720p', duration: 5, status: 'completed', createdAt: 3000, url: 'https://cdn.example/v.mp4?sig=1' }

describe('F8 legacy history', () => {
  it('maps old image history / gallery / video tasks, drops media-less & unsafe urls, dedupes, newest first', () => {
    const items = toLegacyItems({ history, gallery, videoTasks: [video, { id: 'failed', status: 'failed', createdAt: 9 }], videoLatest: undefined })
    expect(items.map(i => i.id)).toEqual([`video:${video.id}`, 'image:h1', 'image:g1'])
    expect(items[0]).toMatchObject({ kind: 'video', model: 'Veo 3', meta: ['720p', '5秒'], urls: [video.url], source: 'video' })
    expect(items[1]).toMatchObject({ prompt: '橘猫', meta: ['1:1', '2K'], source: 'history' })
    expect(items[1]!.urls).toHaveLength(2)
    expect(items[2]!.urls).toEqual([png])
    expect(mayBeExpired(items[0]!)).toBe(true)
    expect(mayBeExpired(items[1]!)).toBe(false)
  })

  it('falls back to the single latest video task when the list key is absent', () => {
    expect(toLegacyItems({ history: undefined, gallery: undefined, videoTasks: undefined, videoLatest: video })).toHaveLength(1)
  })

  it('reads per-user keys only, never writes', async () => {
    const reads: unknown[] = []
    const store: Record<string, unknown> = { 'user,u1,history': history, 'user,other,history': [{ id: 'x', images: [{ url: png }] }] }
    const ls: Record<string, string> = { 'ipzsk.video.tasks.v1.u1': JSON.stringify([video]), 'ipzsk.video.tasks.v1.other': JSON.stringify([{ ...video, id: 'o' }]) }
    const items = await loadLegacy('u1', { read: async k => { reads.push(k); return store[String(k)] }, getItem: k => ls[k] ?? null })
    expect(reads).toEqual([['user', 'u1', 'history'], ['user', 'u1', 'gallery']])
    expect(items.map(i => i.id)).toEqual([`video:${video.id}`, 'image:h1'])
    expect(await loadLegacy('nobody', { read: async () => undefined, getItem: () => '{bad json' })).toEqual([])
  })
})
