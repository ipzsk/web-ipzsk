import { expect, it } from 'vitest'
import { DESKTOP, MOBILE, e2eDescribe, gotoMock, overflowX, shot, useBrowser } from './support'

for (const viewport of [DESKTOP, MOBILE]) {
  for (const role of ['bd', 'developer'] as const) {
  e2eDescribe(`commission wallet ${role} ${viewport.width}px`, () => {
    const conversions: { readonly id: string; readonly amount_cny: string; readonly state: string; readonly created_at: string }[] = []
    const t = useBrowser({ viewport, mock: false, api: (method, path) => {
      if (path === '/api/auth/get-session') return [200, { user: { id: 'fixture' } }]
      if (path === '/api/me/profile') return [200, { user: { id: 'fixture', name: '收益测试用户' } }]
      if (path === '/api/me/wallet') return [200, { balance_cny: '100', available_cny: '100', frozen_cny: '0', entries: [] }]
      if (path === '/api/me/payments/options') return [200, { enabled: false, packs: [] }]
      if (path === '/api/me/usage' || path === '/api/me/payments/orders') return [200, { rows: [] }]
      if (path === '/api/me/commissions') return [200, { invitation_url: 'https://api.ipzsk.com/api/account/referral/0123456789abcdef0123456789abcdef', referrals: 2,
        profile: { bd_active: role === 'bd' }, balance: { total_cny: '220', available_cny: '200', withdrawable_cny: '180', frozen: false },
        policy: { active: true, bd_share_bps: 2000, developer_share_bps: 3500, started_at: '2026-10-12T00:00:00Z', ends_at: '2027-10-12T00:00:00Z' },
        ledger: [{ kind: role, amount_cny: role === 'bd' ? '20.00000000' : '35.00000000', created_at: '2026-09-01T00:00:00Z', available_at: '2026-10-01T00:00:00Z' }], conversions, payouts: [] }]
      if (method === 'POST' && path === '/api/me/commissions/convert') {
        const row = { id: 'conversion-fixture', amount_cny: '20', state: 'applied', created_at: '2026-10-10T00:00:00Z' }
        conversions.push(row); return [200, row]
      }
      return undefined
    } })
    it('invitation, confirmation, successful conversion and records render without overflow or runtime errors', async () => {
      const { page } = t
      await gotoMock(page, '/#wallet', { mock: false })
      await page.getByRole('heading', { name: '邀请与收益' }).waitFor()
      expect(await page.getByLabel('我的邀请链接', { exact: false }).inputValue()).toContain('/referral/')
      await page.getByLabel('操作金额（元）').fill('20')
      await page.getByRole('button', { name: '转使用余额', exact: true }).click()
      await page.getByRole('dialog').waitFor()
      expect(t.apiCalls.filter(call => call.method === 'POST' && call.url.endsWith('/convert'))).toHaveLength(0)
      await page.getByRole('button', { name: '确认提交' }).click()
      await page.getByText('已转入平台使用余额。', { exact: true }).waitFor()
      await page.getByText('转余额与提现记录', { exact: true }).click()
      await page.getByText('conversion-fixture', { exact: false }).waitFor()
      await page.getByText('最近收益流水', { exact: true }).click()
      await page.getByRole('cell', { name: role === 'bd' ? 'BD 消费分佣' : '插件开发者消费分佣', exact: true }).waitFor()
      await page.getByRole('cell', { name: role === 'bd' ? '¥20.00' : '¥35.00', exact: true }).waitFor()
      expect(await page.getByText('分佣计算明细', { exact: true }).count()).toBe(0)
      expect(t.apiCalls.filter(call => call.method === 'POST' && call.url.endsWith('/convert'))).toHaveLength(1)
      expect(await overflowX(page)).toBe(0)
      expect(t.errors).toEqual([])
      await shot(page, 'commissions-' + role + '-' + viewport.width)
    })
  })
  }
}
