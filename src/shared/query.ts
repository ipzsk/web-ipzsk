import { useEffect, useState, useSyncExternalStore } from 'react'
import { QueryClient, useQuery } from '@tanstack/react-query'
import { ApiError, UNAUTHORIZED_EVENT, currentUser, isMock, request, type User, type Wallet } from './api'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // 4xx are answers, not flakes.
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
})

export const qk = { me: ['me'] as const, wallet: ['wallet'] as const }

/** Mock mode is signed in (matches the composer's useAccount), so the header and the studio agree. */
const MOCK_USER: User = { id: 'mock-user', email: 'mock@ipzsk.com', name: '体验用户' }
const mockPoints = () => { try { return Number(localStorage.getItem('ipzsk.mock.points') ?? 1000) } catch { return 1000 } }
export const useCurrentUser = () => useQuery({ queryKey: qk.me, queryFn: isMock ? async () => MOCK_USER : currentUser })

export const useWallet = (enabled = true) => useQuery({
  queryKey: qk.wallet,
  enabled,
  queryFn: async (): Promise<Wallet | null> => {
    if (isMock) return { available_points: mockPoints().toFixed(8), frozen_points: '0.00000000' }
    try { return await request<Wallet>('/api/me/wallet') }
    catch (e) { if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null; throw e }
  },
})

/**
 * Any 401 anywhere → mark signed out locally (setQueryData, not invalidate, so it can't loop).
 * Returns true once a request of a previously signed-in session got 401, so the layout can show one 「重新登录」 banner for every view.
 */
export function useUnauthorizedBroadcast() {
  const [expired, setExpired] = useState(false)
  useEffect(() => {
    const onUnauthorized = () => {
      if (queryClient.getQueryData(qk.me)) setExpired(true) // anonymous visitors on public views are not "expired"
      queryClient.setQueryData(qk.me, null); queryClient.setQueryData(qk.wallet, null)
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])
  return expired
}

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb); window.addEventListener('offline', cb)
  return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb) }
}
export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)
