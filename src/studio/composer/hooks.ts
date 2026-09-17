import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/shared/api'
import { useCurrentUser, useWallet } from '@/shared/query'
import { toast } from '@/ui'
import { fetchModels, isMock, quote, type QuoteEntry } from '../api/catalog'
import { listSubjects } from '../api/subjects'
import { QUEUE_MAX, conflictQueue, getQueue, localQueue, putQueue, reviveQueue, type QueueEntry } from '../api/queue'
import { useComposer } from '../store'

export const useModels = () => useQuery({ queryKey: ['media', 'models'], queryFn: fetchModels, staleTime: 10 * 60_000 })
export const useSubjects = (enabled: boolean) => useQuery({ queryKey: ['subjects'], queryFn: listSubjects, enabled, staleTime: 60_000 })

/** Mock mode pretends to be signed in with 1000 points (override: localStorage['ipzsk.mock.points']). */
export function useAccount() {
  const me = useCurrentUser()
  const signedIn = isMock || !!me.data
  const wallet = useWallet(!isMock && signedIn)
  const mockPoints = Number(localStorage.getItem('ipzsk.mock.points') ?? 1000)
  return {
    pending: !isMock && me.isPending,
    signedIn,
    points: isMock ? mockPoints : wallet.data ? Number(wallet.data.available_points) : null,
  }
}

export function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

/** Array quote (composer + queue in one call), 300ms debounce; TanStack hashes the key with sorted object keys, so equal bodies share a cache entry for 10 min (§2.2). */
export const quoteQueryKey = (entries: QuoteEntry[]) => ['media', 'quote', entries] as const
export function useQuote(entries: QuoteEntry[], enabled: boolean) {
  const debounced = useDebounced(entries, 300)
  return useQuery({
    queryKey: quoteQueryKey(debounced),
    queryFn: ({ signal }) => quote(debounced, signal),
    enabled: enabled && debounced.length > 0,
    staleTime: 10 * 60_000,
    placeholderData: prev => prev,
  })
}

/**
 * §2.3 persistence: server queue per user, PUT 1s after the last change with revision; 409 → replace with server copy + toast.
 * Signed out → localStorage; on sign-in the local items are appended to the server queue (truncated to 12).
 */
export function useQueueSync(signedIn: boolean, pending: boolean) {
  useEffect(() => {
    if (pending) return
    let revision = 0
    let synced = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    let alive = true
    const set = (items: QueueEntry[]) => { synced = JSON.stringify(items); useComposer.setState({ queue: items }) }

    if (!signedIn) {
      set(reviveQueue(localQueue.read()))
      const unsub = useComposer.subscribe(s => localQueue.write(s.queue))
      return unsub
    }

    const push = async () => {
      const items = useComposer.getState().queue
      const json = JSON.stringify(items)
      if (json === synced) return
      try {
        revision = (await putQueue(items, revision)).revision
        synced = json
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 409)) return // offline etc.: next change retries
        // §2.3: server wins, whole-queue replace. The 409 body carries the server copy; older gateways without it → GET.
        const server = conflictQueue(e) ?? await getQueue().catch(() => null)
        if (!alive || !server) return
        revision = server.revision
        set(server.items)
        toast({ title: '队列已在其他设备更新', description: '已替换为最新的队列。' })
      }
    }

    void getQueue().then(server => {
      if (!alive) return
      revision = server.revision
      const local = localQueue.read()
      const merged = [...server.items, ...local]
      if (merged.length > QUEUE_MAX) toast({ title: `队列最多 ${QUEUE_MAX} 项`, description: `超出的 ${merged.length - QUEUE_MAX} 项已丢弃。` })
      set(server.items)
      if (local.length) { localQueue.clear(); useComposer.setState({ queue: reviveQueue(merged.slice(0, QUEUE_MAX)) }) }
    }).catch(() => { /* endpoint missing / offline: queue stays local to this tab */ })

    const unsub = useComposer.subscribe((s, prev) => {
      if (s.queue === prev.queue) return
      clearTimeout(timer)
      timer = setTimeout(() => void push(), 1000)
    })
    return () => { alive = false; clearTimeout(timer); unsub() }
  }, [signedIn, pending])
}
