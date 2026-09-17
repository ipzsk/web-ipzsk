import { useState } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMutationState } from '@tanstack/react-query'
import { AlertCircle, ArrowUp, BookmarkPlus, ChevronDown, Copy, GripVertical, Link2, LoaderCircle, Pencil, RotateCw, Trash2, X } from 'lucide-react'
import type { ModelSpec } from '@/shared/contracts'
import { Badge, Button, Dialog, DialogContent, DialogFooter, IconButton, cn } from '@/ui'
import { GENERATION_SUBMIT_KEY, type PendingGeneration } from '../api/generation'
import { QUEUE_MAX, type QueueEntry } from '../api/queue'
import { loadDraft, useComposer } from '../store'
import { diffItem, formatParam } from './logic'
import { retryItem } from './send'

const circled = (i: number) => String.fromCharCode(0x2460 + i)
const Num = ({ i }: { i: number }) => <span aria-label={`第 ${i + 1} 项`} className="mt-px grid size-[18px] shrink-0 place-items-center rounded-full border border-ink text-[11px] font-bold leading-none tabular-nums">{i + 1}</span>

/** item_ids whose submit request is in flight (shared with the composer so they aren't sent twice). */
export function useSubmittingIds() {
  return new Set(useMutationState({
    filters: { mutationKey: GENERATION_SUBMIT_KEY, status: 'pending' },
    select: m => (m.state.variables as PendingGeneration).item_id,
  }))
}

function Row({ item, index, current, models, points, submitting, editing, onRemove, onDuplicate, queue }: {
  item: QueueEntry; index: number; current: QueueEntry; models: Map<string, ModelSpec>; points: number | null | undefined
  submitting: boolean; editing: boolean; onRemove: () => void; onDuplicate: () => void; queue: QueueEntry[]
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.item_id })
  const d = diffItem(item, current)
  const changed = new Map((item.changes ?? []).map(c => [c.name, c]))
  const anchorIndex = item.anchor_of ? queue.findIndex(q => q.item_id === item.anchor_of) : -1
  const B = ({ on, children }: { on: boolean; children: string }) => <span className={on ? 'font-bold text-ink' : 'text-muted'}>{children}</span>
  return (
    <li
      ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group flex items-start gap-1.5 rounded-[10px] px-1.5 py-1.5 text-[13px] hover:bg-subtle',
        isDragging && 'z-10 bg-card opacity-60 shadow-lg', editing && 'bg-acid/25 hover:bg-acid/30',
        (item.state === 'failed' || item.missing) && 'bg-danger/5 hover:bg-danger/8',
      )}
    >
      <button type="button" {...attributes} {...listeners} aria-label={`拖动排序第 ${index + 1} 项`} className="mt-0.5 grid size-5 shrink-0 cursor-grab place-items-center rounded-[4px] text-muted outline-none focus-visible:outline-2 focus-visible:outline-ink active:cursor-grabbing max-md:hidden">
        <GripVertical className="size-3.5" />
      </button>
      <Num i={index} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <B on={d.model}>{models.get(item.model)?.name ?? item.model}</B>
          {Object.entries(item.params).map(([k, v]) => {
            const c = changed.get(k)
            return c
              ? <span key={k} title="该型号不支持原取值，已改为默认值" className="rounded-[4px] bg-acid px-1 font-bold text-ink">{formatParam(k, c.from)}→{formatParam(k, c.to)}</span>
              : item.state === 'failed' && item.error?.field === k
                ? <span key={k} className="contents">· <span data-field-error={k} title={item.error.message} className="rounded-[4px] px-1 font-bold text-danger ring-1 ring-danger">{formatParam(k, v)}</span></span>
                : <span key={k} className="contents">· <B on={d.params.has(k)}>{formatParam(k, v)}</B></span>
          })}
          {item.reference_asset_ids.length > 0 && <>· <B on={d.references}>{`${item.reference_asset_ids.length} 张参考图`}</B></>}
          {anchorIndex >= 0 && <Badge tone="outline" className="h-5 px-1.5"><Link2 className="size-3" />引用{circled(anchorIndex)}</Badge>}
          {points != null && <span className="ml-auto pl-2 text-xs text-muted tabular-nums">约 {points} 点</span>}
        </div>
        {d.prompt && <p className="mt-0.5 line-clamp-2 text-muted" title={item.prompt}>{item.prompt || '（无提示词）'}</p>}
        {item.missing && !submitting ? <p role="alert" className="mt-0.5 flex items-center gap-1 text-xs text-danger"><AlertCircle className="size-3" />素材已删除 · 编辑移除失效的参考图后再发送</p>
          : submitting ? <p className="mt-0.5 flex items-center gap-1 text-xs text-muted"><LoaderCircle className="size-3 motion-safe:animate-spin" />提交中</p>
          : item.state === 'failed' ? <p role="alert" className="mt-0.5 flex items-center gap-1 text-xs text-danger"><AlertCircle className="size-3" />{(item.error?.message ?? '提交失败').replace(/。$/, '')}{item.error?.field && !(item.error.field in item.params) ? `（${item.error.field}）` : ''} · 编辑后重新发送</p>
          : item.state === 'retryable' ? <p className="mt-0.5 flex items-center gap-1 text-xs text-warning"><AlertCircle className="size-3" />{item.error?.message ?? '网络异常'} · <button type="button" className="inline-flex items-center gap-0.5 font-semibold underline-offset-2 hover:underline" onClick={() => void retryItem(item.item_id)}><RotateCw className="size-3" />重试</button></p>
          : item.state === 'waiting' ? <p className="mt-0.5 flex items-center gap-1 text-xs text-muted"><LoaderCircle className="size-3 motion-safe:animate-spin" />等待锚图生成完成</p>
          : item.state === 'cancelled' ? <p className="mt-0.5 text-xs text-danger">已取消 · {item.error?.message ?? '锚图失败'}，未扣点</p>
          : null}
      </div>
      <div className="flex shrink-0 items-center opacity-70 group-hover:opacity-100 group-focus-within:opacity-100">
        <IconButton size="icon-sm" label="编辑" disabled={submitting} disabledReason="提交中，无法编辑" onClick={() => loadDraft({
          kind: item.kind, model: item.model, params: item.params, doc: item.prompt_doc, slots: item.slots, editingId: item.item_id,
        })}><Pencil className="size-3.5" /></IconButton>
        <IconButton size="icon-sm" label="复制一项" disabled={queue.length >= QUEUE_MAX} disabledReason={`队列最多 ${QUEUE_MAX} 项`} onClick={onDuplicate}><Copy className="size-3.5" /></IconButton>
        <IconButton size="icon-sm" label="移除" disabled={submitting} disabledReason="提交中，无法移除" onClick={onRemove}><X className="size-3.5" /></IconButton>
      </div>
    </li>
  )
}

export function QueueBar({ current, models, pointsById, total, onSendAll, sendReason, sending }: {
  current: QueueEntry; models: Map<string, ModelSpec>; pointsById: Map<string, number | null>; total: number | null
  onSendAll: () => void; sendReason: string | null; sending: boolean
}) {
  const queue = useComposer(s => s.queue)
  const editingId = useComposer(s => s.editingId)
  const submitting = useSubmittingIds()
  const [collapsed, setCollapsed] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  if (!queue.length) return null

  const set = (fn: (q: QueueEntry[]) => QueueEntry[]) => useComposer.setState(s => ({ queue: fn(s.queue) }))
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    set(q => arrayMove(q, q.findIndex(i => i.item_id === active.id), q.findIndex(i => i.item_id === over.id)))
  }

  return (
    <section aria-label="待发送队列" className="mb-2 rounded-card border border-line bg-card/95 shadow-lg backdrop-blur-md">
      <header className="flex items-center gap-2 px-3 py-2">
        <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed(c => !c)} className="flex cursor-pointer items-center gap-1.5 rounded-control text-[13px] font-semibold outline-none focus-visible:outline-2 focus-visible:outline-ink">
          <ChevronDown className={cn('size-4 transition-transform duration-(--duration-fast)', collapsed && '-rotate-90')} />
          待发送队列 · {queue.length} 项{total != null && <span className="font-normal text-muted"> · 约 {total} 点</span>}
        </button>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" icon={<BookmarkPlus className="size-4" />} onClick={() => setTemplateOpen(true)} className="max-md:hidden">存为模板</Button>
        <Button size="sm" variant="danger-ghost" icon={<Trash2 className="size-4" />} onClick={() => setConfirmClear(true)}>清空</Button>
        <Button size="sm" variant="primary" icon={<ArrowUp className="size-4" />} loading={sending} disabled={!!sendReason} disabledReason={sendReason ?? undefined} onClick={onSendAll}>全部发送</Button>
      </header>
      {!collapsed && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ screenReaderInstructions: { draggable: '按空格拿起，用上下方向键移动，再按空格放下' } }}>
          <SortableContext items={queue.map(i => i.item_id)} strategy={verticalListSortingStrategy}>
            <ol className="grid max-h-56 gap-0.5 overflow-y-auto px-1.5 pb-2">
              {queue.map((item, i) => (
                <Row
                  key={item.item_id} item={item} index={i} current={current} models={models} queue={queue}
                  points={pointsById.get(item.item_id)} submitting={submitting.has(item.item_id)} editing={editingId === item.item_id}
                  onRemove={() => set(q => q.filter(x => x.item_id !== item.item_id))}
                  onDuplicate={() => set(q => { const at = q.indexOf(item); return [...q.slice(0, at + 1), { ...item, item_id: crypto.randomUUID(), state: undefined, error: undefined, changes: undefined }, ...q.slice(at + 1)] })}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent title="存为模板" description={`把这 ${queue.length} 项存成可复用的模板。模板库将在 F6 提供，暂时还不能保存。`}>
          <DialogFooter><Button variant="primary" onClick={() => setTemplateOpen(false)}>知道了</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent title="清空队列？" description={`将移除全部 ${queue.length} 项，输入框内容不受影响。`}>
          <DialogFooter>
            <Button onClick={() => setConfirmClear(false)}>取消</Button>
            <Button variant="danger" onClick={() => { set(q => q.filter(i => submitting.has(i.item_id))); setConfirmClear(false) }}>清空</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
