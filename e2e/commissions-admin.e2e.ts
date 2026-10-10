import { beforeAll, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { BASE, e2eDescribe, shot, useBrowser } from './support'

interface ConsoleRoute {
  readonly request: () => { readonly url: () => string; readonly method: () => string; readonly postDataJSON: () => unknown }
  readonly fulfill: (options: { readonly contentType: string; readonly body: string }) => Promise<void>
}

e2eDescribe('commission operations console', () => {
  const t = useBrowser({ mock: false })
  const writes: { readonly path: string; readonly body: unknown }[] = []
  let state = 'requested'
  beforeAll(async () => {
    await t.page.route('**/admin-test', async (route: ConsoleRoute) => route.fulfill({ contentType: 'text/html', body: await readFile(new URL('../../ipzsk-api-gateway/public/index.html', import.meta.url), 'utf8') }))
    await t.page.route('**/admin/*.js', async (route: ConsoleRoute) => {
      const file = new URL(route.request().url()).pathname.split('/').at(-1)
      if (!file || !['app.js', 'accounts.js', 'plugins.js', 'wallet.js', 'commissions.js'].includes(file)) throw new Error('Unexpected console module')
      await route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL('../../ipzsk-api-gateway/public/' + file, import.meta.url), 'utf8') })
    })
    await t.page.route('**/admin/style.css', async (route: ConsoleRoute) => route.fulfill({ contentType: 'text/css', body: await readFile(new URL('../../ipzsk-api-gateway/public/style.css', import.meta.url), 'utf8') }))
    await t.page.route('**/admin/api/**', async (route: ConsoleRoute) => {
      const path = new URL(route.request().url()).pathname
      let body: unknown = {}
      if (path.endsWith('/session')) body = { role: 'superadmin', username: 'fixture' }
      else if (path.endsWith('/overview')) body = { accounts: { remain_credits: 0, stale: 0 }, requests: {}, chart: [], recent: [], active: 0, queue: 0 }
      else if (path.endsWith('/commissions')) body = { policy: { enabled: false }, profiles: [{ user_id: 'fixture-bd', name: '测试 BD', bd_active: true, frozen: false }],
        payouts: [{ id: 'fixture-payout', name: '测试 BD', amount_cny: '100', state, created_at: '2026-10-10T00:00:00Z' }], conversions: [], accounts: [],
        requests: [{ request_id: 'fixture-request', charged_cny: '100', paid_cny: '100', bd_cny: '12', developer_cny: '19.2', state: 'accrued' }] }
      else if (route.request().method() === 'POST') {
        const payload: unknown = route.request().postDataJSON()
        writes.push({ path, body: payload }); state = 'approved'; body = { ok: true }
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
    })
  })
  it('renders the financial queue and requires a receipt before approving a payout', async () => {
    const { page } = t
    await page.goto(BASE + '/admin-test')
    await page.getByRole('button', { name: '分佣与提现', exact: true }).click()
    await page.getByRole('heading', { name: '月度提现 · 满 100 元 · 审核后人工转账' }).waitFor()
    await page.getByRole('button', { name: '审核通过', exact: true }).click()
    expect(writes).toHaveLength(0)
    await page.getByLabel('核对依据或银行流水号（至少 5 字）').fill('verified-audit-fixture')
    await page.getByRole('button', { name: '确认保存', exact: true }).click()
    await page.getByRole('button', { name: '确认已转账', exact: true }).waitFor()
    expect(writes).toEqual([{ path: '/admin/api/commissions/payouts/fixture-payout', body: { reference: 'verified-audit-fixture', state: 'approved' } }])
    expect(t.errors).toEqual([])
    await shot(page, 'commissions-admin')
  })
})
