import { useState } from 'react'
import { ChevronDown, Gauge, Images, Layers, ListPlus, RectangleHorizontal, RotateCw, SlidersHorizontal, Timer, type LucideIcon } from 'lucide-react'
import type { GenerationParams, ModelSpec } from '@/shared/contracts'
import { Button, Checkbox, DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger, Popover, PopoverContent, PopoverTrigger, Skeleton, Tooltip, cn } from '@/ui'
import { formatParam, optionsOf, visibleParams } from './logic'

const ICONS: Record<string, LucideIcon> = { aspect_ratio: RectangleHorizontal, resolution: Gauge, n: Layers, duration: Timer }
const LABELS: Record<string, string> = { aspect_ratio: '比例', resolution: '清晰度', n: '张数', duration: '时长' }

export function ModelPicker({ models, model, status, onRetry, onPick, onAddMany, roomFor }: {
  models: ModelSpec[]
  model: ModelSpec | undefined
  status: 'pending' | 'error' | 'success' | 'signedOut'
  onRetry: () => void
  onPick: (m: ModelSpec) => void
  onAddMany: (ms: ModelSpec[]) => void
  /** Reason when N more items don't fit into the queue. */
  roomFor: (n: number) => string | null
}) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  if (status === 'pending') return <Skeleton className="h-8 w-32" />
  if (status === 'signedOut') return <span className="px-2 text-[13px] text-muted">登录后选择型号</span>
  if (status === 'error') return <Button size="sm" variant="danger-ghost" icon={<RotateCw className="size-4" />} onClick={onRetry}>型号加载失败 · 重试</Button>

  const chosen = models.filter(m => picked.includes(m.id))
  const room = roomFor(chosen.length)
  const addReason = chosen.length < 2 ? '勾选至少 2 个型号' : room
  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setPicked([]) }}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={`型号：${model?.name ?? '未选择'}`} className="max-w-48 px-2">
          <span className="truncate">{model?.name ?? '选择型号'}</span><ChevronDown className="size-4 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 p-1">
        <ul role="list" aria-label="型号" className="grid max-h-80 gap-0.5 overflow-y-auto">
          {models.map(m => {
            const refs = m.references?.max ?? 0
            const hasDuration = m.params.some(p => p.name === 'duration')
            return (
              <li key={m.id} className={cn('flex items-start gap-2 rounded-[10px] p-2 hover:bg-subtle', m.id === model?.id && 'bg-subtle')}>
                <Checkbox
                  label={<span className="sr-only">多选 {m.name}</span>}
                  checked={picked.includes(m.id)}
                  onCheckedChange={c => setPicked(p => c ? [...p, m.id] : p.filter(x => x !== m.id))}
                  className="mt-0.5"
                />
                <button type="button" className="grid min-w-0 flex-1 cursor-pointer gap-1 rounded-[6px] text-left outline-none focus-visible:outline-2 focus-visible:outline-ink" aria-current={m.id === model?.id || undefined} onClick={() => { onPick(m); setOpen(false) }}>
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold">{m.name}</span>
                    {m.billing_unit && <span className="ml-auto shrink-0 text-xs text-muted">{m.billing_unit}</span>}
                  </span>
                  {m.description && <span className="text-xs text-muted">{m.description}</span>}
                  <span className="flex flex-wrap gap-1">
                    {refs > 0 && <Tag icon={Images}>{`参考图 ≤${refs}`}</Tag>}
                    {hasDuration && <Tag icon={Timer}>时长</Tag>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <div className="flex items-center gap-2 border-t border-line p-2">
          <span className="flex-1 text-xs text-muted">{chosen.length ? `已选 ${chosen.length} 个型号` : '勾选多个型号可一次加入队列'}</span>
          <Button size="sm" variant="primary" icon={<ListPlus className="size-4" />} disabled={!!addReason} disabledReason={addReason ?? undefined}
            onClick={() => { onAddMany(chosen); setOpen(false); setPicked([]) }}>
            加入队列{chosen.length >= 2 ? ` (${chosen.length})` : ''}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

const Tag = ({ icon: Icon, children }: { icon: LucideIcon; children: string }) =>
  <span className="inline-flex h-5 items-center gap-1 rounded-full border border-line px-1.5 text-[11px] text-muted"><Icon className="size-3" />{children}</span>

export function ParamChips({ model, params, highlight, onChange }: {
  model: ModelSpec; params: GenerationParams; highlight: Set<string>; onChange: (name: string, v: GenerationParams[string]) => void
}) {
  return (
    <>
      {visibleParams(model).map(spec => {
        const Icon = ICONS[spec.name] ?? SlidersHorizontal
        const label = spec.label ?? LABELS[spec.name] ?? spec.name
        const options = optionsOf(spec)
        const value = params[spec.name]!
        const chip = (
          <Button
            size="sm" variant="ghost" aria-label={`${label}：${formatParam(spec.name, value)}`}
            disabled={options.length < 2} disabledReason={`${model.name} 的${label}只有 ${formatParam(spec.name, value)}`}
            className={cn('gap-1 px-2 tabular-nums transition-[background-color,box-shadow] duration-(--duration-base)', highlight.has(spec.name) && 'bg-acid ring-2 ring-acid-deep hover:bg-acid')}
          >
            <Icon className="size-4" />{formatParam(spec.name, value)}
          </Button>
        )
        if (options.length < 2) return <span key={spec.name}>{chip}</span>
        return (
          <DropdownMenu key={spec.name}>
            <Tooltip content={label}><DropdownMenuTrigger asChild>{chip}</DropdownMenuTrigger></Tooltip>
            <DropdownMenuContent side="top" align="start" className="max-h-72 overflow-y-auto">
              {options.map(o => (
                <DropdownMenuCheckboxItem key={String(o)} checked={o === value} onSelect={() => onChange(spec.name, o)}>{formatParam(spec.name, o)}</DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      })}
    </>
  )
}
