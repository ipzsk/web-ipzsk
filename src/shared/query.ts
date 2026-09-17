import { useEffect, useSyncExternalStore } from 'react'
import { QueryClient, useQuery } from '@tanstack/react-query'
import { ApiError, UNAUTHORIZED_EVENT, currentUser, request, type Wallet } from './api'

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

export const useCurrentUser = () => useQuery({ queryKey: qk.me, queryFn: currentUser })

export const useWallet = (enabled = true) => useQuery({
  queryKey: qk.wallet,
  enabled,
  queryFn: async () => {
    try { return await request<Wallet>('/api/me/wallet') }
    catch (e) { if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null; throw e }
  },
})

/** Any 401 anywhere → mark signed out locally. setQueryData (not invalidate) so it can't loop. */
export function useUnauthorizedBroadcast() {
  useEffect(() => {
    const onUnauthorized = () => { queryClient.setQueryData(qk.me, null); queryClient.setQueryData(qk.wallet, null) }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])
}

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb); window.addEventListener('offline', cb)
  return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb) }
}
export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)
