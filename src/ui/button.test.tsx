import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from './button'
import { TooltipProvider } from './tooltip'

afterEach(() => { cleanup(); vi.useRealTimers() })
const spinner = () => document.querySelector('.lucide-loader-circle')

describe('Button loading', () => {
  it('hides spinner for fast requests, shows after 300ms, holds ≥500ms', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Button loading>发送</Button>)
    act(() => vi.advanceTimersByTime(299))
    expect(spinner()).toBeNull()
    expect(screen.getByRole('button').getAttribute('aria-disabled')).toBe('true') // still blocks double-submit
    act(() => vi.advanceTimersByTime(1))
    expect(spinner()).not.toBeNull()
    rerender(<Button>发送</Button>)
    act(() => vi.advanceTimersByTime(499))
    expect(spinner()).not.toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(spinner()).toBeNull()
  })

  it('never shows spinner when loading ends within 300ms', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Button loading>发送</Button>)
    act(() => vi.advanceTimersByTime(200))
    rerender(<Button>发送</Button>)
    act(() => vi.advanceTimersByTime(1000))
    expect(spinner()).toBeNull()
  })
})

describe('Button disabledReason', () => {
  it('stays focusable, blocks click and shows the reason tooltip', async () => {
    const onClick = vi.fn()
    render(<TooltipProvider><Button disabled disabledReason="当前型号不支持参考图" onClick={onClick}>发送</Button></TooltipProvider>)
    const btn = screen.getByRole('button')
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
    act(() => btn.focus())
    expect((await screen.findAllByText('当前型号不支持参考图')).length).toBeGreaterThan(0)
  })
})
