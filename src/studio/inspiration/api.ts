import { useSyncExternalStore } from 'react'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { isMock, request } from '@/shared/api'
import type { CaseCategories, InspirationCaseDetail, Page } from '@/shared/contracts'
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

/* ---------- favorites ---------- */
// TODO(B?): `/api/me/favorites` — then use a mutation with onMutate snapshot / onError rollback + toast (§6).
// localStorage writes are synchronous and can't fail meaningfully, so today the toggle is simply immediate.

const FAV_KEY = 'ipzsk:studio:fav-cases'
const favListeners = new Set<() => void>()
let favCache: Set<string> | null = null

function readFavs(): Set<string> {
  if (favCache) return favCache
  try { favCache = new Set(JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]') as string[]) } catch { favCache = new Set() }
  return favCache
}

export function toggleFavorite(id: string) {
  const next = new Set(readFavs())
  if (next.has(id)) next.delete(id)
  else next.add(id)
  favCache = next
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...next])) } catch { /* private mode: keep in memory */ }
  favListeners.forEach((l) => l())
}

const subscribeFavs = (cb: () => void) => { favListeners.add(cb); return () => { favListeners.delete(cb) } }
export const useFavorites = () => useSyncExternalStore(subscribeFavs, readFavs, readFavs)
