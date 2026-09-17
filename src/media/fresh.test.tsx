// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { queryClient } from '@/shared/query'
import { MediaImage } from './MediaImage'
import { MediaRefreshProvider, __resetFresh, mockSign, urlExpiry, urlsExpiry } from './fresh'

const T0 = Date.UTC(2026, 8, 17, 6, 0, 0)
const signed = (issuedAt: number, ttlSec: number) => mockSign('https://r2.example/u/a1/w480.webp', issuedAt, ttlSec)

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); __resetFresh() })
afterEach(() => { cleanup(); vi.useRealTimers(); queryClient.clear() })

describe('urlExpiry', () => {
  it('parses X-Amz-Date + X-Amz-Expires; unsigned → null', () => {
    expect(urlExpiry('https://x/a.webp?X-Amz-Date=20260917T060000Z&X-Amz-Expires=3600')).toBe(T0 + 3600_000)
    expect(urlExpiry('https://x/a.webp')).toBeNull()
    expect(urlExpiry('https://x/a.webp?X-Amz-Date=bad&X-Amz-Expires=1')).toBeNull()
    expect(urlsExpiry({ orig: signed(T0, 7200), w480: signed(T0, 600) })).toBe(T0 + 600_000)
  })
})

describe('MediaImage signed-URL refresh', () => {
  const view = (url: string, refresh: (id: string) => unknown) => render(
    <MediaRefreshProvider value={refresh as never}>
      <MediaImage asset={{ id: 'a1', kind: 'image', status: 'ready', width: 10, height: 10, duration_ms: null, urls: { orig: url } }} alt="x" />
    </MediaRefreshProvider>,
  )

  it('refreshes immediately when already within 5 minutes of expiry, and swaps in the fresh url', async () => {
    const fresh = signed(T0, 6 * 3600)
    const refresh = vi.fn(async () => ({ orig: fresh }))
    const { container } = view(signed(T0 - 3600_000, 3600 + 4 * 60), refresh) // expires in 4 min
    await act(async () => { await Promise.resolve() })
    expect(refresh).toHaveBeenCalledWith('a1')
    expect(container.querySelector('img')!.getAttribute('src')).toBe(fresh)
  })

  it('schedules the refresh 5 minutes before expiry', async () => {
    const refresh = vi.fn(async () => null)
    view(signed(T0, 20 * 60), refresh) // expires in 20 min → refresh at 15 min
    await act(async () => { vi.advanceTimersByTime(14 * 60_000) })
    expect(refresh).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(60_000) })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('a load error refreshes at most once per asset per 60s; unsigned urls never refresh', async () => {
    const refresh = vi.fn(async () => null)
    const { container, unmount } = view(signed(T0, 6 * 3600), refresh)
    fireEvent.error(container.querySelector('img')!)
    await act(async () => { vi.advanceTimersByTime(500) })
    fireEvent.error(container.querySelector('img')!)
    await act(async () => { vi.advanceTimersByTime(5_000) })
    expect(refresh).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(60_000) })
    fireEvent.error(container.querySelector('img')!)
    expect(refresh).toHaveBeenCalledTimes(2)
    unmount()

    __resetFresh()
    const r2 = vi.fn()
    const u = view('https://picsum.photos/seed/x/10/10', r2)
    fireEvent.error(u.container.querySelector('img')!)
    expect(r2).not.toHaveBeenCalled()
  })
})
