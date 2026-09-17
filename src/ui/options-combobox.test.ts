import { describe, expect, it, vi } from 'vitest'
import { comboKeyDown, type ComboOption, type ComboState } from './options-combobox'

const remove = vi.fn()
const options: ComboOption[] = [
  { value: '香水', label: '香水', action: true, onRemove: remove },
  { value: 'ui', label: '界面', count: 3 },
  { value: 'posters', label: '海报', count: 5 },
]
const ctx = { options, inputEmpty: false, hasSelected: false }
const key = (s: ComboState, k: string, c = ctx) => comboKeyDown(s, k, c)
const closed: ComboState = { open: false, active: -1 }

describe('comboKeyDown', () => {
  it('arrows open the list and wrap', () => {
    expect(key(closed, 'ArrowDown').state).toEqual({ open: true, active: 0 })
    expect(key(closed, 'ArrowUp').state).toEqual({ open: true, active: 2 })
    expect(key({ open: true, active: 2 }, 'ArrowDown').state.active).toBe(0)
    expect(key({ open: true, active: 0 }, 'ArrowUp').state.active).toBe(2)
    expect(key({ open: true, active: -1 }, 'ArrowDown').state.active).toBe(0)
    expect(key(closed, 'ArrowDown', { ...ctx, options: [] }).state).toEqual({ open: true, active: -1 })
  })

  it('Enter toggles a selectable option and keeps the list open; picks an action row and closes', () => {
    const t = key({ open: true, active: 1 }, 'Enter')
    expect(t.effect).toEqual({ type: 'toggle', option: options[1] })
    expect(t.state).toEqual({ open: true, active: 1 })
    const p = key({ open: true, active: 0 }, 'Enter')
    expect(p.effect).toEqual({ type: 'pick', option: options[0] })
    expect(p.state.open).toBe(false)
    expect(key(closed, 'Enter')).toMatchObject({ effect: { type: 'submit' }, handled: true })
    // An active index left over from a closed list never toggles.
    expect(key({ open: false, active: 1 }, 'Enter').effect).toEqual({ type: 'submit' })
  })

  it('Esc closes (only when open), Tab closes without trapping', () => {
    expect(key({ open: true, active: 1 }, 'Escape')).toMatchObject({ state: closed, handled: true })
    expect(key(closed, 'Escape').handled).toBe(false)
    expect(key({ open: true, active: 1 }, 'Tab')).toMatchObject({ state: closed, handled: false })
  })

  it('Backspace on an empty input removes the last selected; Delete removes a removable row', () => {
    expect(key(closed, 'Backspace', { ...ctx, inputEmpty: true, hasSelected: true }).effect).toEqual({ type: 'removeLast' })
    expect(key(closed, 'Backspace', { ...ctx, inputEmpty: false, hasSelected: true }).effect).toBeNull()
    expect(key(closed, 'Backspace', { ...ctx, inputEmpty: true, hasSelected: false }).handled).toBe(false)
    expect(key({ open: true, active: 0 }, 'Delete').effect).toEqual({ type: 'remove', option: options[0] })
    expect(key({ open: true, active: 1 }, 'Delete').handled).toBe(false)
  })
})
