import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, UNAUTHORIZED_EVENT, currentUser, request } from './api'

const respond = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
afterEach(() => vi.unstubAllGlobals())

describe('request errors', () => {
  it('maps {error:{code}} to ApiError with Chinese message', async () => {
    respond(402, { error: { code: 'insufficient_balance', message: 'x' } })
    const err = await request('/api/me/x').catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 402, code: 'insufficient_balance', message: '点数不足，请先充值。' })
  })

  it('falls back to http_<status> and generic message', async () => {
    respond(500, null)
    await expect(request('/x')).rejects.toMatchObject({ status: 500, code: 'http_500', message: '操作未成功，请稍后重试。' })
  })

  it('network failure → network_error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(request('/x')).rejects.toMatchObject({ status: 0, code: 'network_error' })
  })

  it('401 broadcasts and currentUser resolves null', async () => {
    respond(401, { error: { code: 'customer_login_required', message: '' } })
    const heard = vi.fn()
    window.addEventListener(UNAUTHORIZED_EVENT, heard)
    expect(await currentUser()).toBeNull()
    expect(heard).toHaveBeenCalledOnce()
  })
})
