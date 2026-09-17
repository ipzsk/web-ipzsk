import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, pointerWithin, useDndContext, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { Ban } from 'lucide-react'
import { cn } from './cn'
import { pickUrl, reducedMotion, type MediaAsset } from './types'

export type DragPayload = { items: MediaAsset[] }
export type Accept = (items: MediaAsset[]) => true | string
type DropData = { accept: Accept; onDrop: (items: MediaAsset[]) => void }

/** true when allowed, otherwise the Chinese reason shown to the user. */
export function checkAccept(accept: Accept | undefined, items: MediaAsset[]): true | string {
  if (!items.length) return '没有可放置的内容'
  return accept ? accept(items) : true
}

const payloadOf = (data: unknown) => (data as DragPayload | undefined)?.items ?? []

export function MediaDndProvider({ children }: { children: ReactNode }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const [dragging, setDragging] = useState<MediaAsset[] | null>(null)

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null)
    const target = over?.data.current as DropData | undefined
    const items = payloadOf(active.data.current)
    if (target && checkAccept(target.accept, items) === true) target.onDrop(items)
  }

  return (
    <DndContext
      sensors={sensors}
      // Drop target = what's under the pointer; rect overlap picks neighbours when a large card covers several rows.
      collisionDetection={pointerWithin}
      onDragStart={({ active }: DragStartEvent) => setDragging(payloadOf(active.data.current))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
      accessibility={{ screenReaderInstructions: { draggable: '按住拖动到目标区域；也可以使用「移动到…」菜单' } }}
    >
      {children}
      <DragOverlay dropAnimation={reducedMotion() ? null : { duration: 180, easing: 'cubic-bezier(.2,0,0,1)' }}>
        {dragging && <DragGhost items={dragging} />}
      </DragOverlay>
    </DndContext>
  )
}

function DragGhost({ items }: { items: MediaAsset[] }) {
  const shown = items.slice(0, 3)
  return (
    <div className="pointer-events-none relative size-24 cursor-grabbing">
      {shown.map((a, i) => (
        <div
          key={a.id}
          className="absolute inset-0 overflow-hidden rounded-card border-2 border-card bg-subtle shadow-lg"
          style={{ transform: `translate(${i * 6}px, ${i * -6}px) rotate(${(i - (shown.length - 1) / 2) * 4}deg)`, zIndex: shown.length - i }}
        >
          <img src={a.kind === 'video' ? a.urls.poster ?? '' : pickUrl(a.urls, 'thumb')} alt="" className="h-full w-full object-cover" />
        </div>
      ))}
      {items.length > 1 && (
        <span className="absolute -right-2 -top-4 z-10 min-w-6 rounded-full bg-ink px-1.5 text-center text-xs leading-6 text-white">{items.length}</span>
      )}
    </div>
  )
}

/** Drag source hook for MediaCard (or anything else). */
export function useMediaDraggable(id: string, items: MediaAsset[], disabled?: boolean) {
  return useDraggable({ id, data: { items } satisfies DragPayload, disabled })
}

type DropTargetProps = {
  id: string
  accept?: Accept
  onDrop?: (items: MediaAsset[]) => void
  /** Native OS file drops. Omit to ignore files. */
  onFiles?: (files: File[]) => void
  className?: string
  children: ReactNode
}

export function DropTarget({ id, accept, onDrop, onFiles, className, children }: DropTargetProps) {
  const { active } = useDndContext()
  const [landed, setLanded] = useState(0)
  const flash = () => setLanded(Date.now())
  useEffect(() => {
    if (!landed) return
    const t = setTimeout(() => setLanded(0), 180)
    return () => clearTimeout(t)
  }, [landed])
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { accept: accept ?? (() => true), onDrop: (items) => { flash(); onDrop?.(items) } } satisfies DropData,
  })
  const [fileOver, setFileOver] = useState(false)
  const depth = useRef(0)
  const verdict = active ? checkAccept(accept, payloadOf(active.data.current)) : null

  // Page cursor while hovering an invalid target.
  useEffect(() => {
    if (!isOver || verdict === true || verdict === null) return
    document.body.style.cursor = 'not-allowed'
    return () => { document.body.style.cursor = '' }
  }, [isOver, verdict])

  const hasFiles = (e: DragEvent) => !!onFiles && e.dataTransfer.types.includes('Files')
  const native = onFiles ? {
    onDragEnter: (e: DragEvent) => { if (hasFiles(e)) { depth.current++; setFileOver(true) } },
    onDragOver: (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } },
    onDragLeave: (e: DragEvent) => { if (hasFiles(e) && --depth.current <= 0) { depth.current = 0; setFileOver(false) } },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setFileOver(false)
      flash()
      onFiles(Array.from(e.dataTransfer.files))
    },
  } : {}

  const valid = verdict === true || fileOver
  const invalid = typeof verdict === 'string'

  return (
    <div
      ref={setNodeRef}
      {...native}
      data-drop-state={invalid ? 'invalid' : valid ? 'valid' : undefined}
      aria-dropeffect={valid ? 'copy' : undefined}
      className={cn(
        'relative rounded-card outline-2 outline-offset-2 outline-transparent transition-[outline-color,background-color,opacity] duration-fast',
        valid && 'outline-dashed outline-acid-deep',
        valid && (isOver || fileOver) && 'bg-acid/15',
        invalid && 'cursor-not-allowed opacity-60',
        landed > 0 && 'bg-acid/30',
        className,
      )}
    >
      {children}
      {invalid && isOver && (
        <div role="tooltip" className="pointer-events-none absolute -top-2 left-1/2 z-20 flex -translate-x-1/2 -translate-y-full items-center gap-1 whitespace-nowrap rounded-control bg-ink px-2 py-1 text-xs text-card shadow">
          <Ban size={12} aria-hidden />{verdict}
        </div>
      )}
    </div>
  )
}
