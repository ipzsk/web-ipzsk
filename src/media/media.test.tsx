// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, waitFor } from '@testing-library/react'
import { Virtualizer } from '@tanstack/virtual-core'
import { useSelection } from './useSelection'
import { useUpload, validateFile, type UploadApi } from './useUpload'
import { DropTarget, MediaDndProvider, checkAccept } from './dnd'
import { nearestIndex } from './MasonryGrid'
import type { MediaAsset } from './types'

afterEach(cleanup)

const asset = (id: string, kind: 'image' | 'video' = 'image'): MediaAsset =>
  ({ id, kind, status: 'ready', width: 100, height: 100, duration_ms: null, urls: { orig: `https://x/${id}` } })

/* ---------- masonry placement: the same code path MasonryGrid uses (virtual-core lanes, exact sizes) ---------- */
function place(heights: number[], lanes: number, gap = 16) {
  const v = new Virtualizer<Window, Element>({
    count: heights.length, estimateSize: (i) => heights[i]!, lanes, gap,
    getScrollElement: () => null, scrollToFn: () => {}, observeElementRect: () => {}, observeElementOffset: () => {},
  })
  return (v as unknown as { getMeasurements: () => { lane: number; start: number; end: number; index: number }[] }).getMeasurements()
}

describe('masonry placement', () => {
  const heights = Array.from({ length: 300 }, (_, i) => [320, 240, 360, 135, 427, 300][(i * 7 + 3) % 6]!)

  it('is deterministic and always picks the shortest column (ties → column whose last card came first)', () => {
    const a = place(heights, 5)
    const b = place(heights, 5)
    expect(a.map((m) => [m.lane, m.start])).toEqual(b.map((m) => [m.lane, m.start]))
    const ends = new Array(5).fill(0) as number[]
    const last = new Array(5).fill(0) as number[]
    a.forEach((m, i) => {
      let expected = i % 5
      if (i >= 5) expected = [0, 1, 2, 3, 4].reduce((b, l) => (ends[l]! < ends[b]! || (ends[l] === ends[b] && last[l]! < last[b]!) ? l : b), 0)
      expect(m.lane).toBe(expected)
      ends[m.lane] = m.end
      last[m.lane] = i
    })
  })

  it('arrow-key neighbour lookup', () => {
    const m = place(heights, 3)
    const i = 10
    const down = nearestIndex(m, i, 'down', m.length)!
    expect(m[down]!.lane).toBe(m[i]!.lane)
    expect(m[down]!.start).toBeGreaterThan(m[i]!.start)
    expect(m[nearestIndex(m, i, 'right', m.length) ?? i]!.lane).toBe(Math.min(2, m[i]!.lane + 1))
  })
})

/* ---------- selection ---------- */
describe('useSelection', () => {
  it('shift adds range from anchor, cmd toggles', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const { result } = renderHook(() => useSelection(ids))
    act(() => result.current.select('b'))
    act(() => result.current.select('d', { shiftKey: true }))
    expect([...result.current.selected].sort()).toEqual(['b', 'c', 'd'])
    act(() => result.current.select('c', { metaKey: true }))
    expect([...result.current.selected].sort()).toEqual(['b', 'd'])
    // anchor moved to c → shift to a selects a..c
    act(() => result.current.select('a', { shiftKey: true }))
    expect([...result.current.selected].sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})

/* ---------- upload ---------- */
class FakeXHR {
  static last: FakeXHR | null = null
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {}
  onload?: () => void; onerror?: () => void; onabort?: () => void
  status = 0; aborted = false
  constructor() { FakeXHR.last = this }
  open() {} setRequestHeader() {} send() {}
  abort() { this.aborted = true; this.onabort?.() }
  progress(p: number) { this.upload.onprogress?.({ lengthComputable: true, loaded: p, total: 1 }) }
  finish(status = 200) { this.status = status; this.onload?.() }
}

function setup() {
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
  URL.createObjectURL = vi.fn(() => 'blob:local')
  URL.revokeObjectURL = vi.fn()
  // Image preload resolves immediately
  vi.stubGlobal('Image', class { onload?: () => void; set src(_: string) { queueMicrotask(() => this.onload?.()) } })
  const api: UploadApi = {
    createUpload: vi.fn(async () => ({ asset_id: 'srv1', put_url: 'https://r2/put', headers: {} })),
    completeUpload: vi.fn(async (id: string) => ({ ...asset(id), urls: { orig: 'https://r2/o', w480: 'https://r2/480' } })),
  }
  const file = new File(['x'], 'a.png', { type: 'image/png' })
  return { api, file }
}

describe('useUpload', () => {
  it('validates type and size in Chinese', () => {
    expect(validateFile({ type: 'image/gif', size: 1 })).toMatch('仅支持')
    expect(validateFile({ type: 'image/png', size: 21 * 1024 * 1024 })).toBe('图片不能超过 20MB')
    expect(validateFile({ type: 'video/mp4', size: 201 * 1024 * 1024 })).toBe('视频不能超过 200MB')
    expect(validateFile({ type: 'video/mp4', size: 1 })).toBeNull()
  })

  it('happy path: local preview → progress → complete → swap + revoke', async () => {
    const { api, file } = setup()
    const { result } = renderHook(() => useUpload({ api }))
    act(() => { result.current.add([file]) })
    expect(result.current.items[0]).toMatchObject({ status: 'uploading', previewUrl: 'blob:local' })
    await waitFor(() => expect(FakeXHR.last).not.toBeNull())
    act(() => FakeXHR.last!.progress(0.5))
    expect(result.current.items[0]!.progress).toBe(0.5)
    await act(async () => FakeXHR.last!.finish())
    await waitFor(() => expect(result.current.items[0]!.status).toBe('done'))
    expect(result.current.items[0]!.asset?.id).toBe('srv1')
    expect(result.current.items[0]!.previewUrl).toBeUndefined()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local')
    expect(api.completeUpload).toHaveBeenCalledWith('srv1', expect.anything())
  })

  it('failure keeps the file and retry re-runs', async () => {
    const { api, file } = setup()
    const { result } = renderHook(() => useUpload({ api }))
    FakeXHR.last = null
    act(() => { result.current.add([file]) })
    await waitFor(() => expect(FakeXHR.last).not.toBeNull())
    await act(async () => FakeXHR.last!.finish(403))
    await waitFor(() => expect(result.current.items[0]!.status).toBe('failed'))
    expect(result.current.items[0]!.error).toMatch('403')
    expect(result.current.items[0]!.file).toBe(file)
    const first = FakeXHR.last
    act(() => result.current.retry(result.current.items[0]!.clientId))
    await waitFor(() => expect(FakeXHR.last).not.toBe(first))
    expect(result.current.items[0]!.status).toBe('uploading')
  })

  it('cancel aborts the XHR and removes the item', async () => {
    const { api, file } = setup()
    const { result } = renderHook(() => useUpload({ api }))
    FakeXHR.last = null
    act(() => { result.current.add([file]) })
    await waitFor(() => expect(FakeXHR.last).not.toBeNull())
    const xhr = FakeXHR.last!
    act(() => result.current.cancel(result.current.items[0]!.clientId))
    expect(xhr.aborted).toBe(true)
    expect(result.current.items).toHaveLength(0)
    expect(api.completeUpload).not.toHaveBeenCalled()
  })
})

/* ---------- DropTarget ---------- */
describe('DropTarget', () => {
  const imagesOnly = (xs: MediaAsset[]) => (xs.every((x) => x.kind === 'image') ? true : '只接受图片')

  it('accept returns true or the reason', () => {
    expect(checkAccept(imagesOnly, [asset('a')])).toBe(true)
    expect(checkAccept(imagesOnly, [asset('a'), asset('v', 'video')])).toBe('只接受图片')
    expect(checkAccept(undefined, [])).toBe('没有可放置的内容')
  })

  it('routes native OS file drops to onFiles', () => {
    const onFiles = vi.fn()
    const { getByText } = render(<MediaDndProvider><DropTarget id="t" onFiles={onFiles}>目标</DropTarget></MediaDndProvider>)
    const file = new File(['x'], 'b.png', { type: 'image/png' })
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: '' }
    fireEvent.dragEnter(getByText('目标'), { dataTransfer })
    expect(getByText('目标').getAttribute('data-drop-state')).toBe('valid')
    fireEvent.drop(getByText('目标'), { dataTransfer })
    expect(onFiles).toHaveBeenCalledWith([file])
  })
})
