// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/api'
import { createMockApi } from './mock'
import { makeUploadApi, uploadErrorMessage, type Folder } from './api'
import { addToFolderOptions, assetKeys, createDeleter, positionAt } from './queries'
import { BatchBar } from './AssetsView'

afterEach(() => { cleanup(); vi.useRealTimers() })

const memoryMock = (extra: Parameters<typeof createMockApi>[0] = {}) =>
  createMockApi({ load: async () => undefined, save: async () => {}, latency: () => 0, failRate: 0, random: () => 0.5, ...extra })

describe('mock adapter', () => {
  it('paginates with next_cursor and filters by kind / source / folder', async () => {
    const api = memoryMock({ pageSize: 20 })
    const p1 = await api.listAssets({}, null)
    expect(p1.items).toHaveLength(20)
    const p2 = await api.listAssets({}, p1.next_cursor)
    const p4 = await api.listAssets({}, '60')
    expect(p2.items[0]!.id).not.toBe(p1.items[0]!.id)
    expect(p4.items).toHaveLength(4)
    expect(p4.next_cursor).toBeNull()

    const videos = await api.listAssets({ kind: 'video' }, null)
    expect(videos.items.length).toBeGreaterThan(0)
    expect(videos.items.every((a) => a.kind === 'video')).toBe(true)
    const uploads = await api.listAssets({ source: 'upload' }, null)
    expect(uploads.items.every((a) => a.source === 'upload')).toBe(true)

    const [folder] = await api.listFolders()
    const inFolder = await api.listAssets({ folder: folder!.id }, null)
    expect(inFolder.items).toHaveLength(folder!.count)
  })

  it('deleted assets leave lists and folder counts; addToFolder updates counts', async () => {
    const api = memoryMock()
    const [f] = await api.listFolders()
    const { items } = await api.listAssets({ folder: f!.id }, null)
    await api.deleteAsset(items[0]!.id)
    expect((await api.listFolders())[0]!.count).toBe(f!.count - 1)
    const outside = (await api.listAssets({}, null)).items.slice(40, 42).map((a) => a.id)
    await api.addToFolder(f!.id, outside)
    expect((await api.listFolders())[0]!.count).toBe(f!.count + 1)
  })

  it('upload: first complete may 409, wrapper retries once and succeeds', async () => {
    const raw = memoryMock({ random: () => 0.1 }) // < 0.35 → 409 on first complete
    const up = makeUploadApi(raw, 0)
    const signal = new AbortController().signal
    const { asset_id, headers } = await up.createUpload({ kind: 'image', content_type: 'image/png', bytes: 10 }, signal)
    expect(headers).toMatchObject({ 'Content-Type': 'image/png', 'Cache-Control': expect.any(String) })
    const asset = await up.completeUpload(asset_id, signal)
    expect(asset.id).toBe(asset_id)
  })
})

describe('upload errors → Chinese', () => {
  const err = (status: number, code: string) => new ApiError('x', { status, code })
  it('maps gateway codes', () => {
    expect(uploadErrorMessage(err(413, 'file_too_large'))).toContain('20MB')
    expect(uploadErrorMessage(err(403, 'storage_quota_exceeded'))).toContain('存储空间已满')
    expect(uploadErrorMessage(err(429, 'rate_limited'))).toContain('太频繁')
    expect(uploadErrorMessage(err(422, 'upload_type_mismatch'))).toContain('格式')
    expect(uploadErrorMessage(err(422, 'upload_size_mismatch'))).toContain('大小')
  })
  it('wrapper throws the Chinese message; 409 retried only once', async () => {
    const complete = vi.fn().mockRejectedValue(err(409, 'upload_not_found'))
    const up = makeUploadApi({ createUpload: vi.fn().mockRejectedValue(err(413, 'file_too_large')), completeUpload: complete }, 0)
    const signal = new AbortController().signal
    await expect(up.createUpload({ kind: 'image', content_type: 'image/png', bytes: 1 }, signal)).rejects.toThrow('图片不能超过 20MB')
    await expect(up.completeUpload('a', signal)).rejects.toThrow('文件还没有传完整')
    expect(complete).toHaveBeenCalledTimes(2)
  })
})

describe('optimistic delete + undo', () => {
  it('hides now, sends after 5s, undo before that cancels', async () => {
    vi.useFakeTimers()
    const remove = vi.fn().mockResolvedValue(undefined)
    const onCommitted = vi.fn()
    const d = createDeleter({ remove, onCommitted, onFailed: vi.fn() })

    const undo = d.del(['a', 'b'])
    expect([...d.getHidden()]).toEqual(['a', 'b'])
    await vi.advanceTimersByTimeAsync(4999)
    expect(undo()).toBe(true)
    expect(d.getHidden().size).toBe(0)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(remove).not.toHaveBeenCalled()

    const late = d.del(['c'])
    await vi.advanceTimersByTimeAsync(5000)
    expect(remove).toHaveBeenCalledWith('c')
    expect(onCommitted).toHaveBeenCalledWith(['c'])
    expect(late()).toBe(false)
    expect(d.getHidden().size).toBe(0)
  })

  it('failed DELETEs come back and report', async () => {
    vi.useFakeTimers()
    const onFailed = vi.fn()
    const d = createDeleter({ remove: (id) => (id === 'x' ? Promise.reject(new Error('boom')) : Promise.resolve()), onCommitted: vi.fn(), onFailed })
    d.del(['x', 'y'])
    await vi.advanceTimersByTimeAsync(5000)
    expect(onFailed).toHaveBeenCalledWith(['x'], expect.any(Error))
    expect(d.getHidden().has('x')).toBe(false)
  })
})

describe('folders', () => {
  const folders: Folder[] = [{ id: 'f1', name: 'A', position: 1, count: 3 }, { id: 'f2', name: 'B', position: 2, count: 0 }]

  it('move to folder is optimistic and rolls back on failure', async () => {
    const qc = new QueryClient()
    qc.setQueryData(assetKeys.folders, folders)
    let reject!: (e: Error) => void
    const addToFolder = vi.fn(() => new Promise<void>((_, r) => { reject = r }))
    const obs = new MutationObserver(qc, addToFolderOptions(qc, { addToFolder }))
    const run = obs.mutate({ folder: folders[0]!, ids: ['a', 'b'] }).catch(() => {})
    await vi.waitFor(() => expect(qc.getQueryData<Folder[]>(assetKeys.folders)![0]!.count).toBe(5))
    reject(new Error('网络错误'))
    await run
    expect(qc.getQueryData<Folder[]>(assetKeys.folders)![0]!.count).toBe(3)
  })

  it('reorder position is a midpoint', () => {
    const three = [...folders, { id: 'f3', name: 'C', position: 3, count: 0 }]
    expect(positionAt(three, 2, 0)).toBe(0)
    expect(positionAt(three, 0, 1)).toBe(2.5)
    expect(positionAt(three, 0, 2)).toBe(4)
  })
})

describe('BatchBar', () => {
  const noop = () => {}
  const props = { folders: [], onMove: noop, onDownload: noop, onFill: noop, onCanvas: noop, onDelete: noop, onClear: noop }
  it('only shows with a selection', () => {
    const { rerender } = render(<BatchBar count={0} {...props} />)
    expect(screen.queryByRole('toolbar')).toBeNull()
    rerender(<BatchBar count={2} {...props} />)
    expect(screen.getByRole('toolbar', { name: '批量操作' }).textContent).toContain('已选 2 项')
  })
})

