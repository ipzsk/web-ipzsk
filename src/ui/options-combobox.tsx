import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Popover as P } from 'radix-ui'
import { Check, Search, X } from 'lucide-react'
import { cn } from './cn'
import { focusRing } from './button'
import { Tooltip } from './tooltip'

export interface ComboOption {
  value: string
  label: string
  count?: number
  /** Action row (e.g. a recent search): Enter/click calls onPick instead of toggling selection. */
  action?: boolean
  /** Removable row: Delete key or the × (mouse) calls this. */
  onRemove?: () => void
}
export interface ComboGroup { id: string; label: string; options: ComboOption[]; /** Header extra, e.g. 「清空」. */ extra?: ReactNode }

export type ComboState = { open: boolean; active: number }
export type ComboEffect = { type: 'toggle' | 'pick' | 'remove'; option: ComboOption } | { type: 'removeLast' } | { type: 'submit' } | null

/** Pure keyboard logic (tested in options-combobox.test.ts). `handled` → preventDefault. */
export function comboKeyDown(s: ComboState, key: string, ctx: { options: ComboOption[]; inputEmpty: boolean; hasSelected: boolean }): { state: ComboState; effect: ComboEffect; handled: boolean } {
  const n = ctx.options.length
  const cur = s.open && s.active < n ? s.active : -1
  const none = { state: s, effect: null, handled: false }
  switch (key) {
    case 'ArrowDown': return { state: { open: true, active: !n ? -1 : s.open ? (cur + 1) % n : 0 }, effect: null, handled: true }
    case 'ArrowUp': return { state: { open: true, active: !n ? -1 : s.open && cur > 0 ? cur - 1 : n - 1 }, effect: null, handled: true }
    case 'Enter': {
      const o = ctx.options[cur]
      if (!o) return { state: { open: false, active: -1 }, effect: { type: 'submit' }, handled: true }
      return { state: o.action ? { open: false, active: -1 } : s, effect: { type: o.action ? 'pick' : 'toggle', option: o }, handled: true }
    }
    case 'Escape': return s.open ? { state: { open: false, active: -1 }, effect: null, handled: true } : none
    case 'Tab': return { state: { open: false, active: -1 }, effect: null, handled: false }
    case 'Backspace': return ctx.inputEmpty && ctx.hasSelected ? { state: s, effect: { type: 'removeLast' }, handled: true } : none
    case 'Delete': {
      const o = ctx.options[cur]
      return o?.onRemove ? { state: { ...s, active: Math.min(cur, n - 2) }, effect: { type: 'remove', option: o }, handled: true } : none
    }
    default: return none
  }
}

export interface OptionsComboboxProps {
  /** Accessible name of the input. */
  label: string
  placeholder?: string
  value: string
  onValueChange: (value: string) => void
  groups: ComboGroup[]
  selected: string[]
  onToggle: (value: string) => void
  onPick?: (value: string) => void
  /** Enter with no active option. */
  onSubmit?: () => void
  onBlur?: () => void
  className?: string
}

/**
 * Search field + multi-select option list (combobox → listbox). Selected values render as removable chips in the field;
 * Backspace on an empty input removes the last one. Arrows move, Enter toggles/picks, Esc closes, Tab leaves.
 */
export function OptionsCombobox({ label, placeholder, value, onValueChange, groups, selected, onToggle, onPick, onSubmit, onBlur, className }: OptionsComboboxProps) {
  const id = useId()
  const optId = (i: number) => `${id}-opt-${i}`
  const [state, setState] = useState<ComboState>({ open: false, active: -1 })
  const anchor = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const visible = groups.filter((g) => g.options.length)
  const options = visible.flatMap((g) => g.options)
  const active = state.open && state.active < options.length ? state.active : -1
  const labelOf = (v: string) => options.find((o) => !o.action && o.value === v)?.label ?? v

  useEffect(() => {
    if (active >= 0) document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' })
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = (o: ComboOption, type: 'toggle' | 'pick' | 'remove') => {
    if (type === 'remove') o.onRemove?.()
    else if (type === 'pick') onPick?.(o.value)
    else onToggle(o.value)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    const r = comboKeyDown({ open: state.open, active }, e.key, { options, inputEmpty: !value, hasSelected: selected.length > 0 })
    if (r.handled) e.preventDefault()
    setState(r.state)
    const fx = r.effect
    if (!fx) return
    if (fx.type === 'submit') onSubmit?.()
    else if (fx.type === 'removeLast') onToggle(selected[selected.length - 1]!)
    else run(fx.option, fx.type)
  }

  let index = 0
  return (
    <P.Root open={state.open} onOpenChange={(open) => setState({ open, active: -1 })}>
      <P.Anchor asChild>
        <div
          ref={anchor}
          onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); input.current?.focus() } }}
          className={cn(
            'flex h-9 min-w-0 items-center gap-1 rounded-control border border-line bg-card pl-3 pr-1 text-sm transition-colors duration-(--duration-fast) hover:border-muted',
            'focus-within:border-acid focus-within:ring-3 focus-within:ring-acid/10 focus-within:hover:border-acid',
            className,
          )}
        >
          <Search className="size-4 shrink-0 text-muted" aria-hidden />
          {selected.length > 0 && (
            <div className="flex max-w-[60%] shrink-0 gap-1 overflow-x-auto [scrollbar-width:none]">
              {selected.map((v) => (
                <span key={v} className="inline-flex h-6 shrink-0 items-center gap-0.5 rounded-full bg-acid-soft pl-2 pr-0.5 text-xs font-semibold text-label">
                  {labelOf(v)}
                  <button type="button" aria-label={`移除「${labelOf(v)}」`} onMouseDown={(e) => e.preventDefault()} onClick={() => onToggle(v)} className={cn('grid size-5 place-items-center rounded-full hover:bg-acid/15', focusRing)}>
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-label={label}
            aria-expanded={state.open}
            aria-controls={state.open && visible.length ? visible.map((g) => `${id}-${g.id}-list`).join(' ') : undefined}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? optId(active) : undefined}
            enterKeyHint="search"
            value={value}
            placeholder={selected.length ? undefined : placeholder}
            onChange={(e) => { onValueChange(e.target.value); if (state.open) setState({ open: false, active: -1 }) }}
            onFocus={() => setState({ open: true, active: -1 })}
            onClick={() => { if (!state.open) setState({ open: true, active: -1 }) }}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            className="h-full min-w-16 flex-1 bg-transparent text-ink outline-none placeholder:text-muted"
          />
          {value && (
            <button type="button" aria-label="清空搜索" onMouseDown={(e) => e.preventDefault()} onClick={() => { onValueChange(''); input.current?.focus() }} className={cn('grid size-7 shrink-0 place-items-center rounded-[8px] text-muted hover:bg-subtle active:scale-[.98]', focusRing)}>
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </P.Anchor>
      <P.Portal>
        <P.Content
          role={undefined}
          align="start"
          sideOffset={6}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => { if (anchor.current?.contains(e.target as Node)) e.preventDefault() }}
          onMouseDown={(e) => e.preventDefault()}
          className="z-50 max-h-[min(60dvh,420px)] w-(--radix-popover-trigger-width) min-w-72 overflow-y-auto rounded-card border border-line bg-card p-1.5 text-sm text-ink shadow-xl outline-none motion-safe:animate-fade-in"
        >
          {!visible.length ? <p className="px-2.5 py-3 text-muted">暂无选项</p> : (
            // One listbox per group (all listed in aria-controls) so header extras like 「清空」 sit outside the listbox.
            visible.map((g) => (
                <div key={g.id} className="py-1 [&+&]:border-t [&+&]:border-line">
                  <div className="flex h-7 items-center justify-between px-2.5 text-xs text-muted">
                    <span id={`${id}-${g.id}`}>{g.label}</span>
                    {g.extra}
                  </div>
                  <div role="listbox" id={`${id}-${g.id}-list`} aria-labelledby={`${id}-${g.id}`} aria-multiselectable={g.options.some((o) => !o.action) || undefined}>
                  {g.options.map((o) => {
                    const i = index++
                    const on = !o.action && selected.includes(o.value)
                    return (
                      <div
                        key={o.value}
                        id={optId(i)}
                        role="option"
                        aria-selected={on}
                        onMouseMove={() => { if (active !== i) setState({ open: true, active: i }) }}
                        onClick={() => { run(o, o.action ? 'pick' : 'toggle'); if (o.action) setState({ open: false, active: -1 }) }}
                        className={cn('flex h-9 cursor-pointer items-center gap-2 rounded-[8px] px-2.5', i === active && 'bg-subtle', on && 'text-label')}
                      >
                        {!o.action && <Check aria-hidden className={cn('size-4 shrink-0', !on && 'invisible')} />}
                        <span className="min-w-0 flex-1 truncate">{o.label}</span>
                        {o.count != null && <span className={cn('text-xs tabular-nums', on ? 'text-label' : 'text-muted')}>{o.count}</span>}
                        {o.onRemove && (
                          // Mouse-only (a nested button would be interactive-in-option); keyboard users press Delete on the active row.
                          <Tooltip content="删除">
                            <span aria-hidden onClick={(e) => { e.stopPropagation(); o.onRemove!() }} className="grid size-6 place-items-center rounded-[6px] text-muted hover:bg-line hover:text-ink">
                              <X className="size-3.5" />
                            </span>
                          </Tooltip>
                        )}
                      </div>
                    )
                  })}
                  </div>
                </div>
              ))
          )}
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}
