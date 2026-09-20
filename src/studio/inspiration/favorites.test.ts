// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api'
import { qk, queryClient } from '@/shared/query'

vi.mock('@/ui', () => ({ toast: vi.fn() }))
vi.mock('@/shared/api', async (orig) => ({ ...(await orig<typeof import('@/shared/api')>()), request: vi.fn() }))

const { request } = await import('@/shared/api')
const { toast } = await import('@/ui')
const { applyFavorite, favKey, migrateLocalFavorites, toggleFavorite } = await import('./api')

const page = (...ids: string[]) => ({
  pageParams: [null],
  pages: [{ items: ids.map((id) => ({ target_type: 'case' as const, target_id: id, created_at: '' })), next_cursor: null }],
})
const ids = () => queryClient.getQueryData<ReturnType<typeof page>>(favKey)?.pages.flatMap((p) => p.items.map((f) => f.target_id))

beforeEach(() => {
  vi.mocked(request).mockReset().mockResolvedValue(undefined)
  vi.mocked(toast).mockClear()
  queryClient.clear()
  queryClient.setQueryData(qk.me, { id: 'u1' })
  localStorage.clear()
})
afterEach(() => queryClient.clear())

describe('applyFavorite', () => {
  it('adds on top of page 1, removes from every page, and is idempotent', () => {
    expect(applyFavorite(undefined, 'a', true).pages[0]!.items.map((f) => f.target_id)).toEqual(['a'])
    expect(applyFavorite(page('a'), 'b', true).pages[0]!.items.map((f) => f.target_id)).toEqual(['b', 'a'])
    expect(applyFavorite(page('a', 'b'), 'a', true).pages[0]!.items).toHaveLength(2)
    expect(applyFavorite(page('a', 'b'), 'a', false).pages[0]!.items.map((f) => f.target_id)).toEqual(['b'])
    expect(applyFavorite(undefined, 'a', false).pages[0]!.items).toEqual([])
  })
})

describe('toggleFavorite', () => {
  it('PUTs and keeps the optimistic add', async () => {
    await toggleFavorite('a')
    expect(vi.mocked(request).mock.calls[0]).toEqual(['/api/me/favorites/case/a', { method: 'PUT' }])
    expect(ids()).toEqual(['a'])
  })

  it('DELETEs an already favorited case', async () => {
    queryClient.setQueryData(favKey, page('a'))
    await toggleFavorite('a')
    expect(vi.mocked(request).mock.calls[0]![1]).toEqual({ method: 'DELETE' })
    expect(ids()).toEqual([])
  })

  it('rolls back to the snapshot and toasts on failure', async () => {
    queryClient.setQueryData(favKey, page('a'))
    vi.mocked(request).mockRejectedValue(new ApiError('网络', { status: 0, code: 'network_error' }))
    await toggleFavorite('b')
    expect(ids()).toEqual(['a'])
    expect(vi.mocked(toast)).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }))
  })

  it('drops a case that is gone (404 case_not_found)', async () => {
    queryClient.setQueryData(favKey, page('a', 'b'))
    vi.mocked(request).mockRejectedValue(new ApiError('没了', { status: 404, code: 'case_not_found' }))
    await toggleFavorite('a') // unfavoriting a deleted case still removes it locally
    expect(ids()).toEqual(['b'])
  })

  it('signed out → goes to login instead of writing', async () => {
    queryClient.setQueryData(qk.me, null)
    const href = vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, pathname: '/studio', search: '', href: '' } as Location)
    await toggleFavorite('a')
    expect(request).not.toHaveBeenCalled()
    href.mockRestore()
  })
})

describe('migrateLocalFavorites', () => {
  const KEY = 'ipzsk:studio:fav-cases'

  it('PUTs the leftover ids and drops the key', async () => {
    localStorage.setItem(KEY, JSON.stringify(['a', 'b', 7]))
    const put = vi.fn().mockResolvedValue(undefined)
    expect(await migrateLocalFavorites(put)).toBe(true)
    expect(put.mock.calls).toEqual([['a'], ['b']]) // non-strings ignored
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('keeps the key when a PUT fails for a retryable reason', async () => {
    localStorage.setItem(KEY, JSON.stringify(['a']))
    expect(await migrateLocalFavorites(() => Promise.reject(new ApiError('网络', { status: 0, code: 'network_error' })))).toBe(false)
    expect(localStorage.getItem(KEY)).toBe('["a"]')
  })

  it('drops the key on a gone case, an empty list and corrupt JSON', async () => {
    localStorage.setItem(KEY, JSON.stringify(['a']))
    await migrateLocalFavorites(() => Promise.reject(new ApiError('没了', { status: 404, code: 'case_not_found' })))
    expect(localStorage.getItem(KEY)).toBeNull()

    localStorage.setItem(KEY, '[]')
    expect(await migrateLocalFavorites(vi.fn())).toBe(false)
    expect(localStorage.getItem(KEY)).toBeNull()

    localStorage.setItem(KEY, '{oops')
    await migrateLocalFavorites(vi.fn())
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})
