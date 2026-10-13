import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, UNAUTHORIZED_EVENT, currentUser, errorMessage, request } from './api'

const respond = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
afterEach(() => vi.unstubAllGlobals())

describe('request errors', () => {
  it('anonymous session avoids a protected profile request', async () => {
    respond(200, null)
    expect(await currentUser()).toBeNull()
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/auth/get-session'), expect.any(Object))
  })

  it('signed-in session still resolves the customer profile', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'auth-id' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'customer-id', email: 'test@example.com' } })))
    vi.stubGlobal('fetch', fetcher)
    expect(await currentUser()).toMatchObject({ id: 'customer-id' })
    expect(fetcher).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/me/profile'), expect.any(Object))
  })
  it('maps {error:{code}} to ApiError with Chinese message', async () => {
    respond(402, { error: { code: 'insufficient_balance', message: 'x' } })
    const err = await request('/api/me/x').catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 402, code: 'insufficient_balance', message: '余额不足，请先充值。' })
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

describe('generation submit messages', () => {
  it('explains upstream outcomes instead of a generic retry prompt', () => {
    expect(errorMessage('upstream_result_uncertain')).toMatch(/核对.*请勿重复提交/)
    expect(errorMessage('upstream_http_502')).toMatch(/请勿重复提交/)
    expect(errorMessage('upstream_http_400')).toMatch(/修改后重试/)
    expect(errorMessage('upstream_http_402')).toMatch(/稍后重试/)
    expect(errorMessage('invalid_batch_position')).toMatch(/12 项/)
    expect(errorMessage('request_cancelled')).toBe('请求已中断，请重试。')
    expect(errorMessage('something_new')).toBe('操作未成功，请稍后重试。')
  })
})
