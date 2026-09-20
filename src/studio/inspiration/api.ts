import { useEffect } from 'react'
import { keepPreviousData, useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query'
import { ApiError, isMock, loginUrl, request } from '@/shared/api'
import { qk, queryClient, useCurrentUser } from '@/shared/query'
import { toast } from '@/ui'
import type { CaseCategories, Favorite, InspirationCaseDetail, Page } from '@/shared/contracts'
import { categoryCounts, fromManifest, pageCases, similarCases, type CaseFilter, type CaseItem, type ManifestCase } from './lib'

/*
 * Case library adapter. Both sources return the generated shapes (InspirationCase / Page), so the view doesn't care.
 * Default → gateway `/api/public/cases*` (real originals, signed URLs, multi-category `cat=a,b`).
 * Explicit fallback: VITE_CASES_SOURCE=static, and `?mock=1` (mock mode never hits the network) → static manifest via fromManifest.
 */
export const casesFromApi = import.meta.env.VITE_CASES_SOURCE !== 'static' && !isMock

let manifest: Promise<CaseItem[]> | undefined
// Separate chunk (~1.3MB, mostly prompts) so the studio shell doesn't wait on it.
const loadManifest = () =>
  (manifest ??= import('./data/cases.manifest.json').then((m) => (m.default as ManifestCase[]).map(fromManifest)).catch((e) => { manifest = undefined; throw e }))

const qs = (o: Record<string, string | null | undefined>) => new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => !!e[1])).toString()

/** `cat` may list several categories (`a,b`). `total` only from the manifest (the public API pages without a count). */
export async function listCases({ cat, q, cursor }: CaseFilter & { cursor?: string | null }): Promise<Page<CaseItem> & { total?: number }> {
  if (casesFromApi) return request<Page<CaseItem>>(`/api/public/cases?${qs({ cat, q, cursor })}`)
  return pageCases(await loadManifest(), { cat, q }, cursor ?? null)
}

const detail = (id: string) => request<InspirationCaseDetail>(`/api/public/cases/${encodeURIComponent(id)}`)

export async function getCase(id: string): Promise<CaseItem | null> {
  if (casesFromApi) return detail(id).catch(() => null)
  return (await loadManifest()).find((c) => c.id === id) ?? null
}

/** API mode: counts ignore the search term (the endpoint has no `q`). */
export async function listCategories(q: string) {
  if (casesFromApi) {
    const { items } = await request<CaseCategories>('/api/public/case-categories')
    return { total: items.reduce((n, c) => n + c.count, 0), categories: items.map((c) => ({ id: c.category, label: c.category_zh ?? c.category, count: c.count })) }
  }
  return categoryCounts(await loadManifest(), q)
}

export async function listSimilar(id: string): Promise<CaseItem[]> {
  if (casesFromApi) return (await detail(id)).similar
  const all = await loadManifest()
  const c = all.find((x) => x.id === id)
  return c ? similarCases(all, c) : []
}

export const caseKeys = {
  list: (f: CaseFilter) => ['cases', 'list', f] as const,
  one: (id: string) => ['cases', 'one', id] as const,
  categories: (q: string) => ['cases', 'categories', q] as const,
  similar: (id: string) => ['cases', 'similar', id] as const,
}

export const useCases = (f: CaseFilter) => useInfiniteQuery({
  queryKey: caseKeys.list(f),
  queryFn: ({ pageParam }) => listCases({ ...f, cursor: pageParam }),
  initialPageParam: null as string | null,
  getNextPageParam: (last) => last.next_cursor,
  staleTime: 5 * 60_000,
})

export const useCase = (id: string | null) => useQuery({
  queryKey: caseKeys.one(id ?? ''),
  queryFn: () => getCase(id!),
  enabled: !!id,
  staleTime: 5 * 60_000,
})

export const useCategories = (q: string) => useQuery({
  queryKey: caseKeys.categories(casesFromApi ? '' : q), // API counts ignore q: one cache entry
  queryFn: () => listCategories(q),
  placeholderData: keepPreviousData,
  staleTime: 5 * 60_000,
})

export const useSimilar = (id: string | null) => useQuery({
  queryKey: caseKeys.similar(id ?? ''),
  queryFn: () => listSimilar(id!),
  enabled: !!id,
  staleTime: 5 * 60_000,
})

/* ---------- favorites (account-backed, §6 optimistic) ---------- */

export const favKey = ['favorites', 'case'] as const
type FavData = InfiniteData<Page<Favorite>, string | null>

/** Mock mode keeps favorites in memory (never hits the network). */
const mockFavs = new Set<string>()

const listFavorites = (cursor: string | null): Promise<Page<Favorite>> =>
  isMock
    ? Promise.resolve({ items: [...mockFavs].reverse().map((id) => ({ target_type: 'case' as const, target_id: id, created_at: '' })), next_cursor: null })
    : request(`/api/me/favorites?${qs({ type: 'case', cursor })}`)

const setFavorite = async (id: string, on: boolean) => {
  if (isMock) { if (on) mockFavs.add(id); else mockFavs.delete(id); return }
  await request(`/api/me/favorites/case/${encodeURIComponent(id)}`, { method: on ? 'PUT' : 'DELETE' })
}

const has = (d: FavData | undefined, id: string) => !!d?.pages.some((p) => p.items.some((f) => f.target_id === id))

/** Pure optimistic write on the cached pages: a new favorite goes on top of page 1 (the API sorts newest first). */
export function applyFavorite(data: FavData | undefined, id: string, on: boolean): FavData {
  const pages = data?.pages.length ? data.pages : [{ items: [], next_cursor: null }]
  const pageParams = data?.pages.length ? data.pageParams : [null]
  if (!on) return { pageParams, pages: pages.map((p) => ({ ...p, items: p.items.filter((f) => f.target_id !== id) })) }
  if (has({ pages, pageParams } as FavData, id)) return { pages, pageParams }
  const [first, ...rest] = pages as [Page<Favorite>, ...Page<Favorite>[]]
  return { pageParams, pages: [{ ...first, items: [{ target_type: 'case', target_id: id, created_at: new Date().toISOString() }, ...first.items] }, ...rest] }
}

const NO_FAVS: ReadonlySet<string> = new Set()

/** The account's case favorites, all pages flattened. Signed out → empty set, no request. */
export function useFavorites(): ReadonlySet<string> {
  const { data: me } = useCurrentUser()
  const signedIn = isMock || !!me
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: favKey,
    queryFn: ({ pageParam }) => listFavorites(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: signedIn,
    staleTime: 60_000,
    select: (d: FavData) => new Set(d.pages.flatMap((p) => p.items.map((f) => f.target_id))),
  })
  // 50 per page, and the 素材 → 收藏的案例 tab needs the whole set, so keep pulling.
  useEffect(() => { if (hasNextPage && !isFetchingNextPage) void fetchNextPage() }, [hasNextPage, isFetchingNextPage, fetchNextPage])
  useEffect(() => { if (signedIn) void runMigration() }, [signedIn])
  return data ?? NO_FAVS
}

/** Signed out → straight to login (same as the composer's 「登录后生成」), coming back to this case. */
export async function toggleFavorite(id: string) {
  if (!isMock && !queryClient.getQueryData(qk.me)) { location.href = loginUrl(); return }
  const snapshot = queryClient.getQueryData<FavData>(favKey)
  const on = !has(snapshot, id)
  await queryClient.cancelQueries({ queryKey: favKey })
  queryClient.setQueryData<FavData>(favKey, (d) => applyFavorite(d, id, on))
  try {
    await setFavorite(id, on)
  } catch (e) {
    const code = e instanceof ApiError ? e.code : ''
    if (code === 'case_not_found') {
      queryClient.setQueryData<FavData>(favKey, (d) => applyFavorite(d, id, false)) // gone for good: drop it locally
      toast({ title: '案例已下架', description: '已从你的收藏中移除', tone: 'error' })
    } else if (code === 'customer_login_required') {
      location.href = loginUrl()
    } else {
      queryClient.setQueryData<FavData>(favKey, (d) => snapshot ?? applyFavorite(d, id, !on))
      toast({ title: on ? '收藏失败' : '取消收藏失败', description: e instanceof Error && e.message ? e.message : '请检查网络后重试', tone: 'error' })
    }
  } finally {
    void queryClient.invalidateQueries({ queryKey: favKey })
  }
}

/* ---------- one-time migration of the pre-account localStorage favorites ---------- */

const LEGACY_FAV_KEY = 'ipzsk:studio:fav-cases'
const dropLegacy = () => { try { localStorage.removeItem(LEGACY_FAV_KEY) } catch { /* private mode */ } }

/** PUTs whatever is left in the old key (PUT is idempotent), then drops it. Returns true if anything was added. */
export async function migrateLocalFavorites(put: (id: string) => Promise<unknown> = (id) => setFavorite(id, true)) {
  let ids: string[] = []
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(LEGACY_FAV_KEY) ?? '[]')
    ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch { dropLegacy(); return false } // unreadable or corrupt: nothing to migrate
  if (!ids.length) { dropLegacy(); return false }
  const results = await Promise.allSettled(ids.map((id) => put(id)))
  // A case that is gone (404) is done with; anything else (offline, 5xx) keeps the key for the next sign-in.
  if (!results.some((r) => r.status === 'rejected' && !(r.reason instanceof ApiError && r.reason.status === 404))) dropLegacy()
  return results.some((r) => r.status === 'fulfilled')
}

let migrated = false
const runMigration = async () => {
  if (migrated || isMock) return
  migrated = true
  if (await migrateLocalFavorites()) void queryClient.invalidateQueries({ queryKey: favKey })
}
