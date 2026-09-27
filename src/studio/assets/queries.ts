import { useSyncExternalStore } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { toast } from '@/ui'
import { api, type Asset, type AssetQuery, type AssetsApi, type Folder, type Page } from './api'

export type Tab = 'all' | 'upload' | 'generation' | 'cases' | 'subjects' | 'templates'
export type ListFilter = { tab: Tab; kind: '' | 'image' | 'video'; folder: string | null }

export const assetKeys = {
  lists: ['assets', 'list'] as const,
  list: (f: ListFilter) => ['assets', 'list', f] as const,
  folders: ['assets', 'folders'] as const,
  favs: ['assets', 'favs'] as const,
}

export const toQuery = (f: ListFilter): AssetQuery => ({
  kind: f.kind || undefined,
  source: f.tab === 'upload' || f.tab === 'generation' ? f.tab : undefined,
  folder: f.folder ?? undefined,
})

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : '请检查网络后重试')

type Lists = InfiniteData<Page<Asset>, string | null>

/**
 * 我的上传 / 生成结果 and the 图片/视频 filter are subsets of 全部. When a fully loaded (no next_cursor) list
 * covering `f` is cached, `f` is cut from it on the client instead of asking the server again.
 */
export function coveredList(qc: QueryClient, f: ListFilter): { data: Lists; updatedAt: number } | undefined {
  for (const q of qc.getQueryCache().findAll({ queryKey: assetKeys.lists })) {
    const g = q.queryKey[2] as ListFilter
    const data = q.state.data as Lists | undefined
    if (!data || data.pages.at(-1)?.next_cursor || g.folder !== f.folder) continue
    if ((g.tab !== 'all' && g.tab !== f.tab) || (g.kind && g.kind !== f.kind) || (g.tab === f.tab && g.kind === f.kind)) continue
    const items = data.pages.flatMap((p) => p.items).filter((a) => (f.tab === 'all' || a.source === f.tab) && (!f.kind || a.kind === f.kind))
    return { data: { pages: [{ items, next_cursor: null }], pageParams: [null] }, updatedAt: q.state.dataUpdatedAt }
  }
}

export function useAssets(f: ListFilter, enabled: boolean) {
  const qc = useQueryClient()
  return useInfiniteQuery({
    queryKey: assetKeys.list(f),
    queryFn: ({ pageParam }) => api.listAssets(toQuery(f), pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    // Seeded as fresh as its source, so switching tabs reuses it until that goes stale.
    initialData: () => coveredList(qc, f)?.data,
    initialDataUpdatedAt: () => coveredList(qc, f)?.updatedAt,
    enabled,
    // Writes keep the lists current (prependAsset / removeFromLists; the composer invalidates after generating),
    // so tab switches within 5 minutes don't refetch. §7.3 said 30s; signed URLs outlive this.
    staleTime: 5 * 60_000,
  })
}

export const useFolders = () => useQuery({ queryKey: assetKeys.folders, queryFn: () => api.listFolders() })
export const useFavoriteAssets = () => useQuery({ queryKey: assetKeys.favs, queryFn: () => api.listFavoriteAssets() })

/** A freshly uploaded asset goes to the top of every loaded list it belongs to. */
export function prependAsset(qc: QueryClient, asset: Asset, folder: string | null = null) {
  for (const [key, data] of qc.getQueriesData<Lists>({ queryKey: assetKeys.lists })) {
    const f = key[2] as ListFilter
    if (!data?.pages[0] || (f.folder && f.folder !== folder)) continue
    if ((f.tab !== 'all' && f.tab !== 'upload') || (f.kind && f.kind !== asset.kind)) continue
    if (data.pages.some((p) => p.items.some((a) => a.id === asset.id))) continue
    qc.setQueryData<Lists>(key, { ...data, pages: [{ ...data.pages[0], items: [asset, ...data.pages[0].items] }, ...data.pages.slice(1)] })
  }
}

const removeFromLists = (qc: QueryClient, ids: Set<string>) =>
  qc.setQueriesData<Lists>({ queryKey: assetKeys.lists }, (d) => d && { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.filter((a) => !ids.has(a.id)) })) })

/* ---------- folders (§6: snapshot → write → rollback + toast → refetch) ---------- */

type Snap = { prev?: Folder[] }

async function snapshot(qc: QueryClient, write: (fs: Folder[]) => Folder[]): Promise<Snap> {
  await qc.cancelQueries({ queryKey: assetKeys.folders })
  const prev = qc.getQueryData<Folder[]>(assetKeys.folders)
  if (prev) qc.setQueryData(assetKeys.folders, write(prev))
  return { prev }
}
const rollback = (qc: QueryClient, title: string) => (e: unknown, _v: unknown, ctx: Snap | undefined) => {
  if (ctx?.prev) qc.setQueryData(assetKeys.folders, ctx.prev)
  toast({ title, description: errText(e), tone: 'error' })
}

export const addToFolderOptions = (qc: QueryClient, a: Pick<AssetsApi, 'addToFolder'> = api) => ({
  mutationFn: ({ folder, ids }: { folder: Folder; ids: string[] }) => a.addToFolder(folder.id, ids),
  // ponytail: count += n may briefly overcount assets already in the folder; the refetch in onSettled corrects it.
  onMutate: ({ folder, ids }: { folder: Folder; ids: string[] }) =>
    snapshot(qc, (fs) => fs.map((f) => (f.id === folder.id ? { ...f, count: f.count + ids.length } : f))),
  onSuccess: (_: void, { folder, ids }: { folder: Folder; ids: string[] }) => toast({ title: `已加入「${folder.name}」`, description: `${ids.length} 项素材`, tone: 'success' as const }),
  onError: rollback(qc, '加入文件夹失败，已撤回'),
  onSettled: (_d: unknown, _e: unknown, { folder }: { folder: Folder; ids: string[] }) => {
    void qc.invalidateQueries({ queryKey: assetKeys.folders })
    void qc.invalidateQueries({ queryKey: assetKeys.lists, predicate: (q) => (q.queryKey[2] as ListFilter | undefined)?.folder === folder.id })
  },
})

export function useFolderMutations() {
  const qc = useQueryClient()
  const settle = () => void qc.invalidateQueries({ queryKey: assetKeys.folders })

  const create = useMutation({
    mutationFn: (name: string) => api.createFolder(name),
    onMutate: (name) => snapshot(qc, (fs) => [...fs, { id: `temp-${name}`, name, position: Math.max(0, ...fs.map((f) => f.position)) + 1, count: 0, created_at: new Date().toISOString() }]),
    onError: rollback(qc, '新建文件夹失败'),
    onSettled: settle,
  })
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.updateFolder(id, { name }),
    onMutate: ({ id, name }) => snapshot(qc, (fs) => fs.map((f) => (f.id === id ? { ...f, name } : f))),
    onError: rollback(qc, '重命名失败，已恢复原名'),
    onSettled: settle,
  })
  const move = useMutation({
    mutationFn: ({ id, position }: { id: string; position: number }) => api.updateFolder(id, { position }),
    onMutate: ({ id, position }) => snapshot(qc, (fs) => fs.map((f) => (f.id === id ? { ...f, position } : f)).sort((a, b) => a.position - b.position)),
    onError: rollback(qc, '排序失败，已恢复'),
    onSettled: settle,
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteFolder(id),
    onMutate: (id) => snapshot(qc, (fs) => fs.filter((f) => f.id !== id)),
    onError: rollback(qc, '删除文件夹失败，已恢复'),
    onSettled: settle,
  })
  const add = useMutation(addToFolderOptions(qc))
  return { create, rename, move, remove, add }
}

/** Float position for moving `from` to index `to` (§8.3: midpoint, one row updated). */
export function positionAt(fs: Folder[], from: number, to: number): number {
  const rest = fs.filter((_, i) => i !== from)
  const before = rest[to - 1]?.position
  const after = rest[to]?.position
  if (before == null) return (after ?? 1) - 1
  if (after == null) return before + 1
  return (before + after) / 2
}

export function useToggleFavorite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => api.setFavorite(id, on),
    onMutate: async ({ id, on }) => {
      await qc.cancelQueries({ queryKey: assetKeys.favs })
      const prev = qc.getQueryData<string[]>(assetKeys.favs)
      qc.setQueryData<string[]>(assetKeys.favs, (xs = []) => (on ? [...xs, id] : xs.filter((x) => x !== id)))
      return { prev }
    },
    onError: (e, { on }, ctx) => {
      qc.setQueryData(assetKeys.favs, ctx?.prev)
      toast({ title: on ? '收藏失败' : '取消收藏失败', description: errText(e), tone: 'error' })
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: assetKeys.favs }),
  })
}

/* ---------- delete with 5s undo (§6) ---------- */

/**
 * Hidden ids are filtered out by the view right away (so undo restores the exact position).
 * After `delay` the DELETEs go out; failures un-hide + onFailed, successes leave the cache via onCommitted.
 */
export function createDeleter({ remove, onCommitted, onFailed, delay = 5000 }: {
  remove: (id: string) => Promise<void>
  onCommitted: (ids: string[]) => void
  onFailed: (ids: string[], error: unknown) => void
  delay?: number
}) {
  let hidden: ReadonlySet<string> = new Set()
  const listeners = new Set<() => void>()
  const pending = new Set<() => void>()
  const setHidden = (ids: string[], on: boolean) => {
    const next = new Set(hidden)
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)))
    hidden = next
    listeners.forEach((l) => l())
  }

  function del(ids: string[]) {
    setHidden(ids, true)
    let state: 'waiting' | 'sent' | 'undone' = 'waiting'
    const send = async () => {
      if (state !== 'waiting') return
      state = 'sent'
      clearTimeout(timer)
      pending.delete(send)
      const results = await Promise.allSettled(ids.map((id) => remove(id)))
      const ok = ids.filter((_, i) => results[i]!.status === 'fulfilled')
      const bad = ids.filter((_, i) => results[i]!.status === 'rejected')
      if (ok.length) onCommitted(ok)
      setHidden(ids, false)
      const firstErr = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (bad.length) onFailed(bad, firstErr?.reason)
    }
    const timer = setTimeout(() => void send(), delay)
    pending.add(send)
    /** Returns false when the DELETEs already went out. */
    return () => {
      if (state !== 'waiting') return false
      state = 'undone'
      clearTimeout(timer)
      pending.delete(send)
      setHidden(ids, false)
      return true
    }
  }

  return {
    del,
    /** Send everything now (page hide). */
    flush: () => [...pending].forEach((s) => void s()),
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } },
    getHidden: () => hidden,
  }
}

let deleter: ReturnType<typeof createDeleter> | undefined
function getDeleter(qc: QueryClient) {
  if (deleter) return deleter
  deleter = createDeleter({
    remove: (id) => api.deleteAsset(id),
    onCommitted: (ids) => { removeFromLists(qc, new Set(ids)); void qc.invalidateQueries({ queryKey: assetKeys.folders }) },
    onFailed: (ids, e) => toast({ title: `${ids.length} 项删除失败，已恢复`, description: errText(e), tone: 'error' }),
  })
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => deleter?.flush())
  return deleter
}

export function useDeleteAssets() {
  const qc = useQueryClient()
  const d = getDeleter(qc)
  const hidden = useSyncExternalStore(d.subscribe, d.getHidden, d.getHidden)
  const del = (ids: string[]) => {
    if (!ids.length) return
    const undo = d.del(ids)
    toast({
      title: `已删除 ${ids.length} 项`,
      description: '5 秒内可撤销',
      duration: 5000,
      action: { label: '撤销', onClick: () => { if (!undo()) toast({ title: '已经删除，无法撤销', tone: 'error' }) } },
    })
  }
  return { hidden, del }
}
