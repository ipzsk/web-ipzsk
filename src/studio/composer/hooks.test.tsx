import type { ReactNode } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import * as catalog from '../api/catalog'
import { useQuote } from './hooks'
import { quoteSummary } from './logic'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

it('invalidates a displayed quote immediately when inputs change, including during debounce', async () => {
  vi.useFakeTimers()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  const fetch = vi.spyOn(catalog, 'quote').mockResolvedValue([{ points: 25 }])
  const entry = (duration: number): catalog.QuoteEntry => ({ model: 'heygen-avatar', kind: 'video', params: { duration }, reference_asset_ids: [] })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const { result, rerender, unmount } = renderHook(({ entries }) => useQuote(entries, true), { wrapper, initialProps: { entries: [entry(5)] } })
  await act(async () => { await vi.advanceTimersByTimeAsync(100) })
  expect(result.current.isCurrent).toBe(true)
  rerender({ entries: [entry(10)] })
  expect(result.current.isCurrent).toBe(false)
  expect(fetch).toHaveBeenCalledTimes(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(400) })
  await act(async () => { await vi.advanceTimersByTimeAsync(10) })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(result.current.isCurrent).toBe(true)
  unmount(); client.clear()
})

it('requires every item to have a valid price, while preserving a genuine zero quote', () => {
  for (const points of [null, undefined, NaN, Infinity, -1]) {
    expect(quoteSummary([{ points: 25 }, points === undefined ? undefined : { points }], false, false).total).toBeNull()
  }
  expect(quoteSummary([{ points: 0, error: { code: 'unavailable', message: 'unavailable' } }], false, false).total).toBeNull()
  expect(quoteSummary([{ points: 25 }], true, false).total).toBeNull()
  expect(quoteSummary([{ points: 25 }], false, true).total).toBeNull()
  expect(quoteSummary([{ points: 0 }, { points: 25 }], false, false)).toEqual({ total: 25, reason: null })
})
