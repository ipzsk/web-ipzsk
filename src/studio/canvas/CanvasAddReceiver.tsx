/**
 * Receiver for `ipzsk:canvas-add` (detail shapes documented in ./canvasAdd.ts).
 *
 * Integration: App.tsx's Layout should call it once and render the result:
 *   const canvasAdd = useCanvasAddListener()
 *   return <>…{canvasAdd}</>
 * CanvasView also calls it, so 放到画布 works while the canvas is open even before that wiring lands.
 * When several instances are mounted only the first one handles events (no duplicate dialogs).
 */
import { useEffect, useId, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import { LayoutDashboard, Plus } from 'lucide-react'
import { Button, Dialog, DialogContent, Skeleton, cn, focusRing, toast } from '@/ui'
import { CANVAS_ADD_EVENT, onStudioEvent, type CanvasAddDetail } from '@/shared/events'
import { canvasRepo } from './repo'
import { addToOpenCanvas, addToProject } from './store'
import { ago } from './ProjectList'

const useInbox = create<{ owners: string[]; pending: CanvasAddDetail | null }>(() => ({ owners: [], pending: null }))

const LABEL: Record<CanvasAddDetail['source'], (d: any) => string> = {
  asset: d => `${d.assets.length} 个素材`,
  record: () => '生成记录（提示词 + 结果）',
  case: () => '案例图与提示词',
}

function PickDialog({ pending }: { pending: CanvasAddDetail }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const q = useQuery({ queryKey: ['canvas', 'projects'], queryFn: () => canvasRepo.list(), networkMode: 'always' })
  const close = () => useInbox.setState({ pending: null })

  const choose = async (target: string | 'new') => {
    setBusy(target)
    try {
      const id = target === 'new' ? (await canvasRepo.create()).id : target
      const title = await addToProject(id, pending)
      close()
      void qc.invalidateQueries({ queryKey: ['canvas', 'projects'] })
      toast({ title: `已放到「${title}」`, tone: 'success', action: { label: '打开', onClick: () => navigate(`/studio/canvas/${id}`) } })
    } catch {
      toast({ title: '没有放到画布', description: '浏览器存储不可用，请重试', tone: 'error' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o && !busy) close() }}>
      <DialogContent title="放到哪个画布" description={`将添加：${LABEL[pending.source](pending)}`}>
        <ul className="-mx-2 max-h-72 overflow-y-auto">
          {q.isPending && Array.from({ length: 3 }, (_, i) => <li key={i} className="px-2 py-1.5"><Skeleton className="h-11 rounded-control" /></li>)}
          {q.data?.slice(0, 8).map(p => (
            <li key={p.id}>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void choose(p.id)}
                className={cn('flex w-full items-center gap-3 rounded-control px-2 py-2 text-left hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-45', focusRing)}
              >
                <LayoutDashboard className="size-[18px] shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{p.title}</span>
                  <span className="block text-xs text-muted">{ago(p.updated_at)}更新 · {p.preview.length} 个节点</span>
                </span>
              </button>
            </li>
          ))}
          {q.data?.length === 0 && <li className="px-2 py-3 text-sm text-muted">还没有画布，新建一个吧</li>}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={close} disabled={!!busy}>取消</Button>
          <Button variant="primary" icon={<Plus className="size-4" />} loading={busy === 'new'} disabled={!!busy && busy !== 'new'} onClick={() => void choose('new')}>新建画布</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function useCanvasAddListener(): ReactNode {
  const me = useId()
  const owner = useInbox(s => s.owners[0] === me)
  const pending = useInbox(s => s.pending)

  useEffect(() => {
    useInbox.setState(s => ({ owners: [...s.owners, me] }))
    return () => useInbox.setState(s => ({ owners: s.owners.filter(o => o !== me) }))
  }, [me])

  useEffect(() => {
    if (!owner) return
    return onStudioEvent(
      CANVAS_ADD_EVENT,
      d => { if (!addToOpenCanvas(d)) useInbox.setState({ pending: d }) },
      () => toast({ title: '没有放到画布', description: '内容格式无法识别，请刷新页面后重试', tone: 'error' }),
    )
  }, [owner])

  return owner && pending ? <PickDialog pending={pending} /> : null
}
