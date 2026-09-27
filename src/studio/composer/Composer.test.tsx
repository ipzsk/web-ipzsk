import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '@/shared/query'
import { TooltipProvider } from '@/ui'
import type { QuoteResult } from '../api/catalog'
import { useComposer } from '../store'
import { docFromText, itemFromDraft } from './logic'
import { sender } from './send'
import { Composer } from './Composer'

const state = vi.hoisted(() => ({
  points: 100,
  quote: { data: [{ points: 25 }] as QuoteResult[], isCurrent: true, isPending: false, isFetching: false, isError: false, refetch: vi.fn() },
  model: { id: 'gpt-image-2', name: 'GPT Image 2', kind: 'image' as const, params: [], unsupported: {}, billing: { unit: null }, references: { maxImages: 0 } },
}))
vi.mock('./hooks', async original => ({
  ...await original<object>(),
  useAccount: () => ({ signedIn: true, pending: false, points: state.points }),
  useModels: () => ({ data: [state.model] }),
  useSubjects: () => ({ data: [], hasNextPage: false }),
  useQuote: () => state.quote,
  useQueueSync: () => {},
}))
vi.mock('./PromptEditor', async original => ({
  ...await original<object>(),
  // Exercise the editor's submit callback independently of the disabled send button.
  PromptEditor: ({ onSubmit }: { onSubmit: () => void }) => <button onClick={onSubmit}>编辑器快捷发送</button>,
}))
vi.mock('./ReferenceSlots', () => ({ ReferenceSlots: () => null }))
vi.mock('./ModelControls', () => ({ ModelPicker: () => null, ParamChips: () => null }))

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  state.points = 100
  Object.assign(state.quote, { data: [{ points: 25 }], isCurrent: true, isPending: false, isFetching: false, isError: false })
  useComposer.setState({ kind: 'image', mode: null, queue: [], slots: [], doc: docFromText('测试图片'), vars: {}, editingId: null, sourceCase: null })
  vi.spyOn(sender, 'sendBatch').mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); queryClient.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const show = () => render(<QueryClientProvider client={queryClient}><TooltipProvider><Composer hidden={false} /></TooltipProvider></QueryClientProvider>)

describe('composer charge guard', () => {
  it.each(['item-error', 'http-error', 'pending', 'outdated'] as const)('blocks button and editor submission for a %s quote without displaying zero', kind => {
    if (kind === 'item-error') state.quote.data = [{ points: null, error: { code: 'billing_unavailable', message: '报价不可用' } }]
    if (kind === 'http-error') state.quote.isError = true
    if (kind === 'pending') state.quote.isFetching = true
    if (kind === 'outdated') state.quote.isCurrent = false
    show()
    const send = screen.getByRole('button', { name: /^发送/ })
    expect(send.getAttribute('aria-disabled')).toBe('true')
    expect(send.textContent).not.toContain('0.00')
    fireEvent.click(send)
    fireEvent.click(screen.getByRole('button', { name: '编辑器快捷发送' }))
    expect(sender.sendBatch).not.toHaveBeenCalled()
  })

  it('allows submission after a failed quote is refreshed successfully', () => {
    state.quote.data = [{ points: null, error: { code: 'billing_unavailable', message: '不可用' } }]
    const view = show()
    fireEvent.click(screen.getByRole('button', { name: '重新获取报价' }))
    expect(state.quote.refetch).toHaveBeenCalled()
    state.quote.data = [{ points: 25 }]
    view.rerender(<QueryClientProvider client={queryClient}><TooltipProvider><Composer hidden={false} /></TooltipProvider></QueryClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: /^发送/ }))
    expect(sender.sendBatch).toHaveBeenCalledTimes(1)
  })

  it('does not let the editor shortcut bypass insufficient balance', () => {
    state.points = 1
    show()
    expect(screen.getByRole('button', { name: /余额不足/ })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '编辑器快捷发送' }))
    expect(sender.sendBatch).not.toHaveBeenCalled()
  })

  it('blocks the queue send action when one queued price is unavailable', () => {
    const item = itemFromDraft({ kind: 'image', model: state.model, params: {}, doc: docFromText('队列图片'), slots: [] })
    useComposer.setState({ queue: [item], doc: null })
    state.quote.data = [{ points: null }]
    show()
    const send = screen.getByRole('button', { name: '全部发送' })
    expect(send.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(send)
    expect(sender.sendBatch).not.toHaveBeenCalled()
  })
})

describe('case fill', () => {
  it('a 数字人 case switches to avatar mode with its prompt as the script', async () => {
    const { COMPOSER_FILL_EVENT, dispatchStudioEvent } = await import('@/shared/events')
    const { useAvatarDraft } = await import('../avatar/draft')
    queryClient.setQueryData(['media', 'models'], [state.model])
    render(<QueryClientProvider client={queryClient}><TooltipProvider><Composer hidden={false} /></TooltipProvider></QueryClientProvider>)
    dispatchStudioEvent(COMPOSER_FILL_EVENT, { source: 'case', case_id: 'a1', kind: 'video', mode: 'avatar', model: 'heygen-avatar', prompt: '大家好，我是店长', params: { aspect_ratio: '9:16' }, reference_urls: [] })
    await vi.waitFor(() => expect(useComposer.getState()).toMatchObject({ kind: 'video', mode: 'avatar' }))
    expect(useAvatarDraft.getState().script).toBe('大家好，我是店长')
    expect(useComposer.getState().memory.avatar).toMatchObject({ params: { aspect_ratio: '9:16' } })
    expect(useComposer.getState().memory.avatar?.model).not.toBe('heygen-avatar')
  })
})
