import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Ellipsis, LayoutDashboard, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, ErrorState, IconButton, Skeleton, cn, focusRing, toast,
} from '@/ui'
import { canvasRepo, type CanvasProjectMeta } from './repo'

const KEY = ['canvas', 'projects']
const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })
export function ago(iso: string) {
  const s = (new Date(iso).getTime() - Date.now()) / 1000
  if (s > -60) return '刚刚'
  if (s > -3600) return rtf.format(Math.round(s / 60), 'minute')
  if (s > -86400) return rtf.format(Math.round(s / 3600), 'hour')
  if (s > -86400 * 30) return rtf.format(Math.round(s / 86400), 'day')
  return new Date(iso).toLocaleDateString('zh-CN')
}

const FILL: Record<string, string> = { text: 'var(--color-subtle)', image: 'color-mix(in srgb, var(--color-acid-deep) 33%, transparent)', video: 'color-mix(in srgb, var(--color-warning) 20%, transparent)', 'gen-image': 'var(--color-acid)', 'gen-video': 'var(--color-acid)' }

/** Local thumbnail: node bounding boxes. TODO: server thumb_id once §8.6 sync exists. */
function Thumb({ boxes }: { boxes: CanvasProjectMeta['preview'] }) {
  if (!boxes.length) return <div className="grid h-full place-items-center text-muted"><LayoutDashboard className="size-8" aria-hidden /></div>
  const x0 = Math.min(...boxes.map(b => b.x)), y0 = Math.min(...boxes.map(b => b.y))
  const x1 = Math.max(...boxes.map(b => b.x + b.w)), y1 = Math.max(...boxes.map(b => b.y + b.h))
  const pad = Math.max(x1 - x0, y1 - y0) * 0.08
  return (
    <svg aria-hidden viewBox={`${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full">
      {boxes.map((b, i) => b.kind === 'group'
        ? <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx={16} fill="none" style={{ stroke: 'var(--color-muted)' }} strokeDasharray="12 8" strokeWidth={3} vectorEffect="non-scaling-stroke" />
        : <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx={12} style={{ fill: FILL[b.kind], stroke: 'var(--color-ink)' }} strokeOpacity={0.25} vectorEffect="non-scaling-stroke" />)}
    </svg>
  )
}

function Card({ p }: { p: CanvasProjectMeta }) {
  const qc = useQueryClient()
  const [renaming, setRenaming] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: KEY })

  const rename = async (title: string) => {
    setRenaming(false)
    if (title.trim() === p.title || !title.trim()) return
    qc.setQueryData<CanvasProjectMeta[]>(KEY, xs => xs?.map(x => (x.id === p.id ? { ...x, title: title.trim() } : x)))
    try { await canvasRepo.rename(p.id, title) } catch { toast({ title: '重命名失败', tone: 'error' }) }
    void refresh()
  }
  const remove = async () => {
    const prev = qc.getQueryData<CanvasProjectMeta[]>(KEY)
    qc.setQueryData<CanvasProjectMeta[]>(KEY, xs => xs?.filter(x => x.id !== p.id))
    const snap = await canvasRepo.remove(p.id).catch(() => null)
    if (!snap) { qc.setQueryData(KEY, prev); toast({ title: '删除失败', description: '请刷新后重试', tone: 'error' }); return }
    toast({
      title: `已删除「${p.title}」`, duration: 5000,
      action: { label: '撤销', onClick: () => void canvasRepo.restore(snap).then(refresh) },
    })
  }
  const dup = async () => {
    const m = await canvasRepo.duplicate(p.id)
    if (m) toast({ title: `已复制为「${m.title}」`, tone: 'success' })
    void refresh()
  }

  return (
    <article className="group relative overflow-hidden rounded-card border border-line bg-card transition-[box-shadow,transform,border-color] duration-(--duration-fast) hover:-translate-y-px hover:border-muted hover:shadow-md motion-reduce:hover:translate-y-0">
      <Link to={`/studio/canvas/${p.id}`} className={cn('block', focusRing, 'focus-visible:outline-offset-[-2px] rounded-card')} aria-label={`打开画布「${p.title}」`}>
        <div className="aspect-[16/10] border-b border-line bg-paper p-3"><Thumb boxes={p.preview} /></div>
      </Link>
      <div className="flex items-center gap-2 p-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              aria-label="画布名称"
              defaultValue={p.title}
              maxLength={80}
              className="h-7 w-full rounded-[8px] border border-ink bg-card px-2 text-sm font-semibold outline-none"
              onBlur={e => void rename(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(false) }}
            />
          ) : (
            <h2 className="truncate text-sm font-semibold" onDoubleClick={() => setRenaming(true)} title="双击重命名">{p.title}</h2>
          )}
          <p className="mt-0.5 text-xs text-muted">{ago(p.updated_at)}更新 · {p.preview.length} 个节点</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton size="icon-sm" label="更多操作"><Ellipsis /></IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setRenaming(true)}><Pencil />重命名</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void dup()}><Copy />复制一份</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger onSelect={() => void remove()}><Trash2 />删除</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  )
}

export function ProjectList() {
  const navigate = useNavigate()
  const q = useQuery({ queryKey: KEY, queryFn: () => canvasRepo.list(), networkMode: 'always', refetchOnMount: 'always' })
  const create = useMutation({
    mutationFn: () => canvasRepo.create(),
    onSuccess: m => navigate(`/studio/canvas/${m.id}`),
    onError: () => toast({ title: '新建失败', description: '浏览器存储不可用', tone: 'error' }),
    networkMode: 'always',
  })
  return (
    <section>
      <div className="flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold">画布</h1>
        <Button variant="primary" icon={<Plus className="size-[18px]" />} loading={create.isPending} onClick={() => create.mutate()}>新建画布</Button>
      </div>
      <p className="mt-1 text-sm text-muted">适合多步创作：参考图 → 生成 → 挑选 → 转视频，每一步来源可追溯。先存本机，联网后自动同步。</p>
      <div className="mt-6">
        {q.isPending ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="aspect-[16/13] rounded-card" />)}
          </div>
        ) : q.isError ? (
          <ErrorState reason="读取本地画布失败，浏览器存储可能不可用" action={{ label: '重试', onClick: () => void q.refetch() }} />
        ) : !q.data.length ? (
          <div className="rounded-panel border border-dashed border-line">
            <EmptyState icon={LayoutDashboard} illustration="board" text="还没有画布" action={{ label: '新建画布', onClick: () => create.mutate() }} />
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {q.data.map(p => <Card key={p.id} p={p} />)}
          </div>
        )}
      </div>
    </section>
  )
}
