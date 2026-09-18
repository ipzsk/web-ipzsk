import { useState } from 'react'
import { ChevronDown, Dices, Gauge, Images, Layers, ListPlus, RectangleHorizontal, RotateCw, SlidersHorizontal, Sparkles, Timer, Volume2, Wand2, type LucideIcon } from 'lucide-react'
import type { GenerationParams, ModelSpec, ParamSpec } from '@/shared/contracts'
import { Button, Checkbox, DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger, IconButton, Input, Popover, PopoverContent, PopoverTrigger, SegmentedControl, Skeleton, Tooltip, cn } from '@/ui'
import { useQuery } from '@tanstack/react-query'
import { quote } from '../api/catalog'
import type { ParamInput } from '../api/queue'
import { quoteQueryKey } from './hooks'
import { boolValues, controlOf, defaultParams, formatParam, isOn, modelPriceLabel, optionsOf, paramLabel, unitLabel, visibleParams } from './logic'

const ICONS: Record<string, LucideIcon> = {
  aspect_ratio: RectangleHorizontal, resolution: Gauge, n: Layers, duration: Timer,
  quality: Sparkles, seed: Dices, sound: Volume2, generate_audio: Volume2, enhance_prompt: Wand2,
}

export function ModelPicker({ models, model, status, signedIn, onRetry, onPick, onAddMany, roomFor }: {
  models: ModelSpec[]
  signedIn: boolean
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
  // One batched quote of every listed model at its default params, fetched when the picker opens; cached like the composer quote.
  const entries = models.map(m => ({ kind: m.kind, model: m.id, params: defaultParams(m), reference_asset_ids: [] }))
  const prices = useQuery({ queryKey: quoteQueryKey(entries), queryFn: ({ signal }) => quote(entries, signal), enabled: signedIn && open && entries.length > 0, staleTime: 10 * 60_000 })
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
            const refs = m.references?.maxImages ?? 0
            const hasDuration = m.params.some(p => p.field === 'duration')
            return (
              <li key={m.id} className={cn('flex items-start gap-2 rounded-[10px] p-2 hover:bg-subtle', m.id === model?.id && 'bg-subtle')}>
                <Checkbox
                  label={<span className="sr-only">多选 {m.name}</span>}
                  checked={picked.includes(m.id)}
                  onCheckedChange={c => setPicked(p => c ? [...p, m.id] : p.filter(x => x !== m.id))}
                  className="mt-0.5"
                />
                <button type="button" className="grid min-w-0 flex-1 cursor-pointer gap-1 rounded-[6px] text-left outline-none focus-visible:outline-2 focus-visible:outline-acid-deep" aria-current={m.id === model?.id || undefined} onClick={() => { onPick(m); setOpen(false) }}>
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold">{m.name}</span>
                    {signedIn && prices.isPending
                      ? <Skeleton className="ml-auto h-3.5 w-16 shrink-0" />
                      : <span className="ml-auto shrink-0 text-xs text-muted tabular-nums">{prices.data ? modelPriceLabel(m, prices.data[models.indexOf(m)]?.points) : unitLabel(m.billing?.unit)}</span>}
                  </span>
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

/** Params that earn a chip in the composer row; everything else the model advertises goes behind 「更多参数」. */
const PRIMARY = ['aspect_ratio', 'resolution', 'quality', 'n', 'duration']

type ParamProps = { model: ModelSpec; spec: ParamSpec; value: ParamInput; onChange: (v: ParamInput) => void }

/** Enum chip: icon + current value, dropdown of the catalog's values (disabled when the model offers only one). */
function EnumChip({ model, spec, value, onChange, highlighted }: ParamProps & { highlighted?: boolean }) {
  const Icon = ICONS[spec.field] ?? SlidersHorizontal
  const label = paramLabel(spec.field)
  const options = optionsOf(spec)
  const chip = (
    <Button
      size="sm" variant="ghost" aria-label={`${label}：${formatParam(spec.field, value)}`}
      disabled={options.length < 2} disabledReason={`${model.name} 的${label}只有 ${formatParam(spec.field, value)}`}
      className={cn('gap-1 px-2 tabular-nums transition-[background-color,box-shadow] duration-(--duration-base)', highlighted && 'bg-acid-soft text-label ring-2 ring-acid hover:bg-acid-soft')}
    >
      <Icon className="size-4" />{formatParam(spec.field, value)}
    </Button>
  )
  if (options.length < 2) return chip
  return (
    <DropdownMenu>
      <Tooltip content={label}><DropdownMenuTrigger asChild>{chip}</DropdownMenuTrigger></Tooltip>
      <DropdownMenuContent side="top" align="start" className="max-h-72 overflow-y-auto">
        {options.map(o => (
          <DropdownMenuCheckboxItem key={String(o)} checked={o === value} onSelect={() => onChange(o)}>{formatParam(spec.field, o)}</DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** One 「更多参数」 row: label on the left, the control for this param's type on the right. */
function ParamRow(p: ParamProps) {
  const { spec, value, onChange } = p
  const label = paramLabel(spec.field)
  const control = () => {
    switch (controlOf(spec)) {
      case 'boolean': {
        const [on, off] = boolValues(spec)
        return <SegmentedControl<'on' | 'off'> label={label} value={isOn(value) ? 'on' : 'off'} options={[{ value: 'off', label: '关' }, { value: 'on', label: '开' }]}
          onValueChange={v => onChange(v === 'on' ? on : off)} />
      }
      case 'enum':
        return <EnumChip {...p} />
      case 'number':
        return (
          <span className="flex items-center gap-1">
            <Input
              type="number" step={1} inputMode="numeric" aria-label={label} className="h-9 w-28 tabular-nums"
              placeholder={spec.field === 'seed' ? '随机' : '默认'}
              value={value == null ? '' : String(value)}
              onChange={e => { const v = e.target.value.trim(); onChange(v === '' ? undefined : Math.trunc(Number(v))) }}
            />
            {spec.field === 'seed' && <IconButton label="随机种子" size="icon-sm" onClick={() => onChange(Math.floor(Math.random() * 2 ** 31))}><Dices className="size-4" /></IconButton>}
          </span>
        )
      default: // unknown type → a plain text field, so the param still reaches the API
        return <Input aria-label={label} className="h-9 w-36" placeholder="默认" value={value == null ? '' : String(value)}
          onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)} />
    }
  }
  return (
    <div className="flex min-h-9 items-center justify-between gap-3">
      <span className="text-[13px] font-semibold">{label}</span>
      {control()}
    </div>
  )
}

export function ParamChips({ model, params, highlight, onChange }: {
  model: ModelSpec; params: GenerationParams; highlight: Set<string>; onChange: (name: string, v: ParamInput) => void
}) {
  const specs = visibleParams(model)
  // Only enums are compact enough to be a chip; switches, steppers and text fields always live in the popover.
  const chips = specs.filter(s => PRIMARY.includes(s.field) && controlOf(s) === 'enum')
  const rest = specs.filter(s => !chips.includes(s))
  return (
    <>
      {chips.map(spec => (
        <EnumChip key={spec.field} model={model} spec={spec} value={params[spec.field]} highlighted={highlight.has(spec.field)} onChange={v => onChange(spec.field, v)} />
      ))}
      {rest.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="ghost" className={cn('gap-1 px-2', rest.some(s => highlight.has(s.field)) && 'bg-acid-soft text-label ring-2 ring-acid hover:bg-acid-soft')}>
              <SlidersHorizontal className="size-4" />更多参数
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="grid w-[min(20rem,calc(100vw-2rem))] gap-2 p-3">
            {rest.map(spec => <ParamRow key={spec.field} model={model} spec={spec} value={params[spec.field]} onChange={v => onChange(spec.field, v)} />)}
          </PopoverContent>
        </Popover>
      )}
    </>
  )
}
