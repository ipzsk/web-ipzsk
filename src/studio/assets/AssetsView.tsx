import { SubjectsPanel } from '../subjects/SubjectsPanel'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle, Download, Ellipsis, Eye, Folder as FolderIcon, FolderInput, FolderOpen, Grid3x3, Heart, ImagePlus, LayoutDashboard,
  LayoutGrid, Sparkles, Trash2, Upload, UploadCloud, Users, WandSparkles, X,
} from 'lucide-react'
import {
  Button, Dialog, DialogContent, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuTrigger, EmptyState, SegmentedControl, Skeleton, cn, focusRing, toast,
} from '@/ui'
import {
  MasonryGrid, MediaCard, MediaLightbox, useSelection, useUpload,
  type CardState, type MediaAsset, type UploadItem,
} from '@/media'
import { useOnline } from '@/shared/query'
import { getCase, toggleFavorite, useFavorites } from '../inspiration/api'
import { caseAsset, fillComposer } from '../inspiration/actions'
import type { CaseItem } from '../inspiration/lib'
import { addAssetsToCanvas, api, fillComposerWithAssets, uploadApi, type Asset, type Folder } from './api'
import { FolderColumn } from './FolderColumn'
import {
  prependAsset, useAssets, useDeleteAssets, useFavoriteAssets, useFolderMutations, useFolders, useToggleFavorite, type ListFilter, type Tab,
} from './queries'

/* ---------- small helpers ---------- */

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: '全部' }, { id: 'upload', label: '我的上传' }, { id: 'generation', label: '生成结果' },
  { id: 'cases', label: '收藏的案例' }, { id: 'subjects', label: '主体' },
]
const SOURCE_LABEL: Record<Asset['source'], string> = { upload: '上传', generation: '生成', poster: '封面' }
const VIEW_KEY = 'ipzsk:studio:assets-view'
const ACCEPT = 'image/png,image/jpeg,image/webp,video/mp4'
const OFFLINE = '网络已断开，恢复后才能上传'

type ViewMode = 'masonry' | 'dense'
function useViewMode() {
  const [mode, setMode] = useState<ViewMode>(() => { try { return localStorage.getItem(VIEW_KEY) === 'dense' ? 'dense' : 'masonry' } catch { return 'masonry' } })
  const set = (m: ViewMode) => { setMode(m); try { localStorage.setItem(VIEW_KEY, m) } catch { /* private mode */ } }
  return [mode, set] as const
}

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

const titleOf = (a: Asset) => `${SOURCE_LABEL[a.source] ?? '素材'} · ${new Date(a.created_at).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}`

/** thumb_state queued/running → MediaImage shows its 「处理中」 badge. */
const display = (a: Asset): MediaAsset => (a.thumb_state === 'queued' || a.thumb_state === 'running' ? { ...a, status: 'pending' } : a)

const normalize = (a: MediaAsset & Partial<Asset>): Asset => ({ source: 'upload', created_at: new Date().toISOString(), thumb_state: 'queued', ...a })

async function downloadAssets(assets: MediaAsset[]) {
  let fallback = 0
  for (const a of assets) {
    const ext = a.kind === 'video' ? 'mp4' : (a.urls.orig.match(/\.(png|jpe?g|webp)(\?|$)/)?.[1] ?? 'png')
    try {
      const res = await fetch(a.urls.orig)
      if (!res.ok) throw new Error(String(res.status))
      const url = URL.createObjectURL(await res.blob())
      const link = Object.assign(document.createElement('a'), { href: url, download: `ipzsk-${a.id.slice(0, 8)}.${ext}` })
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      // Cross-origin without CORS: the browser can only open it.
      fallback++
      window.open(a.urls.orig, '_blank', 'noopener,noreferrer')
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  toast(fallback
    ? { title: `${fallback} 项已在新标签页打开`, description: '浏览器不允许直接保存，请在新标签页里右键另存', tone: 'default' }
    : { title: `已开始下载 ${assets.length} 项`, tone: 'success' })
}

function fillAssets(assets: MediaAsset[]) {
  fillComposerWithAssets(assets)
  toast({ title: `已加入输入框`, description: `${assets.length} 张参考素材`, tone: 'success' })
}

type Cell =
  | { type: 'upload'; key: string; item: UploadItem }
  | { type: 'asset'; key: string; asset: Asset }
  | { type: 'case'; key: string; c: CaseItem; asset: MediaAsset }

/* ---------- view ---------- */

export function AssetsView() {
  // Drag context is provided once by the studio layout (App.tsx) so cards can also drop into the composer and canvas.
  return <AssetsPage />
}

function AssetsPage() {
  const { folderId = null } = useParams()
  const [sp, setSp] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const online = useOnline()
  const [mode, setMode] = useViewMode()
  const [sheet, setSheet] = useState(false)

  const rawTab = sp.get('tab') as Tab | null
  const tab: Tab = folderId ? 'all' : TABS.some((t) => t.id === rawTab) ? rawTab! : 'all'
  const rawKind = sp.get('kind')
  const kind = rawKind === 'image' || rawKind === 'video' ? rawKind : ''
  const assetTab = tab === 'all' || tab === 'upload' || tab === 'generation'
  const filter = useMemo<ListFilter>(() => ({ tab, kind, folder: folderId }), [tab, kind, folderId])
  const setParam = (patch: Record<string, string | null>) => setSp((cur) => {
    const n = new URLSearchParams(cur)
    for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k) }
    return n
  })

  /* data */
  const assets = useAssets(filter, assetTab)
  const { hidden, del } = useDeleteAssets()
  const items = useMemo(() => (assets.data?.pages.flatMap((p) => p.items) ?? []).filter((a) => !hidden.has(a.id)), [assets.data, hidden])
  const folders = useFolders()
  const folderList = useMemo(() => folders.data ?? [], [folders.data])
  const currentFolder = folderId ? folderList.find((f) => f.id === folderId) : undefined
  const fm = useFolderMutations()
  const favs = useFavoriteAssets()
  const favSet = useMemo(() => new Set(favs.data ?? []), [favs.data])
  const toggleFav = useToggleFavorite()

  const caseFavs = useFavorites()
  const caseIds = useMemo(() => [...caseFavs].reverse(), [caseFavs])
  const cases = useQuery({
    queryKey: ['assets', 'fav-cases', caseIds],
    queryFn: async () => (await Promise.all(caseIds.map(getCase))).filter((c): c is CaseItem => !!c),
    enabled: tab === 'cases',
  })

  // Folder vanished (deleted here or elsewhere) → back to all assets.
  useEffect(() => {
    if (folderId && folders.isSuccess && !currentFolder && !folderId.startsWith('temp-')) navigate('/studio/assets', { replace: true })
  }, [folderId, folders.isSuccess, currentFolder, navigate])

  /* uploads */
  const upload = useUpload({ api: uploadApi, storageKey: 'ipzsk:assets-uploads' })
  const fileInput = useRef<HTMLInputElement>(null)
  const pickFiles = () => { if (online) fileInput.current?.click() }
  const take = useCallback((files: File[]) => {
    if (!files.length) return
    if (!navigator.onLine) { toast({ title: '无法上传', description: OFFLINE, tone: 'error' }); return }
    const errors = upload.add(files)
    if (errors.length) toast({ title: `${errors.length} 个文件无法上传`, description: errors.join('；'), tone: 'error' })
  }, [upload.add]) // eslint-disable-line react-hooks/exhaustive-deps

  const uploadTarget = useRef(folderId)
  uploadTarget.current = folderId
  useEffect(() => {
    for (const it of upload.items) {
      if (it.status !== 'done' || !it.asset) continue
      const a = normalize(it.asset)
      const folder = uploadTarget.current
      prependAsset(qc, a, folder)
      upload.remove(it.clientId)
      if (folder) {
        // Uploading inside a folder files it there too; quiet (no toast per file), counts refresh after.
        api.addToFolder(folder, [a.id])
          .catch((e: unknown) => toast({ title: '已上传，但没能放进文件夹', description: e instanceof Error ? e.message : undefined, tone: 'error' }))
          .finally(() => void qc.invalidateQueries({ queryKey: ['assets'] }))
      }
    }
  }, [upload.items]) // eslint-disable-line react-hooks/exhaustive-deps

  // Paste anywhere (not into text fields — the composer owns those).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return
      const files = Array.from(e.clipboardData?.files ?? [])
      if (!files.length) return
      e.preventDefault()
      take(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [take])

  // Page-level OS file drop overlay (§4.3).
  const [fileOver, setFileOver] = useState(false)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth++; setFileOver(true) } }
    const over = (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer!.dropEffect = online ? 'copy' : 'none' } }
    const leave = (e: DragEvent) => { if (hasFiles(e) && --depth <= 0) { depth = 0; setFileOver(false) } }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setFileOver(false)
      take(Array.from(e.dataTransfer!.files))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [take, online])

  /* cells */
  const showUploads = (tab === 'all' || tab === 'upload')
  const cells = useMemo<Cell[]>(() => {
    if (tab === 'cases') return (cases.data ?? []).map((c) => ({ type: 'case', key: `case:${c.id}`, c, asset: caseAsset(c) }))
    if (!assetTab) return []
    const ups: Cell[] = showUploads
      ? upload.items.filter((u) => u.status !== 'done' && (!kind || u.kind === kind)).map((item) => ({ type: 'upload', key: `upload:${item.clientId}`, item }))
      : []
    return [...ups, ...items.map((asset): Cell => ({ type: 'asset', key: asset.id, asset }))]
  }, [tab, assetTab, showUploads, cases.data, upload.items, items, kind])

  /* selection */
  const ids = useMemo(() => items.map((a) => a.id), [items])
  const sel = useSelection(ids)
  const selectedAssets = useMemo(() => items.filter((a) => sel.selected.has(a.id)), [items, sel.selected])
  useEffect(() => { sel.clear() }, [filter]) // eslint-disable-line react-hooks/exhaustive-deps
  const deleteAssets = (list: MediaAsset[]) => {
    del(list.map((a) => a.id))
    sel.setSelected((s) => { const n = new Set(s); list.forEach((a) => n.delete(a.id)); return n })
  }

  /* lightbox (deep link ?asset=) */
  const lightboxAssets = useMemo(() => cells.filter((c) => c.type !== 'upload').map((c) => (c as Exclude<Cell, { type: 'upload' }>).asset), [cells])
  const openId = sp.get('asset')
  const lightboxIndex = openId ? lightboxAssets.findIndex((a) => a.id === openId) : -1
  const openedFrom = useRef<number | null>(null)
  const openAsset = useCallback((id: string) => {
    openedFrom.current = window.scrollY
    const n = new URLSearchParams(sp); n.set('asset', id)
    navigate({ search: `?${n}` }, { state: { assetOverlay: true } })
  }, [navigate, sp])
  const closeAsset = () => {
    if ((location.state as { assetOverlay?: boolean } | null)?.assetOverlay) navigate(-1)
    else setParam({ asset: null })
  }
  const wasOpen = useRef(false)
  useLayoutEffect(() => {
    const open = lightboxIndex >= 0
    if (wasOpen.current && !open && openedFrom.current != null) {
      const y = openedFrom.current
      openedFrom.current = null
      requestAnimationFrame(() => window.scrollTo(0, y))
    }
    wasOpen.current = open
  }, [lightboxIndex])

  /* keyboard: Esc / Delete / Cmd+A */
  const lightboxOpen = lightboxIndex >= 0
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isEditable(e.target) || lightboxOpen || document.querySelector('[role="dialog"],[role="menu"]')) return
      if (e.key === 'Escape' && sel.selected.size) { sel.clear() }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAssets.length) { e.preventDefault(); deleteAssets(selectedAssets) }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && assetTab && ids.length) { e.preventDefault(); sel.selectAll() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* infinite */
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = assets
  const onEndReached = useCallback(() => { if (hasNextPage && !isFetchingNextPage) void fetchNextPage() }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const loading = tab === 'cases' ? cases.isPending : assetTab && (assets.isPending || isFetchingNextPage)
  const error = tab === 'cases'
    ? (cases.isError ? '收藏的案例加载失败，请检查网络后重试' : null)
    : assets.isError ? '素材加载失败，请检查网络后重试' : null
  const retry = () => void (tab === 'cases' ? cases.refetch() : assets.isFetchNextPageError ? fetchNextPage() : assets.refetch())

  const empty = folderId
    ? <EmptyState icon={FolderOpen} text="文件夹是空的：把素材拖到左侧文件夹，或在这里上传" action={online ? { label: '上传素材', onClick: pickFiles } : undefined} />
    : tab === 'generation'
      ? <EmptyState icon={Sparkles} text={kind === 'video' ? '还没有生成过视频' : '还没有生成结果'} action={{ label: '去创作', onClick: () => navigate('/studio/create') }} />
      : tab === 'cases'
        ? <EmptyState icon={Heart} text="还没有收藏的案例" action={{ label: '去灵感看看', onClick: () => navigate('/studio') }} />
        : <EmptyState icon={Upload} text={online ? (kind === 'video' ? '还没有视频素材' : '还没有素材，拖入或粘贴图片也可以上传') : OFFLINE} action={online ? { label: '上传第一张图', onClick: pickFiles } : undefined} />

  const renderCell = (cell: Cell, index: number) => {
    if (cell.type === 'upload') return <UploadCell item={cell.item} upload={upload} onRepick={pickFiles} />
    if (cell.type === 'case') return <CaseCell c={cell.c} asset={cell.asset} onOpen={() => openAsset(cell.asset.id)} />
    const a = cell.asset
    const selected = sel.selected.has(a.id)
    return (
      <AssetCell
        asset={a}
        priority={index < 10}
        selected={selected}
        selectionMode={sel.selected.size > 0}
        onSelect={(mods) => sel.select(a.id, mods)}
        dragItems={selected ? selectedAssets : [a]}
        fav={favSet.has(a.id)}
        folders={folderList}
        onOpen={() => openAsset(a.id)}
        onFav={() => toggleFav.mutate({ id: a.id, on: !favSet.has(a.id) })}
        onMove={(f) => fm.add.mutate({ folder: f, ids: [a.id] })}
        onDelete={() => deleteAssets([a])}
      />
    )
  }

  const title = folderId ? currentFolder?.name ?? '文件夹' : '素材'

  return (
    <section aria-labelledby="assets-title" className="md:grid md:grid-cols-[200px_1fr] md:gap-6">
      <aside className="sticky top-[88px] hidden max-h-[calc(100dvh-104px)] self-start overflow-y-auto md:block">
        <FolderColumn current={folderId} />
      </aside>

      <div className="min-w-0">
        <div className="sticky top-16 z-30 -mx-4 -mt-6 mb-4 grid gap-3 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur-md max-[720px]:top-[104px] md:mx-0 md:px-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 id="assets-title" className="mr-auto flex min-w-0 items-center gap-2 truncate text-xl font-bold">
              {folderId && <FolderIcon className="size-5 shrink-0" aria-hidden />}{title}
            </h1>
            <Button size="sm" className="md:hidden" aria-label="文件夹" icon={<FolderOpen className="size-4" aria-hidden />} onClick={() => setSheet(true)}><span className="max-sm:sr-only">文件夹</span></Button>
            {(assetTab || folderId) && (
              <SegmentedControl
                label="视图"
                value={mode}
                onValueChange={setMode}
                options={[{ value: 'masonry', label: '瀑布流', icon: LayoutGrid }, { value: 'dense', label: '紧凑网格', icon: Grid3x3 }]}
                className="max-sm:[&_button]:gap-0 max-sm:[&_button]:px-2 max-sm:[&_button]:text-[0px]"
              />
            )}
            <Button
              variant="primary"
              size="sm"
              icon={<Upload className="size-4" aria-hidden />}
              disabled={!online}
              disabledReason={OFFLINE}
              onClick={pickFiles}
            >
              <span className="max-sm:sr-only">上传</span>
            </Button>
            <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden data-testid="assets-file-input" onChange={(e) => { take(Array.from(e.target.files ?? [])); e.target.value = '' }} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {!folderId && (
              <div role="group" aria-label="分组" className="-mx-1 flex min-w-0 max-md:basis-full flex-1 gap-2 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]">
                {TABS.map((t) => (
                  <Chip key={t.id} on={tab === t.id} onClick={() => setParam({ tab: t.id === 'all' ? null : t.id, asset: null })}>
                    {t.id === 'subjects' && <Users className="size-3.5" aria-hidden />}{t.label}
                  </Chip>
                ))}
              </div>
            )}
            {(assetTab || folderId) && (
              <div role="group" aria-label="类型" className={cn('flex gap-1', folderId && 'mr-auto')}>
                {([['', '全部'], ['image', '图片'], ['video', '视频']] as const).map(([k, label]) => (
                  <Chip key={k || 'any'} small on={kind === k} onClick={() => setParam({ kind: k || null, asset: null })}>{label}</Chip>
                ))}
              </div>
            )}
          </div>
        </div>

        {tab === 'subjects' ? (
          <SubjectsPanel />
        ) : mode === 'dense' && tab !== 'cases' ? (
          <DenseGrid cells={cells} render={renderCell} loading={!!loading} error={error} onRetry={retry} onEndReached={onEndReached} empty={empty} />
        ) : (
          <MasonryGrid
            aria-label={tab === 'cases' ? '收藏的案例' : '素材'}
            items={cells}
            getKey={(c) => c.key}
            getAspect={(c) => (c.type === 'upload' ? null : c.asset.width && c.asset.height ? c.asset.height / c.asset.width : null)}
            renderItem={renderCell}
            loading={!!loading}
            error={error}
            onRetry={retry}
            onEndReached={onEndReached}
            empty={empty}
          />
        )}
      </div>

      <BatchBar
        count={selectedAssets.length}
        folders={folderList}
        onMove={(f) => { fm.add.mutate({ folder: f, ids: selectedAssets.map((a) => a.id) }); sel.clear() }}
        onDownload={() => void downloadAssets(selectedAssets)}
        onFill={() => fillAssets(selectedAssets)}
        onCanvas={() => addToCanvas(selectedAssets, navigate)}
        onDelete={() => deleteAssets(selectedAssets)}
        onClear={sel.clear}
      />

      {fileOver && (
        <div aria-live="polite" className="pointer-events-none fixed inset-0 z-[70] grid place-items-center bg-ink/40 p-6 motion-safe:animate-fade-in">
          <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-acid bg-card/95 px-10 py-8 text-center shadow-2xl">
            <UploadCloud className="size-8 text-ink" aria-hidden />
            <p className="text-base font-semibold text-ink">{online ? `松开即可上传${currentFolder ? `到「${currentFolder.name}」` : '到素材'}` : OFFLINE}</p>
            <p className="text-xs text-muted">PNG / JPEG / WebP ≤ 20MB，MP4 ≤ 200MB</p>
          </div>
        </div>
      )}

      <MediaLightbox
        items={lightboxAssets.map((asset) => ({ asset, filename: `ipzsk-${asset.id.slice(0, 8)}` }))}
        index={Math.max(0, lightboxIndex)}
        open={lightboxOpen}
        onIndexChange={(i) => { const id = lightboxAssets[i]?.id; if (id) navigate({ search: `?${new URLSearchParams({ ...Object.fromEntries(sp), asset: id })}` }, { replace: true, state: location.state }) }}
        onClose={closeAsset}
      />

      <Dialog open={sheet} onOpenChange={setSheet}>
        <DialogContent
          title="文件夹"
          className="bottom-0 left-0 top-auto max-h-[80dvh] w-full max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-b-none md:hidden"
        >
          <FolderColumn current={folderId} onNavigate={() => setSheet(false)} />
        </DialogContent>
      </Dialog>
    </section>
  )
}

function addToCanvas(assets: MediaAsset[], navigate: (to: string) => void) {
  addAssetsToCanvas(assets)
  toast({ title: '已放到画布', description: `${assets.length} 项素材`, tone: 'success', action: { label: '去画布', onClick: () => navigate('/studio/canvas') } })
}

function Chip({ on, small, onClick, children }: { on: boolean; small?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border font-semibold transition-[background-color,border-color,transform] duration-(--duration-fast) active:scale-[.98] motion-reduce:active:scale-100',
        small ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
        on ? 'border-ink bg-ink text-acid' : 'border-line bg-card text-ink hover:border-muted hover:bg-subtle',
        focusRing,
      )}
    >
      {children}
    </button>
  )
}

/* ---------- cards ---------- */

const overlayBtn = cn('grid size-8 shrink-0 place-items-center rounded-control text-card transition-[background-color,transform] duration-(--duration-fast) hover:bg-card/20 active:scale-[.98] motion-reduce:active:scale-100', focusRing, 'focus-visible:outline-card')

function OverlayButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className={overlayBtn}>{children}</button>
}

type Mods = { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }

function AssetCell({ asset, priority, selected, selectionMode, onSelect, dragItems, fav, folders, onOpen, onFav, onMove, onDelete }: {
  asset: Asset; priority: boolean; selected: boolean; selectionMode: boolean; onSelect: (m: Mods) => void; dragItems: MediaAsset[]
  fav: boolean; folders: Folder[]; onOpen: () => void; onFav: () => void; onMove: (f: Folder) => void; onDelete: () => void
}) {
  const navigate = useNavigate()
  const one = [asset]
  return (
    <div data-asset-id={asset.id} className="group/asset relative h-full">
      <MediaCard
        asset={display(asset)}
        title={titleOf(asset)}
        priority={priority}
        selected={selected}
        selectionMode={selectionMode}
        onSelect={onSelect}
        dragItems={dragItems}
        onOpen={onOpen}
        overlay={
          <div className="flex items-center gap-0.5">
            <OverlayButton label="预览" onClick={onOpen}><Eye aria-hidden /></OverlayButton>
            <OverlayButton label="下载" onClick={() => void downloadAssets(one)}><Download aria-hidden /></OverlayButton>
            <OverlayButton label="加入输入框" onClick={() => fillAssets(one)}><ImagePlus aria-hidden /></OverlayButton>
            <OverlayButton label="放到画布" onClick={() => addToCanvas(one, navigate)}><LayoutDashboard aria-hidden /></OverlayButton>
            <button type="button" aria-label={fav ? '取消收藏' : '收藏'} aria-pressed={fav} title={fav ? '取消收藏' : '收藏'} onClick={onFav} className={overlayBtn}>
              <Heart aria-hidden className={cn(fav && 'fill-current text-acid')} />
            </button>
            <span className="flex-1" />
            <OverlayButton label="删除" onClick={onDelete}><Trash2 aria-hidden /></OverlayButton>
          </div>
        }
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="更多操作"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'absolute right-2 top-2 grid size-8 place-items-center rounded-control bg-ink/55 text-card opacity-0 backdrop-blur-sm transition-[opacity,background-color] duration-(--duration-fast) hover:bg-ink/75',
              'group-hover/asset:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100',
              focusRing,
            )}
          >
            <Ellipsis aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
          <DropdownMenuItem onSelect={onOpen}><Eye aria-hidden />预览</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void downloadAssets(one)}><Download aria-hidden />下载</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => fillAssets(one)}><ImagePlus aria-hidden />加入输入框</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => addToCanvas(one, navigate)}><LayoutDashboard aria-hidden />放到画布</DropdownMenuItem>
          <DropdownMenuItem onSelect={onFav}><Heart aria-hidden className={cn(fav && 'fill-current')} />{fav ? '取消收藏' : '收藏'}</DropdownMenuItem>
          {folders.length > 0 && <><DropdownMenuSeparator /><DropdownMenuLabel>移动到文件夹</DropdownMenuLabel></>}
          {folders.map((f) => (
            <DropdownMenuItem key={f.id} disabled={f.id.startsWith('temp-')} onSelect={() => onMove(f)}><FolderInput aria-hidden />{f.name}</DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem danger onSelect={onDelete}><Trash2 aria-hidden />删除</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function UploadCell({ item, upload, onRepick }: { item: UploadItem; upload: ReturnType<typeof useUpload>; onRepick: () => void }) {
  const asset: MediaAsset = {
    id: item.clientId, kind: item.kind, status: item.status === 'processing' ? 'pending' : 'ready',
    width: null, height: null, duration_ms: null, urls: { orig: item.previewUrl ?? '' },
  }
  const state: CardState | undefined =
    item.status === 'uploading' ? { kind: 'uploading', progress: item.progress }
      : item.status === 'failed' ? { kind: 'failed', reason: item.error ?? '上传失败', onRetry: item.file ? () => upload.retry(item.clientId) : undefined }
        : item.status === 'interrupted' ? { kind: 'failed', reason: item.error ?? '上传中断', onRetry: () => { upload.remove(item.clientId); onRepick() } }
          : undefined
  const busy = item.status === 'uploading' || item.status === 'processing'
  return (
    <div className="relative h-full" data-upload-status={item.status}>
      <MediaCard asset={asset} title={item.name} state={state} />
      <button
        type="button"
        aria-label={busy ? `取消上传 ${item.name}` : `移除 ${item.name}`}
        title={busy ? '取消上传' : '移除'}
        onClick={() => upload.remove(item.clientId)}
        className={cn('absolute left-2 top-2 z-10 grid size-7 place-items-center rounded-full bg-ink/70 text-card transition-[background-color,transform] duration-(--duration-fast) hover:bg-ink active:scale-[.98] motion-reduce:active:scale-100', focusRing)}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}

function CaseCell({ c, asset, onOpen }: { c: CaseItem; asset: MediaAsset; onOpen: () => void }) {
  return (
    <MediaCard
      asset={asset}
      title={c.title}
      onOpen={onOpen}
      overlay={
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => fillComposer(c)}
            className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control bg-acid px-3 text-[13px] font-semibold text-ink transition-[filter,transform] duration-(--duration-fast) hover:brightness-95 active:scale-[.98] motion-reduce:active:scale-100', focusRing, 'focus-visible:outline-card')}
          >
            <WandSparkles aria-hidden />做同款
          </button>
          <OverlayButton label="预览" onClick={onOpen}><Eye aria-hidden /></OverlayButton>
          <button type="button" aria-label="取消收藏" aria-pressed title="取消收藏" onClick={() => toggleFavorite(c.id)} className={overlayBtn}>
            <Heart aria-hidden className="fill-current text-acid" />
          </button>
        </div>
      }
    />
  )
}

/* ---------- dense grid (fixed square cells) ---------- */

function DenseGrid({ cells, render, loading, error, onRetry, onEndReached, empty }: {
  cells: Cell[]; render: (c: Cell, i: number) => ReactNode; loading: boolean; error: string | null
  onRetry: () => void; onEndReached: () => void; empty: ReactNode
}) {
  const grid = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) onEndReached() }, { rootMargin: '800px' })
    io.observe(el)
    return () => io.disconnect()
  }, [onEndReached, cells.length])

  // ponytail: not virtualized — fine for a few thousand loaded assets; switch to react-virtual rows if users hoard more.
  const onKeyDown = (e: RKeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: 'up', ArrowDown: 'down' }[e.key]
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-cell-index]')
    if (step == null || !cell || !grid.current) return
    const cols = getComputedStyle(grid.current).gridTemplateColumns.split(' ').length
    const i = Number(cell.dataset.cellIndex) + (step === 'up' ? -cols : step === 'down' ? cols : (step as number))
    const target = grid.current.querySelector<HTMLElement>(`[data-cell-index="${i}"] [tabindex="0"]`)
    if (!target) return
    e.preventDefault()
    target.focus()
  }

  if (error && !cells.length) {
    return <EmptyState icon={AlertCircle} text={error} action={{ label: '重试', onClick: onRetry }} />
  }
  if (!loading && !cells.length) return <>{empty}</>
  return (
    <div>
      <div ref={grid} role="list" aria-label="素材" aria-busy={loading || undefined} onKeyDown={onKeyDown} className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2 md:grid-cols-[repeat(auto-fill,minmax(148px,1fr))]">
        {cells.map((c, i) => (
          <div key={c.key} role="listitem" data-cell-index={i} className="aspect-square">{render(c, i)}</div>
        ))}
        {loading && Array.from({ length: cells.length ? 8 : 24 }, (_, i) => <Skeleton key={`sk-${i}`} className="aspect-square rounded-card" />)}
      </div>
      {error && cells.length > 0 && (
        <div role="alert" className="flex items-center justify-center gap-3 py-6 text-sm text-danger">
          {error}<Button size="sm" onClick={onRetry}>重试</Button>
        </div>
      )}
      <div ref={sentinel} aria-hidden className="h-px" />
    </div>
  )
}

/* ---------- batch bar ---------- */

export function BatchBar({ count, folders, onMove, onDownload, onFill, onCanvas, onDelete, onClear }: {
  count: number; folders: Folder[]; onMove: (f: Folder) => void; onDownload: () => void; onFill: () => void
  onCanvas: () => void; onDelete: () => void; onClear: () => void
}) {
  if (!count) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 max-md:bottom-[72px] md:left-52">
      <div role="toolbar" aria-label="批量操作" className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-panel border border-line bg-ink p-1.5 pl-4 text-card shadow-2xl motion-safe:animate-fade-in">
        <span className="shrink-0 pr-2 text-sm font-semibold tabular-nums" aria-live="polite">已选 {count} 项</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={batchBtn}><FolderInput aria-hidden /><span className="max-sm:sr-only">移动到文件夹</span></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start">
            {folders.length ? folders.map((f) => (
              <DropdownMenuItem key={f.id} disabled={f.id.startsWith('temp-')} onSelect={() => onMove(f)}><FolderIcon aria-hidden />{f.name}<span className="ml-auto pl-4 text-xs text-muted tabular-nums">{f.count}</span></DropdownMenuItem>
            )) : <DropdownMenuLabel>还没有文件夹，先在左侧新建一个</DropdownMenuLabel>}
          </DropdownMenuContent>
        </DropdownMenu>
        <button type="button" className={batchBtn} onClick={onDownload}><Download aria-hidden /><span className="max-sm:sr-only">下载</span></button>
        <button type="button" className={batchBtn} onClick={onFill}><ImagePlus aria-hidden /><span className="max-sm:sr-only">加入输入框</span></button>
        <button type="button" className={batchBtn} onClick={onCanvas}><LayoutDashboard aria-hidden /><span className="max-sm:sr-only">放到画布</span></button>
        <button type="button" className={cn(batchBtn, 'text-[#ff9b8c] hover:bg-danger/30')} onClick={onDelete}><Trash2 aria-hidden /><span className="max-sm:sr-only">删除</span></button>
        <span className="mx-1 h-5 w-px shrink-0 bg-card/20" />
        <button type="button" aria-label="取消选择 (Esc)" title="取消选择 (Esc)" className={cn(batchBtn, 'px-2')} onClick={onClear}><X aria-hidden /></button>
      </div>
    </div>
  )
}

const batchBtn = cn(
  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-control px-3 text-[13px] font-semibold text-card transition-[background-color,transform] duration-(--duration-fast) hover:bg-card/15 active:scale-[.98] motion-reduce:active:scale-100',
  focusRing, 'focus-visible:outline-acid',
)
