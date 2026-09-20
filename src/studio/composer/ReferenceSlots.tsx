import { useRef } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlertCircle, Plus, RotateCw, X } from 'lucide-react'
import { IconButton, cn } from '@/ui'
import { MediaImage, type UploadController } from '@/media'
import type { RefSlot } from '../api/queue'
import { useComposer } from '../store'
import type { ReferenceState } from './logic'

const ACCEPT = 'image/png,image/jpeg,image/webp'

function Slot({ slot, index, dim, warn }: { slot: RefSlot; index: number; dim: boolean; warn: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slot.asset.id })
  const remove = () => useComposer.setState(s => ({ slots: s.slots.filter(x => x.asset.id !== slot.asset.id) }))
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('group relative size-14 shrink-0', isDragging && 'z-10 opacity-50')}
    >
      <div
        {...attributes} {...listeners}
        aria-label={`图${index + 1}，按空格后用方向键排序`}
        onKeyDown={e => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove() } else listeners?.onKeyDown?.(e) }}
        className={cn(
          'size-full cursor-grab overflow-hidden rounded-[10px] border border-line bg-subtle outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acid-deep active:cursor-grabbing',
          dim && 'opacity-45', warn && 'border-warning ring-2 ring-warning/40',
        )}
      >
        <MediaImage asset={slot.asset} alt={`图${index + 1}`} hideBadge className="size-full" />
      </div>
      <span className="pointer-events-none absolute bottom-0.5 left-0.5 rounded-[4px] bg-ink/70 px-1 text-[10px] leading-4 text-card">图{index + 1}</span>
      <IconButton
        label={`移除图${index + 1}`} size="icon-sm" variant="primary" onClick={remove}
        className="absolute -right-1.5 -top-1.5 size-5 rounded-full opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
      ><X className="size-3" /></IconButton>
    </li>
  )
}

export function ReferenceSlots({ refs, upload, onFiles }: { refs: ReferenceState; upload: UploadController; onFiles: (files: File[]) => void }) {
  const slots = useComposer(s => s.slots)
  const input = useRef<HTMLInputElement>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const pending = upload.items.filter(u => u.status !== 'done')
  const full = slots.length + pending.length >= refs.max

  if (!slots.length && !pending.length && !refs.supported) return null

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    useComposer.setState(s => {
      const from = s.slots.findIndex(x => x.asset.id === active.id)
      const to = s.slots.findIndex(x => x.asset.id === over.id)
      return { slots: arrayMove(s.slots, from, to) }
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-1 pb-2 pt-1.5">
      {/* DndContext outside the <ul>: its live region (role=status) may not be a list child. */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ screenReaderInstructions: { draggable: '按空格拿起，用左右方向键移动，再按空格放下；Delete 移除' } }}>
      <ul aria-label="参考图" className="flex flex-wrap items-center gap-2">
          <SortableContext items={slots.map(s => s.asset.id)} strategy={horizontalListSortingStrategy}>
            {slots.map((s, i) => <Slot key={s.asset.id} slot={s} index={i} dim={!refs.supported} warn={refs.over && i >= refs.max} />)}
          </SortableContext>
        {pending.map(u => (
          <li key={u.clientId} className="relative size-14 shrink-0 overflow-hidden rounded-[10px] border border-line bg-subtle">
            {u.previewUrl && <MediaImage urls={{ orig: u.previewUrl }} alt={u.name} hideBadge className="size-full opacity-60" />}
            <div className="absolute inset-0 grid place-items-center text-[11px] font-semibold">
              {u.status === 'failed' || u.status === 'interrupted'
                ? <IconButton label={`${u.error ?? '上传失败'} · 重试`} size="icon-sm" variant="secondary" onClick={() => u.file ? upload.retry(u.clientId) : upload.remove(u.clientId)}>
                    {u.file ? <RotateCw className="size-3.5 text-danger" /> : <AlertCircle className="size-3.5 text-danger" />}
                  </IconButton>
                : <span role="progressbar" aria-label={`${u.name} 上传进度`} aria-valuenow={Math.round(u.progress * 100)}>{u.status === 'processing' ? '处理中' : `${Math.round(u.progress * 100)}%`}</span>}
            </div>
            <IconButton label={u.status === 'failed' ? '移除' : '取消上传'} size="icon-sm" variant="primary" onClick={() => upload.remove(u.clientId)} className="absolute right-0.5 top-0.5 size-5 rounded-full"><X className="size-3" /></IconButton>
          </li>
        ))}
      </ul>
      </DndContext>
      {refs.supported && (
        <>
          <IconButton
            label="添加参考图（也可粘贴或拖入）" variant="secondary" className="size-14 rounded-[10px] border-dashed border-acid/30 bg-acid-soft/50 text-label hover:border-acid hover:bg-acid-soft"
            disabled={full} disabledReason={`最多 ${refs.max} 张参考图`}
            onClick={() => input.current?.click()}
          ><Plus className="size-5" /></IconButton>
          <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={e => { onFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
        </>
      )}
      {refs.message && (
        <p role="status" className={cn('flex items-center gap-1 text-xs', refs.over ? 'text-warning' : 'text-muted')}>
          <AlertCircle className="size-3.5" />{refs.message}
        </p>
      )}
    </div>
  )
}
