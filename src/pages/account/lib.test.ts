import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_ERRORS, VOUCHER_ERRORS, accountMessage, activeTokenCount, clearPendingFlow, cooldownSeconds, readFlow, rememberFlow,
  resolveNext, tokenInitial, tokenReducer, tokenStatus,
} from './lib'

// Fixtures copied from legacy account.js / recharge.js — parity must hold byte for byte.
const LEGACY_ACCOUNT = {captcha_required:'请先完成人机验证。',captcha_invalid:'人机验证已失效，请重新验证。',captcha_unavailable:'人机验证服务暂不可用，请稍后重试。',INVALID_EMAIL_OR_PASSWORD:'邮箱或密码不正确；未注册的邮箱请先注册。',EMAIL_NOT_VERIFIED:'邮箱尚未验证，请到注册页面完成邮箱验证。',PASSWORD_TOO_SHORT:'密码至少需要 12 位。',PASSWORD_TOO_LONG:'密码最多 128 位。',USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:'该邮箱已注册，请登录或找回密码。',email_service_unavailable:'邮箱验证服务尚未开放，注册和找回密码暂不可用；已有账户可以使用密码登录。',email_delivery_failed:'邮件发送失败，请稍后重试。',customer_login_required:'请先使用邮箱和密码登录。',account_disabled:'账户已停用，请联系管理员。',invalid_email:'请检查邮箱地址。',rate_limited:'请求过于频繁，请稍后重试。',INVALID_OTP:'验证码错误或已失效，请检查后重试。',OTP_EXPIRED:'验证码已过期，请重新发送。',TOO_MANY_ATTEMPTS:'验证次数过多，请重新发送验证码。',INVALID_EMAIL:'邮箱地址格式不正确。',voucher_unavailable:'充值码不可用，请核对是否已兑换、过期或尚未启用。',invalid_voucher:'请检查充值码格式。'}
const LEGACY_VOUCHER = {voucher_unavailable:'兑换码不可用，请核对是否已兑换、过期或尚未启用。',invalid_voucher:'请检查兑换码格式。',rate_limited:'操作太频繁，请稍后再试。',account_disabled:'账户已停用，请联系管理员。'}

describe('error maps', () => {
  it('match legacy', () => {
    expect(ACCOUNT_ERRORS).toEqual(LEGACY_ACCOUNT)
    expect(VOUCHER_ERRORS).toEqual(LEGACY_VOUCHER)
  })
  it('fallbacks match legacy request()', () => {
    expect(accountMessage('OTP_EXPIRED', 400)).toBe('验证码已过期，请重新发送。')
    expect(accountMessage('http_502', 502)).toBe('服务暂时不可用，请稍后重试。')
    expect(accountMessage('whatever', 400)).toBe('操作未成功，请稍后重试。')
    expect(accountMessage('network_error', 0)).toBe('暂时无法连接服务，请检查网络后重试。')
  })
})

describe('resolveNext', () => {
  it('keeps same-site paths', () => {
    expect(resolveNext('/studio?kind=video#x')).toBe('/studio?kind=video#x')
    expect(resolveNext('/developer')).toBe('/developer')
  })
  it('maps legacy keywords', () => {
    expect(resolveNext('recharge')).toBe('/account?recharge=1')
    expect(resolveNext('developer')).toBe('/developer')
    expect(resolveNext('workspace')).toBe('/workspace')
    expect(resolveNext('video')).toBe('/video')
  })
  it('rejects open redirects', () => {
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', '/\t/evil.com', '/\n/evil.com', 'evil', '', null, undefined])
      expect(resolveNext(bad)).toBe('/')
  })
})

describe('OTP flow persistence + cooldown', () => {
  const now = 1_000_000
  it('remember sets 15 min pending and 60 s cooldown on the normalized email', () => {
    const f = rememberFlow(readFlow(null, now), 'register', ' Cat@IPZSK.com ', true, now)
    expect(f.pending.register).toEqual({ email: 'cat@ipzsk.com', until: now + 900_000 })
    expect(cooldownSeconds(f, 'cat@ipzsk.com', now)).toBe(60)
    expect(cooldownSeconds(f, 'CAT@ipzsk.com', now + 59_001)).toBe(1)
    expect(cooldownSeconds(f, 'cat@ipzsk.com', now + 60_000)).toBe(0)
    expect(cooldownSeconds(f, 'other@ipzsk.com', now)).toBe(0)
  })
  it('EMAIL_NOT_VERIFIED path remembers without cooldown', () => {
    const f = rememberFlow(readFlow(null, now), 'register', 'a@b.co', false, now)
    expect(f.pending.register?.email).toBe('a@b.co')
    expect(cooldownSeconds(f, 'a@b.co', now)).toBe(0)
  })
  it('round-trips through sessionStorage JSON and drops expired / junk entries', () => {
    const f = rememberFlow(rememberFlow(readFlow(null, now), 'reset', 'x@y.z', true, now), 'register', 'r@y.z', true, now)
    const again = readFlow(JSON.stringify(f), now + 61_000)
    expect(again.cooldowns).toEqual({})
    expect(again.pending.reset?.email).toBe('x@y.z')
    expect(readFlow(JSON.stringify(f), now + 16 * 60_000).pending).toEqual({})
    expect(readFlow('{bad json', now)).toEqual({ pending: {}, cooldowns: {} })
    expect(readFlow(JSON.stringify({ pending: { register: { email: 5, until: now + 1 } }, cooldowns: { a: 'x' } }), now)).toEqual({ pending: {}, cooldowns: {} })
    expect(clearPendingFlow(f, 'reset').pending.reset).toBeUndefined()
  })
})

describe('token state machine', () => {
  it('issue → issued reveals once; concurrent actions are ignored', () => {
    let s = tokenReducer(tokenInitial, { type: 'issue' })
    expect(s.issuing).toBe(true)
    expect(tokenReducer(s, { type: 'issue' })).toBe(s)
    expect(tokenReducer(s, { type: 'revoke', id: 't1' })).toBe(s)
    s = tokenReducer(s, { type: 'issued', token: 'ipz_secret' })
    expect(s).toEqual({ issuing: false, revoking: null, revealed: 'ipz_secret' })
    expect(tokenReducer(s, { type: 'reset' }).revealed).toBeNull()
  })
  it('issue failure keeps nothing revealed; stray issued is ignored', () => {
    const failed = tokenReducer(tokenReducer(tokenInitial, { type: 'issue' }), { type: 'issueFailed' })
    expect(failed).toEqual(tokenInitial)
    expect(tokenReducer(tokenInitial, { type: 'issued', token: 'x' })).toBe(tokenInitial)
  })
  it('revoke tracks one id until the server answers', () => {
    let s = tokenReducer(tokenInitial, { type: 'revoke', id: 't1' })
    expect(s.revoking).toBe('t1')
    expect(tokenReducer(s, { type: 'issue' })).toBe(s)
    s = tokenReducer(s, { type: 'revokeFailed' })
    expect(s.revoking).toBeNull()
  })
  it('status + active count like legacy', () => {
    const now = new Date('2026-09-17T00:00:00Z')
    const rows = [
      { id: '1', name: 'a', prefix: 'p', revoked_at: null, expires_at: null, rpm: null },
      { id: '2', name: 'b', prefix: 'p', revoked_at: '2026-01-01', expires_at: null, rpm: null },
      { id: '3', name: 'c', prefix: 'p', revoked_at: null, expires_at: '2026-01-01T00:00:00Z', rpm: 5 },
    ]
    expect(rows.map(r => tokenStatus(r, now))).toEqual(['有效', '已吊销', '已到期'])
    expect(activeTokenCount(rows, now)).toBe(1)
  })
})
