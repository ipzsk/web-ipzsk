import { describe, expect, it } from 'vitest'
import { ApiError } from '@/shared/api'
import { can, cancelBlockReason, grantIssues, moveCase, positionBetween, publishIssues, revokeBlockReason, sessionLeft, templateIssues, type AdminCase } from './lib'
import { createMockApi } from './api'

const noDelay = async () => {}

describe('role gating', () => {
  it('viewer reads only, operator writes cases, admin writes roles', () => {
    expect(can(['viewer'], 'read')).toBe(true)
    expect(can(['viewer'], 'cases.write')).toBe(false)
    expect(can(['viewer'], 'generations.act')).toBe(false)
    expect(can(['operator'], 'cases.write')).toBe(true)
    expect(can(['operator'], 'generations.act')).toBe(true)
    expect(can(['operator'], 'roles.write')).toBe(false)
    expect(can(['viewer'], 'ops.write')).toBe(false)
    expect(can(['operator'], 'ops.write')).toBe(true)
    expect(can(['admin'], 'ops.write')).toBe(true)
    expect(can(['admin'], 'roles.write')).toBe(true)
    expect(can([], 'read')).toBe(false)
    expect(can(['viewer', 'operator'], 'cases.write')).toBe(true)
    expect(can(['admin'], 'wallet.grant')).toBe(true)
    expect(can(['viewer', 'operator'], 'wallet.grant')).toBe(false)
  })

  it('checks wallet grants like the gateway', () => {
    expect(grantIssues('50', '测试补发')).toEqual({})
    expect(grantIssues('0.01', 'ok')).toEqual({})
    for (const a of ['0', '1000.01', '1.234', 'abc', '', '-5']) expect(grantIssues(a, 'ok').amount, a).toBeTruthy()
    expect(grantIssues('5', ' x ').reason).toBeTruthy()
    expect(grantIssues('5', 'x'.repeat(201)).reason).toBeTruthy()
  })
  it('blocks revoking own admin and the last admin', () => {
    expect(revokeBlockReason({ role: 'admin', targetId: 'me', meId: 'me', adminCount: 3 })).toMatch('自己')
    expect(revokeBlockReason({ role: 'admin', targetId: 'x', meId: 'me', adminCount: 1 })).toMatch('最后')
    expect(revokeBlockReason({ role: 'admin', targetId: 'x', meId: 'me', adminCount: 2 })).toBeNull()
    expect(revokeBlockReason({ role: 'viewer', targetId: 'me', meId: 'me', adminCount: 1 })).toBeNull()
  })
  it('labels the 12h admin session and flags the last hour', () => {
    const now = Date.parse('2026-09-18T12:00:00Z')
    const at = (ms: number) => sessionLeft(new Date(now + ms).toISOString(), now)
    expect(at(11 * 3600_000).label).toBe('会话剩余约 11 小时')
    expect(at(11 * 3600_000).low).toBe(false)
    expect(at(3600_000).low).toBe(false)
    expect(at(25 * 60_000)).toMatchObject({ label: '会话剩余约 25 分钟', low: true })
    expect(at(-5_000)).toMatchObject({ label: '管理会话已过期', low: true })
    expect(sessionLeft('not a date', now).label).toBe('管理会话已过期')
  })
})

const base = {
  title: 't', prompt: 'p', category: 'posters', category_zh: null, tags: [], model: null, params: {}, template: null,
  author: null, author_url: null, source_repo: 'Punk-Skill', source_url: null, license_note: 'MIT',
  cover: { id: 'a', kind: 'image' as const, status: 'ready' as const, width: 1, height: 1, duration_ms: null, urls: { orig: 'x' } },
}

describe('publish validation', () => {
  it('passes a complete case', () => expect(publishIssues(base)).toEqual([]))
  it('lists every problem', () => {
    const issues = publishIssues({ ...base, title: ' ', license_note: '', source_repo: null, cover: null, author_url: 'http://x' })
    expect(issues.map(i => i.field).sort()).toEqual(['author_url', 'cover', 'license_note', 'source_url', 'title'])
  })
  it('rejects bad category ids and unready covers', () => {
    expect(publishIssues({ ...base, category: 'Posters' })[0]?.field).toBe('category')
    expect(publishIssues({ ...base, cover: { ...base.cover, status: 'pending' } })[0]?.reason).toMatch('处理中')
  })
})

describe('template validation', () => {
  const item = (o = {}) => ({ key: 'k', label: '主图', count: 1, ...o })
  it('accepts 1–12 outputs with at most one anchor', () => {
    expect(templateIssues({ items: [item({ anchor: true }), item({ count: 11 })] })).toEqual([])
    expect(templateIssues(null)).toEqual([])
  })
  it('rejects empty, >12 outputs, two anchors, blank names', () => {
    expect(templateIssues({ items: [] })).toHaveLength(1)
    expect(templateIssues({ items: [item({ count: 6 }), item({ count: 7 })] }).join()).toMatch('13')
    expect(templateIssues({ items: [item({ anchor: true }), item({ anchor: true })] }).join()).toMatch('锚图')
    expect(templateIssues({ items: [item({ label: '' })] }).join()).toMatch('名称')
    expect(templateIssues({ items: Array.from({ length: 13 }, () => item()) }).length).toBeGreaterThan(0)
  })
})

describe('reorder math', () => {
  it('positions between neighbours', () => {
    expect(positionBetween(1, 2)).toBe(1.5)
    expect(positionBetween(4, undefined)).toBe(5)
    expect(positionBetween(undefined, 0)).toBe(-1)
    expect(positionBetween(undefined, undefined)).toBe(0)
  })
  it('moves down and up and reports neighbours', () => {
    const l = [{ id: 'a', position: 0 }, { id: 'b', position: 1 }, { id: 'c', position: 2 }, { id: 'd', position: 3 }]
    const down = moveCase(l, 'a', 'c')!
    expect(down.list.map(x => x.id)).toEqual(['b', 'c', 'a', 'd'])
    expect(down).toMatchObject({ after_id: 'c', before_id: 'd', position: 2.5 })
    const top = moveCase(l, 'd', 'a')!
    expect(top).toMatchObject({ after_id: null, before_id: 'a', position: -1 })
    expect(moveCase(l, 'a', 'a')).toBeNull()
  })
})

describe('cancel precondition', () => {
  it('needs an active record older than 2h', () => {
    const now = Date.parse('2026-09-17T12:00:00Z')
    expect(cancelBlockReason({ status: 'running', created_at: '2026-09-17T09:00:00Z' }, now)).toBeNull()
    expect(cancelBlockReason({ status: 'running', created_at: '2026-09-17T11:00:00Z' }, now)).toMatch('2 小时')
    expect(cancelBlockReason({ status: 'succeeded', created_at: '2026-09-17T01:00:00Z' }, now)).toMatch('排队')
  })
})

describe('mock adapter', () => {
  const code = async (p: Promise<unknown>) => { try { await p; return 'ok' } catch (e) { return (e as ApiError).code } }

  it('gates me() by role', async () => {
    expect((await createMockApi('operator', noDelay).me()).roles).toEqual(['operator'])
    expect(await code(createMockApi('none', noDelay).me())).toBe('forbidden_role')
    expect(await code(createMockApi('expired', noDelay).me())).toBe('admin_session_expired')
  })

  it('lists seeded cases, filters, and viewer cannot write', async () => {
    const viewer = createMockApi('viewer', noDelay)
    const all = await viewer.cases.list({})
    expect(all.total).toBeGreaterThan(500)
    expect(all.items[0]!.status).toBe('draft')
    expect((await viewer.cases.list({ status: 'hidden' })).items.every(c => c.status === 'hidden')).toBe(true)
    expect(await code(viewer.cases.update(all.items[0]!.id, { title: 'x' }))).toBe('forbidden_role')
  })

  it('publish fails with fields then succeeds after filling license/source; audit records it', async () => {
    const api = createMockApi('operator', noDelay)
    const draft = (await api.cases.list({ status: 'draft' })).items[0] as AdminCase
    try { await api.cases.update(draft.id, { status: 'published' }); throw new Error('should fail') } catch (e) {
      expect((e as ApiError).code).toBe('case_publish_invalid')
      expect(JSON.stringify((e as ApiError).body)).toMatch('license_note')
    }
    const ok = await api.cases.update(draft.id, { status: 'published', license_note: 'MIT', source_repo: 'Punk-Skill' })
    expect(ok.status).toBe('published')
    expect((await api.audit.list({ action: 'case.*', target: draft.id })).items.map(e => e.action)).toContain('case.status')
  })

  it('moves a case and bulk-publishes per item', async () => {
    const api = createMockApi('admin', noDelay)
    const [a, b, c] = (await api.cases.list({})).items
    const r = await api.cases.move(c!.id, { after_id: a!.id, before_id: b!.id })
    expect(r.position).toBe((a!.position + b!.position) / 2)
    expect((await api.cases.list({})).items.slice(0, 3).map(x => x.id)).toEqual([a!.id, c!.id, b!.id])
    const bulk = await api.cases.bulkStatus([a!.id, 'nope'], 'hidden')
    expect(bulk.items.map(i => i.ok)).toEqual([true, false])
  })

  it('role grant/revoke rules', async () => {
    const admin = createMockApi('admin', noDelay)
    expect((await admin.users.grant('u-5', 'viewer')).roles).toEqual(['viewer'])
    expect(await code(admin.users.revoke('u-me', 'admin'))).toBe('cannot_revoke_own_admin')
    expect(await code(admin.users.grant('u-6', 'viewer'))).toBe('email_not_verified')
    expect(await code(createMockApi('operator', noDelay).users.grant('u-5', 'viewer'))).toBe('forbidden_role')
  })

  it('filters generations and cancels only stuck ones', async () => {
    const api = createMockApi('operator', noDelay)
    const failed = await api.generations.list({ status: 'failed' })
    expect(failed.items.length).toBeGreaterThan(0)
    expect(failed.items.every(x => x.status === 'failed')).toBe(true)
    expect(await code(api.generations.cancel(failed.items[0]!.id, 'x'))).toBe('generation_not_cancellable')
    expect((await api.generations.cancel('g-0006', '卡住')).status).toBe('cancelled')
  })

  it('wallet grant: admin only, validated, idempotent per key, raises the balance and audits', async () => {
    expect(await code(createMockApi('operator', noDelay).users.grantWallet('u-5', { amount_cny: '50', reason: '测试' }, 'k'))).toBe('forbidden_role')
    const api = createMockApi('admin', noDelay)
    expect(await code(api.users.grantWallet('u-5', { amount_cny: '0', reason: '测试' }, 'k0'))).toBe('invalid_amount')
    const before = Number((await api.users.get('u-5')).wallet!.available_points)
    const first = await api.users.grantWallet('u-5', { amount_cny: '50', reason: '测试补发' }, 'k1')
    const again = await api.users.grantWallet('u-5', { amount_cny: '50', reason: '测试补发' }, 'k1')
    expect(again.grant.id).toBe(first.grant.id)
    expect(Number(again.wallet!.available_points)).toBe(before + 5000)
    expect(await code(api.users.grantWallet('u-5', { amount_cny: '60', reason: '测试补发' }, 'k1'))).toBe('idempotency_conflict')
    expect((await api.audit.list({ action: 'wallet.grant' })).items.filter(e => e.target_id === 'u-5')).toHaveLength(1)
  })
})
