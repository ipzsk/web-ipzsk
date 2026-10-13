import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { request } from '@/shared/api'
import { hasPendingPayment, orderStatus, type PaymentOrder } from '@/shared/billing'
import { usePaymentOrders, WALLET_KEY } from './RechargeDialog'

vi.mock('@/shared/api', async importOriginal => ({ ...await importOriginal<typeof import('@/shared/api')>(), request: vi.fn() }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

const NOW = Date.parse('2026-10-13T10:00:00Z')
const order = (patch: Partial<PaymentOrder>): PaymentOrder => ({ id: 'o1', amount_cny: '10.00000000', state: 'checkout_ready', created_at: new Date(NOW - 60_000).toISOString(), ...patch })

describe('payment order status', () => {
  it('an abandoned checkout stops polling once the Waffo session has expired', () => {
    const stale = order({ created_at: new Date(NOW - 2 * 3600_000).toISOString() })
    expect(orderStatus(stale, NOW)).toEqual({ label: '未完成支付（收银台已关闭；如已付款请联系客服）', pending: false })
    expect(hasPendingPayment([stale], NOW)).toBe(false)
    expect(hasPendingPayment([order({})], NOW)).toBe(true)
    // Paid but not yet credited keeps polling regardless of age.
    expect(hasPendingPayment([order({ state: 'paid', created_at: new Date(NOW - 2 * 3600_000).toISOString() })], NOW)).toBe(true)
  })

  it('shows confirmed refunds instead of 「充值已到账」', () => {
    expect(orderStatus(order({ state: 'credited', refunded_cny: '0.00000000' }), NOW).label).toBe('充值已到账')
    expect(orderStatus(order({ state: 'credited', refunded_cny: '4.00000000' }), NOW).label).toBe('已部分退款 ¥4.00')
    expect(orderStatus(order({ state: 'credited', refunded_cny: '10.00000000' }), NOW).label).toBe('已全额退款')
    expect(orderStatus(order({ state: 'unknown_state' }), NOW).label).toBe('状态待确认')
  })
})

describe('usePaymentOrders', () => {
  it('refreshes every wallet cache when a pending order is credited', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const now = new Date().toISOString()
    vi.mocked(request)
      .mockResolvedValueOnce({ rows: [order({ state: 'paid', created_at: now })] })
      .mockResolvedValueOnce({ rows: [order({ state: 'credited', created_at: now })] })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result } = renderHook(() => usePaymentOrders(true), { wrapper })
    await waitFor(() => expect(result.current.data?.rows[0]?.state).toBe('paid'))
    expect(invalidate).not.toHaveBeenCalled()
    await act(async () => { await result.current.refetch() })
    await waitFor(() => expect(result.current.data?.rows[0]?.state).toBe('credited'))
    const keys = invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey))
    expect(keys).toContain(JSON.stringify(['wallet']))
    expect(keys).toContain(JSON.stringify(WALLET_KEY))
  })
})
