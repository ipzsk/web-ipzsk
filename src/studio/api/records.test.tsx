import type { ReactNode } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recordKeys, recordsApi, useThreadRecords, type GenerationRecord } from './records'

const record = (extra: Partial<GenerationRecord> = {}): GenerationRecord => ({
  id: 'r', kind: 'video', model: 'heygen-avatar', status: 'succeeded', charged_points: '25', results: [],
  thread_id: 'thread', batch_id: null, batch_position: null, parent_record_id: null, anchor_record_id: null,
  prompt: '你好', prompt_doc: null, mentions: [], params: {}, source: 'studio', failure_code: null,
  request_id: 'req', task_id: 'task', idempotency_key: 'q:item', references: [],
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...extra,
})
let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>

beforeEach(() => {
  vi.useFakeTimers()
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
})
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('generation result polling', () => {
  it.each(['image', 'video'] as const)('waits for the %s file after settlement, then stops once it appears', async kind => {
    const missing = record({ kind })
    const ready = record({ kind, results: [{ id: 'asset', kind, source: 'generation', status: 'ready', width: 10, height: 10, duration_ms: null, thumb_state: 'done', created_at: '', urls: { orig: 'https://example.com/result' } }] })
    const list = vi.spyOn(recordsApi, 'list').mockResolvedValueOnce({ items: [missing], next_cursor: null }).mockResolvedValue({ items: [ready], next_cursor: null })
    const { result } = renderHook(() => useThreadRecords('thread'), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(result.current.data?.pages[0]?.items[0]?.results).toEqual([])
    await act(async () => { await vi.advanceTimersByTimeAsync(10_100) })
    expect(result.current.data?.pages[0]?.items[0]?.results[0]?.id).toBe('asset')
    const calls = list.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(list).toHaveBeenCalledTimes(calls)
  })

  it('continues polling when the unarchived record is on a loaded older page', async () => {
    client.setQueryData(recordKeys.thread('thread'), { pages: [{ items: [], next_cursor: 'older' }, { items: [record()], next_cursor: null }], pageParams: [null, 'older'] })
    client.setQueryDefaults(recordKeys.thread('thread'), { staleTime: Infinity })
    const list = vi.spyOn(recordsApi, 'list').mockResolvedValue({ items: [], next_cursor: null })
    renderHook(() => useThreadRecords('thread'), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10_100) })
    expect(list).toHaveBeenCalled()
  })

  it('does not endlessly poll failed, deleted-result or old unavailable records', async () => {
    const items = [record({ status: 'failed' }), record({ results: [{ id: 'deleted', status: 'deleted', missing: true }] }), record({ updated_at: new Date(Date.now() - 3 * 60 * 60_000).toISOString() })]
    const list = vi.spyOn(recordsApi, 'list').mockResolvedValue({ items, next_cursor: null })
    renderHook(() => useThreadRecords('thread'), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(list).toHaveBeenCalledTimes(1)
  })
})
