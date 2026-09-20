import { describe, expect, it, vi } from 'vitest'
import { CANVAS_ADD_EVENT, COMPOSER_FILL_EVENT, dispatchStudioEvent, onStudioEvent, parseCanvasAdd, parseComposerFill } from './events'

const img = (id: string) => ({ id, kind: 'image', status: 'ready', width: 10, height: 10, duration_ms: null, urls: { orig: `https://x/${id}.png` } })

describe('studio events', () => {
  it('validates composer-fill shapes', () => {
    expect(parseComposerFill({ source: 'nope' })).toBeNull()
    expect(parseComposerFill({ source: 'asset', reference_assets: [{ id: 'a' }] })).toBeNull()
    expect(parseComposerFill({ source: 'asset', reference_assets: [{ ...img('a'), status: 'processing' }] })).toBeNull()
    expect(parseComposerFill({ source: 'asset', reference_assets: [{ id: 'a', kind: 'image', urls: { orig: 'u' } }] }))
      .toEqual({ source: 'asset', reference_assets: [{ id: 'a', kind: 'image', status: 'ready', width: null, height: null, duration_ms: null, urls: { orig: 'u' } }] })
    expect(parseComposerFill({ source: 'case', prompt: 'p', reference_urls: ['https://a'] })).toMatchObject({ source: 'case', prompt: 'p', reference_urls: ['https://a'] })
  })

  it('pairs legacy canvas ids with urls only when every url has an id', () => {
    const paired = parseComposerFill({ source: 'canvas', project_id: 'p', node_id: 'n', prompt: '', reference_urls: ['https://a', 'https://b'], reference_asset_ids: ['id-a', 'id-b'] })
    expect(paired).toMatchObject({ reference_assets: [{ id: 'id-a', urls: { orig: 'https://a' } }, { id: 'id-b' }], reference_urls: [] })
    const partial = parseComposerFill({ source: 'canvas', project_id: 'p', node_id: 'n', prompt: '', reference_urls: ['https://a', 'https://b'], reference_asset_ids: ['id-a'] })
    expect(partial).toMatchObject({ reference_assets: [], reference_urls: ['https://a', 'https://b'] })
  })

  it('validates canvas-add shapes (source may be omitted for assets)', () => {
    expect(parseCanvasAdd({ assets: [img('a')] })).toMatchObject({ source: 'asset' })
    expect(parseCanvasAdd({ source: 'record', record_id: 'r', results: [] })).toBeNull()
    expect(parseCanvasAdd({ source: 'case', case_id: 'c', image: { url: 'u', width: -1 }, prompt: 'x' })).toEqual({ source: 'case', case_id: 'c', image: { url: 'u', width: null, height: null }, prompt: 'x' })
  })

  it('dispatch refuses invalid details; on* only delivers valid ones', () => {
    const got = vi.fn(), bad = vi.fn()
    const off = onStudioEvent(CANVAS_ADD_EVENT, got, bad)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(dispatchStudioEvent(CANVAS_ADD_EVENT, { source: 'asset', assets: [] })).toBe(false)
    expect(dispatchStudioEvent(CANVAS_ADD_EVENT, { source: 'asset', assets: [img('a') as never] })).toBe(true)
    window.dispatchEvent(new CustomEvent(CANVAS_ADD_EVENT, { detail: { source: 'x' } }))
    window.dispatchEvent(new CustomEvent(COMPOSER_FILL_EVENT, { detail: { source: 'asset', reference_assets: [img('b')] } }))
    expect(got).toHaveBeenCalledTimes(1)
    expect(bad).toHaveBeenCalledWith({ source: 'x' })
    off(); err.mockRestore()
  })
})
