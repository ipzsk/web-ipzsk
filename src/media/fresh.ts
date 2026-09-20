// §7.2 signed-URL freshness: one resolver for every MediaImage / MediaVideo / MediaLightbox (and canvas nodes).
// Private R2 URLs are valid for the current 6h slice (+ next slice + 30min). When one is within 5 minutes of expiry,
// or fails to load while signed, the owning TanStack query is refetched and the fresh urls are used everywhere that asset id shows.
import { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore } from 'react'
import { queryClient } from '@/shared/query'
import type { MediaAsset } from './types'

type Urls = MediaAsset['urls']
/** Refetch whatever owns `assetId`; may return the fresh urls directly (otherwise they're looked up in the query cache). */
export type RefreshAsset = (assetId: string) => Promise<Urls | null | void> | Urls | null | void

export const EXPIRY_MARGIN_MS = 5 * 60_000
export const REFRESH_COOLDOWN_MS = 60_000

/** Expiry (ms epoch) of a SigV4 presigned URL: `X-Amz-Date` (YYYYMMDDTHHMMSSZ) + `X-Amz-Expires` (s). null = unsigned / unparsable. */
export function urlExpiry(url: string | undefined): number | null {
  const q = url?.indexOf('?') ?? -1
  if (!url || q < 0) return null
  const p = new URLSearchParams(url.slice(q + 1))
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(p.get('X-Amz-Date') ?? '')
  const e = p.get('X-Amz-Expires') ?? ''
  if (!m || !/^\d+$/.test(e)) return null
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!) + Number(e) * 1000
}

/** Earliest expiry among the variants; null when none is signed. */
export function urlsExpiry(urls: Urls): number | null {
  const xs = Object.values(urls).map(u => urlExpiry(u)).filter((x): x is number => x != null)
  return xs.length ? Math.min(...xs) : null
}

/** Mock adapters: sign a URL like the gateway would (issued now, 6h by default) so expiry handling can be exercised. */
export function mockSign(url: string, now = Date.now(), ttlSec = 6 * 3600): string {
  if (!/^https?:/.test(url)) return url
  const u = new URL(url)
  u.searchParams.set('X-Amz-Date', new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''))
  u.searchParams.set('X-Amz-Expires', String(ttlSec))
  u.searchParams.set('X-Amz-Signature', Math.random().toString(16).slice(2)) // differs per issue, like a re-signed URL
  return u.toString()
}
export const mockSignUrls = <T extends Urls>(urls: T, now?: number, ttlSec?: number): T =>
  Object.fromEntries(Object.entries(urls).map(([k, v]) => [k, typeof v === 'string' ? mockSign(v, now, ttlSec) : v])) as T

/* ---------- store: fresh urls by asset id (session lifetime) ---------- */

// ponytail: never evicted; a session sees at most a few thousand assets.
const fresh = new Map<string, Urls>()
const lastRefresh = new Map<string, number>()
const listeners = new Set<() => void>()
let version = 0
const emit = () => { version++; listeners.forEach(l => l()) }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

/** The later-expiring of the asset's own urls and a refreshed copy. Unsigned own urls never expire → kept. */
export function pickUrls(id: string | undefined, own: Urls): Urls {
  const f = id ? fresh.get(id) : undefined
  if (!f) return own
  const a = urlsExpiry(own), b = urlsExpiry(f)
  return a == null || b == null || b < a ? own : f
}

/** Newest urls for `id` anywhere in the TanStack cache (lists, records, subjects, cases …). */
export function findCachedUrls(id: string): Urls | null {
  let best: Urls | null = null
  const walk = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 8) return
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return }
    const o = v as Record<string, unknown>
    const urls = o.urls as Urls | undefined
    if (o.id === id && urls && typeof urls.orig === 'string' && (!best || (urlsExpiry(urls) ?? 0) > (urlsExpiry(best) ?? 0))) best = urls
    for (const k in o) if (k !== 'urls') walk(o[k], depth + 1)
  }
  for (const q of queryClient.getQueryCache().getAll()) walk(q.state.data, 0)
  return best
}

/** Default: refetch every cached query whose data mentions the asset id (assets lists, generation records, subjects, public cases …). */
export async function refetchOwners(id: string): Promise<void> {
  const needle = JSON.stringify(id)
  // ponytail: stringify-scan of the cache, only on expiry / signed load errors (≤1 per asset per minute); keep an id → key index if caches grow huge.
  const owners = queryClient.getQueryCache().getAll().filter(q => q.state.data !== undefined && JSON.stringify(q.state.data).includes(needle))
  await Promise.all(owners.map(q => queryClient.refetchQueries({ queryKey: q.queryKey, exact: true }, { cancelRefetch: false }))) // many assets expiring together share one in-flight refetch
}

/** Throttled (1 per asset per 60s). Resolves true when a refresh actually ran. */
export async function refreshAsset(id: string, refresh: RefreshAsset = refetchOwners): Promise<boolean> {
  const now = Date.now()
  if (now - (lastRefresh.get(id) ?? -Infinity) < REFRESH_COOLDOWN_MS) return false
  lastRefresh.set(id, now)
  try {
    const urls = (await refresh(id)) || findCachedUrls(id)
    if (urls) { fresh.set(id, urls); emit() }
  } catch { /* offline etc.: the image shows its own retry */ }
  return true
}

/** Test hook. */
export const __resetFresh = () => { fresh.clear(); lastRefresh.clear(); emit() }

const RefreshContext = createContext<RefreshAsset | null>(null)
/** Views whose assets don't live in a TanStack query (e.g. canvas nodes) inject how to re-fetch an asset by id. */
export const MediaRefreshProvider = RefreshContext.Provider

export function useRefreshAsset() {
  const ctx = useContext(RefreshContext)
  const ref = useRef(ctx ?? refetchOwners)
  ref.current = ctx ?? refetchOwners
  return useCallback((id: string) => refreshAsset(id, ref.current), [])
}

/** Re-render when any refreshed urls arrive (for components that map many assets, e.g. the lightbox). */
export const useFreshVersion = () => useSyncExternalStore(subscribe, () => version, () => version)

/**
 * Current urls for an asset + `onError(failedUrl)`. Schedules a refresh 5 minutes before the earliest signed variant expires
 * (immediately if already inside that window); a load error of a signed URL refreshes too. Unsigned URLs never trigger anything.
 */
export function useFreshUrls(id: string | undefined, own: Urls) {
  useFreshVersion()
  const refresh = useRefreshAsset()
  const urls = pickUrls(id, own)
  const expiry = urlsExpiry(urls)
  useEffect(() => {
    if (!id || expiry == null) return
    const wait = expiry - EXPIRY_MARGIN_MS - Date.now()
    if (wait <= 0) { void refresh(id); return }
    const t = setTimeout(() => void refresh(id), Math.min(wait, 2 ** 31 - 1))
    return () => clearTimeout(t)
  }, [id, expiry, refresh])
  const onError = useCallback((failed?: string) => {
    if (id && urlExpiry(failed) != null) void refresh(id)
  }, [id, refresh])
  return { urls, onError }
}
