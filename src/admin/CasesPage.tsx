import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useInfiniteQuery, useMutation, useQuery, type InfiniteData } from '@tanstack/react-query'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type Announcements, type DragEndEvent, type UniqueIdentifier } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Eye, EyeOff, GripVertical, LayoutGrid, Pencil, Plus, Rows3, SearchX, Trash2 } from 'lucide-react'
import { Button, Checkbox, EmptyState, ErrorState, IconButton, SegmentedControl, Skeleton, cn, focusRing, toast } from '@/ui'
import { MediaImage } from '@/media'
import { queryClient } from '@/shared/query'
import { adminApi, type CaseQuery, type Page } from './api'
import { STATUS_LABEL, fmtTime, moveCase, type AdminCase, type CaseStatus } from './lib'
import { Confirm, FilterInput, PageHeader, Select, StatusBadge, adminErrorText } from './ui'
import { useCan } from './App'

type Cases = InfiniteData<Page<AdminCase>, string | null>
export const casesKey = (q?: CaseQuery) => (q ? ['admin', 'cases', q] : ['admin', 'cases']) as readonly unknown[]

/** Apply `fn` to every cached case list (optimistic writes). Returns a rollback. */
function patchLists(fn: (items: AdminCase[]) => AdminCase[]) {
  const snapshot = queryClient.getQueriesData<Cases>({ queryKey: ['admin', 'cases'] })
  for (const [key, data] of snapshot) {
    if (!data?.pages) continue
    const flat = fn(data.pages.flatMap(p => p.items))
    let i = 0
    queryClient.setQueryData<Cases>(key, { ...data, pages: data.pages.map(p => { const items = flat.slice(i, i + p.items.length); i += p.items.length; return { ...p, items } }) })
  }
  return () => snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data))
}

export function CasesPage() {
  const [sp, setSp] = useSearchParams()
  const navigate = useNavigate()
  const writable = useCan('cases.write')
  const filter: CaseQuery = useMemo(() => ({ status: (sp.get('status') ?? '') as CaseStatus | '', category: sp.get('category') ?? '', q: sp.get('q') ?? '' }), [sp])
  const view = sp.get('view') === 'grid' ? 'grid' : 'table'
  const set = (k: string, v: string) => setSp(cur => { const p = new URLSearchParams(cur); if (v) p.set(k, v); else p.delete(k); return p }, { replace: true })

  const [text, setText] = useState(filter.q ?? '')
  useEffect(() => { if (text.trim() === filter.q) return; const t = setTimeout(() => set('q', text.trim()), 250); return () => clearTimeout(t) }) // eslint-disable-line react-hooks/exhaustive-deps

  const cats = useQuery({ queryKey: ['admin', 'case-categories'], queryFn: adminApi.cases.categories, staleTime: 5 * 60_000 })
  const list = useInfiniteQuery({
    queryKey: casesKey(filter),
    queryFn: ({ pageParam }) => adminApi.cases.list({ ...filter, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: last => last.next_cursor,
  })
  const items = useMemo(() => list.data?.pages.flatMap(p => p.items) ?? [], [list.data])
  const total = list.data?.pages[0]?.total

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  /* reorder: optimistic position, rollback + toast (§6) */
  const move = useMutation({
    mutationFn: (v: { id: string; after_id: string | null; before_id: string | null; next: AdminCase[] }) => adminApi.cases.move(v.id, v),
    onMutate: async v => {
      await queryClient.cancelQueries({ queryKey: ['admin', 'cases'] })
      const snapshot = queryClient.getQueryData<Cases>(casesKey(filter))
      if (snapshot) {
        let i = 0
        queryClient.setQueryData<Cases>(casesKey(filter), { ...snapshot, pages: snapshot.pages.map(p => { const its = v.next.slice(i, i + p.items.length); i += p.items.length; return { ...p, items: its } }) })
      }
      return { snapshot }
    },
    onError: (e, _v, ctx) => { if (ctx?.snapshot) queryClient.setQueryData(casesKey(filter), ctx.snapshot); toast({ title: '排序未保存，已恢复原位置', description: adminErrorText(e), tone: 'error' }) },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['admin', 'cases'] }),
  })
  const reorderBlocked = filter.q ? '搜索结果中不能排序，清除搜索后再拖动' : null
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || reorderBlocked) return
    const r = moveCase(items, String(active.id), String(over.id))
    if (r) move.mutate({ id: String(active.id), after_id: r.after_id, before_id: r.before_id, next: r.list })
  }

  /* status (single + bulk): optimistic, per-item rollback */
  const setStatus = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: CaseStatus }) => adminApi.cases.bulkStatus(ids, status),
    onMutate: async ({ ids, status }) => {
      await queryClient.cancelQueries({ queryKey: ['admin', 'cases'] })
      const before = new Map(items.filter(c => ids.includes(c.id)).map(c => [c.id, c.status]))
      patchLists(xs => xs.map(c => ids.includes(c.id) ? { ...c, status } : c))
      return { before }
    },
    onSuccess: (res, { status }, ctx) => {
      const failed = res.items.filter(i => !i.ok)
      if (failed.length) {
        patchLists(xs => xs.map(c => failed.some(f => f.id === c.id) ? { ...c, status: ctx.before.get(c.id) ?? c.status } : c))
        const first = failed[0]!
        toast({
          title: `${failed.length} 个案例未能${STATUS_LABEL[status].replace('已', '')}`,
          description: first.error?.code === 'case_publish_invalid' ? `#${first.id} 缺少必填字段（${first.error.fields?.map(f => f.field).join('、')}）` : adminErrorText(first.error),
          tone: 'error',
          action: { label: '去编辑', onClick: () => navigate(`/admin/cases/${encodeURIComponent(first.id)}`) },
        })
      }
      const ok = res.items.length - failed.length
      if (ok) toast({ title: `已${STATUS_LABEL[status].replace('已', '')} ${ok} 个案例`, tone: 'success' })
      setSelected(new Set())
    },
    onError: (e, _v, ctx) => {
      patchLists(xs => xs.map(c => ctx?.before.has(c.id) ? { ...c, status: ctx.before.get(c.id)! } : c))
      toast({ title: '状态未保存，已恢复', description: adminErrorText(e), tone: 'error' })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['admin', 'case-categories'] }),
  })

  const [deleting, setDeleting] = useState<AdminCase | null>(null)
  // Chinese live-region text for dnd-kit (defaults are English).
  const where = (id: UniqueIdentifier | undefined) => { const i = items.findIndex(c => c.id === id); return i < 0 ? '' : `「${items[i]!.title}」（第 ${i + 1} / ${items.length} 位）` }
  const announcements: Announcements = {
    onDragStart: ({ active }) => `已拿起${where(active.id)}`,
    onDragOver: ({ active, over }) => !over ? `${where(active.id)}不在可放置区域` : over.id === active.id ? `已拿起${where(active.id)}，当前在原位` : `${where(active.id)}移到${where(over.id)}的位置`,
    onDragEnd: ({ active, over }) => over ? `已放下${where(active.id)}，放到${where(over.id)}的位置` : `已放下${where(active.id)}`,
    onDragCancel: ({ active }) => `已取消拖动，${where(active.id)}回到原位`,
  }
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  const allSelected = items.length > 0 && items.every(c => selected.has(c.id))
  const rowProps = (c: AdminCase) => ({
    c, writable, reorderBlocked, selected: selected.has(c.id), onToggle: () => toggle(c.id),
    onStatus: (status: CaseStatus) => setStatus.mutate({ ids: [c.id], status }), onDelete: () => setDeleting(c),
  })

  return (
    <section aria-labelledby="cases-title">
      <PageHeader title="案例库">
        <SegmentedControl label="视图" value={view} onValueChange={v => set('view', v === 'table' ? '' : v)} options={[{ value: 'table', label: '列表', icon: Rows3 }, { value: 'grid', label: '网格', icon: LayoutGrid }]} />
        {writable && <Button variant="primary" icon={<Plus />} onClick={() => navigate('/admin/cases/new')}>新建案例</Button>}
      </PageHeader>
      <h2 id="cases-title" className="sr-only">案例列表</h2>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Select label="状态" value={filter.status} onChange={e => set('status', e.target.value)}>
          <option value="">全部状态</option>
          {(['draft', 'published', 'hidden'] as const).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </Select>
        <Select label="分类" value={filter.category} onChange={e => set('category', e.target.value)}>
          <option value="">全部分类</option>
          {cats.data?.map(c => <option key={c.category} value={c.category}>{c.category_zh ?? c.category}（{c.count}）</option>)}
        </Select>
        <FilterInput label="搜索" type="search" value={text} onChange={e => setText(e.target.value)} placeholder="标题、提示词、标签、id" className="w-64" />
        <span className="pb-2 text-sm text-muted tabular-nums">{total != null && `共 ${total} 个`}</span>
        {writable && selected.size > 0 && (
          <div role="toolbar" aria-label="批量操作" className="ml-auto flex items-center gap-2 rounded-control bg-ink px-3 py-1.5 text-sm text-acid">
            已选 {selected.size}
            <Button size="sm" icon={<Eye />} loading={setStatus.isPending} onClick={() => setStatus.mutate({ ids: [...selected], status: 'published' })}>发布</Button>
            <Button size="sm" icon={<EyeOff />} onClick={() => setStatus.mutate({ ids: [...selected], status: 'hidden' })}>隐藏</Button>
            <Button size="sm" variant="ghost" className="text-acid hover:bg-card/10" onClick={() => setSelected(new Set())}>取消选择</Button>
          </div>
        )}
      </div>
      {writable && <p className="mb-3 text-xs text-muted">{reorderBlocked ?? '拖动 ⋮⋮ 调整在灵感瀑布流中的顺序（键盘：聚焦手柄按空格拿起，方向键移动，空格放下）'}</p>}

      {list.isError ? <ErrorState reason="案例加载失败，请检查网络后重试" action={{ label: '重试', onClick: () => void list.refetch() }} />
        : list.isPending ? <div className="grid gap-2">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
        : !items.length ? <EmptyState icon={SearchX} text="没有符合筛选的案例" action={{ label: '清除筛选', onClick: () => { setText(''); setSp({}, { replace: true }) } }} />
        : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ screenReaderInstructions: { draggable: '按空格拿起，用方向键移动，再按空格放下' }, announcements }}>
            <SortableContext items={items.map(c => c.id)} strategy={view === 'grid' ? rectSortingStrategy : verticalListSortingStrategy} disabled={!writable || !!reorderBlocked}>
              {view === 'table' ? (
                // Phones: the table scrolls in its own box (sticky header only matters on wide screens).
                <div className="max-md:overflow-x-auto">
                <table className="w-full border-separate border-spacing-0 text-sm max-md:min-w-[640px]">
                  <thead className="sticky top-16 z-10 bg-paper text-left text-xs text-muted">
                    <tr>
                      {writable && <th className="w-16 border-b border-line py-2 pl-2"><Checkbox label={<span className="sr-only">全选</span>} checked={allSelected} onCheckedChange={v => setSelected(v ? new Set(items.map(c => c.id)) : new Set())} /></th>}
                      <th className="w-20 border-b border-line py-2 font-semibold">封面</th>
                      <th className="border-b border-line py-2 font-semibold">标题</th>
                      <th className="border-b border-line py-2 font-semibold">分类</th>
                      <th className="border-b border-line py-2 font-semibold">状态</th>
                      <th className="border-b border-line py-2 font-semibold">更新</th>
                      <th className="border-b border-line py-2 pr-2 text-right font-semibold">操作</th>
                    </tr>
                  </thead>
                  <tbody>{items.map((c, i) => <CaseRow key={c.id} {...rowProps(c)} priority={i < 12} />)}</tbody>
                </table>
                </div>
              ) : (
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">{items.map((c, i) => <CaseTile key={c.id} {...rowProps(c)} priority={i < 12} />)}</ul>
              )}
            </SortableContext>
          </DndContext>
        )}
      {list.hasNextPage && <div className="mt-4 flex justify-center"><Button loading={list.isFetchingNextPage} loadingText="加载中" onClick={() => void list.fetchNextPage()}>加载更多</Button></div>}

      <Confirm
        open={!!deleting}
        onOpenChange={o => { if (!o) setDeleting(null) }}
        title="删除草稿？"
        description={`「${deleting?.title}」会被永久删除，封面和参考图一并清理，无法撤销。`}
        confirmLabel="删除"
        loadingText="删除中"
        danger
        onConfirm={async () => {
          await adminApi.cases.remove(deleting!.id)
          patchLists(xs => xs.filter(c => c.id !== deleting!.id))
          toast({ title: '已删除草稿', tone: 'success' })
        }}
      />
    </section>
  )
}

type RowProps = { c: AdminCase; writable: boolean; reorderBlocked: string | null; selected: boolean; onToggle: () => void; onStatus: (s: CaseStatus) => void; onDelete: () => void; priority: boolean }

function useRowSortable(id: string) {
  const s = useSortable({ id })
  const style: CSSProperties = { transform: s.transform ? `translate3d(${s.transform.x}px, ${s.transform.y}px, 0)` : undefined, transition: s.transition, position: 'relative', zIndex: s.isDragging ? 5 : undefined }
  return { ...s, style }
}

function Handle({ s, blocked, title }: { s: ReturnType<typeof useRowSortable>; blocked: string | null; title: string }) {
  if (blocked) return <IconButton label={`拖动排序 ${title}`} size="icon-sm" disabled disabledReason={blocked}><GripVertical /></IconButton>
  return (
    <button type="button" aria-label={`拖动排序：${title}`} className={cn('grid size-8 cursor-grab place-items-center rounded-[8px] text-muted hover:bg-subtle active:cursor-grabbing', focusRing)} {...s.attributes} {...s.listeners}>
      <GripVertical />
    </button>
  )
}

function Actions({ c, onStatus, onDelete, writable }: RowProps) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Link to={`/admin/cases/${encodeURIComponent(c.id)}`} className={cn('inline-flex h-8 items-center gap-1.5 rounded-control px-2.5 text-[13px] font-semibold hover:bg-subtle', focusRing)}>
        {writable ? <><Pencil aria-hidden />编辑</> : <><Eye aria-hidden />查看</>}
      </Link>
      {writable && (c.status === 'published'
        ? <IconButton label="隐藏（下架）" size="icon-sm" onClick={() => onStatus('hidden')}><EyeOff /></IconButton>
        : <IconButton label="发布" size="icon-sm" onClick={() => onStatus('published')}><Eye /></IconButton>)}
      {writable && (c.status === 'draft'
        ? <IconButton label="删除草稿" size="icon-sm" variant="danger-ghost" onClick={onDelete}><Trash2 /></IconButton>
        : <IconButton label="删除" size="icon-sm" variant="danger-ghost" disabled disabledReason="发布过的案例不能删除，请用隐藏下架"><Trash2 /></IconButton>)}
    </div>
  )
}

function CaseRow(p: RowProps) {
  const { c, writable, reorderBlocked, selected, onToggle, priority } = p
  const s = useRowSortable(c.id)
  const td = 'border-b border-line py-2 align-middle'
  return (
    <tr ref={s.setNodeRef} style={s.style} data-case-id={c.id} className={cn('bg-paper transition-colors hover:bg-card', s.isDragging && 'bg-card opacity-80 shadow-lg', selected && 'bg-card')}>
      {writable && (
        <td className={cn(td, 'pl-2')}>
          <div className="flex items-center gap-1">
            <Checkbox label={<span className="sr-only">选择 {c.title}</span>} checked={selected} onCheckedChange={onToggle} />
            <Handle s={s} blocked={reorderBlocked} title={c.title} />
          </div>
        </td>
      )}
      <td className={td}><MediaImage asset={c.cover ?? undefined} alt="" className="w-14 rounded-[8px]" priority={priority} hideBadge /></td>
      <td className={cn(td, 'max-w-80 pr-4')}>
        <Link to={`/admin/cases/${encodeURIComponent(c.id)}`} className={cn('block truncate rounded-[4px] font-semibold hover:underline', focusRing)}>{c.title}</Link>
        <span className="text-xs text-muted">#{c.id}{c.template && ` · 套图 ${c.template.items.reduce((n, it) => n + it.count, 0)} 张`}</span>
      </td>
      <td className={cn(td, 'text-muted')}>{c.category_zh ?? c.category}</td>
      <td className={td}><StatusBadge status={c.status} /></td>
      <td className={cn(td, 'text-xs text-muted tabular-nums')}>{fmtTime(c.updated_at)}</td>
      <td className={cn(td, 'pr-2')}><Actions {...p} /></td>
    </tr>
  )
}

function CaseTile(p: RowProps) {
  const { c, writable, reorderBlocked, selected, onToggle, priority } = p
  const s = useRowSortable(c.id)
  return (
    <li ref={s.setNodeRef} style={s.style} data-case-id={c.id} className={cn('overflow-hidden rounded-card border bg-card transition-shadow hover:shadow-md', selected ? 'border-2 border-ink' : 'border-line', s.isDragging && 'opacity-80 shadow-xl')}>
      <div className="relative">
        <MediaImage asset={c.cover ?? undefined} alt="" priority={priority} className="aspect-[4/3]!" hideBadge />
        <span className="absolute left-2 top-2"><StatusBadge status={c.status} /></span>
        {writable && <span className="absolute right-2 top-2 rounded-[8px] bg-card/90"><Handle s={s} blocked={reorderBlocked} title={c.title} /></span>}
      </div>
      <div className="grid gap-1 p-3">
        <div className="flex items-center gap-2">
          {writable && <Checkbox label={<span className="sr-only">选择 {c.title}</span>} checked={selected} onCheckedChange={onToggle} />}
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.title}</span>
        </div>
        <span className="text-xs text-muted">{c.category_zh ?? c.category} · #{c.id}</span>
        <Actions {...p} />
      </div>
    </li>
  )
}

