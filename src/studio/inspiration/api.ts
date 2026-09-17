import { useSyncExternalStore } from 'react'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { categoryCounts, pageCases, similarCases, type CaseFilter, type CaseItem } from './lib'

/*
 * Case library adapter. Reads the static manifest today.
 * TODO(B4): switch to `GET /api/public/cases?cat=&q=&cursor=` (§8.7) via `request()` from '@/shared/api' —
 * keep the return shapes below ({ items, next_cursor, total }) so the view doesn't change.
 * Map `cover` (MediaAsset, signed w480/w960/orig) → `image` then.
 */

let manifest: Promise<CaseItem[]> | undefined
// Separate chunk (~1.3MB, mostly prompts) so the studio shell doesn't wait on it.
const loadManifest = () =>
  (manifest ??= import('./data/cases.manifest.json').then((m) => m.default as CaseItem[]).catch((e) => { manifest = undefined; throw e }))

export async function listCases({ cat, q, cursor }: CaseFilter & { cursor?: string | null }) {
  return pageCases(await loadManifest(), { cat, q }, cursor ?? null)
}

export async function getCase(id: string): Promise<CaseItem | null> {
  return (await loadManifest()).find((c) => c.id === id) ?? null
}

/** TODO(B4): server-side; no endpoint in §8.7 yet. */
export async function listCategories(q: string) {
  return categoryCounts(await loadManifest(), q)
}

export async function listSimilar(id: string) {
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
  queryKey: caseKeys.categories(q),
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
