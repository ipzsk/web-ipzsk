import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CommissionPanel } from './CommissionPanel'
import { ApiError, request } from '@/shared/api'
import { TooltipProvider } from '@/ui'

vi.mock('@/shared/api', async importOriginal => ({ ...await importOriginal<typeof import('@/shared/api')>(), request: vi.fn() }))
const summary = {
  invitation_url: 'https://api.ipzsk.com/api/account/referral/fixture', referrals: 3, profile: { bd_active: true }, developer: null,
  policy: { bd_share_bps: 2000, developer_share_bps: 4000, developer_basis: 'remaining_profit', active: true },
  balance: { total_cny: '220.12345678', available_cny: '200', withdrawable_cny: '180', frozen: false },
  earned: { bd: '20.00000000' }, ledger: [], payouts: [], conversions: [],
} as const
function mount(frozen = false, kind?: 'bd' | 'developer', view?: 'wallet' | 'developer') {
  const data = { ...summary, balance: { ...summary.balance, frozen },
    ...(kind === 'developer' ? { profile: { bd_active: false }, developer: { state: 'approved', display_name: 'Author' }, earned: { developer: '16.00000000' } } : {}),
    ledger: kind ? [{ kind, amount_cny: kind === 'bd' ? '20.00000000' : '16.00000000', created_at: '2026-10-10T00:00:00Z', available_at: '2026-11-09T00:00:00Z',
      request_id: '12345678-0000-4000-8000-000000000000', plugin_name: kind === 'developer' ? '海报插件' : null }] : [] }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  client.setQueryData(['commissions', 'fixture'], data)
  vi.mocked(request).mockResolvedValue(data)
  return render(<QueryClientProvider client={client}><TooltipProvider><CommissionPanel userId="fixture" view={view} /></TooltipProvider></QueryClientProvider>)
}
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('commission wallet', () => {
  it('never renders the previous account cached earnings while another account loads', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    client.setQueryData(['commissions'], summary)
    client.setQueryData(['commissions', 'user-a'], summary)
    vi.mocked(request).mockRejectedValue(new ApiError('连接中断', { status: 0, code: 'network_error' }))
    const view = (userId: string) => <QueryClientProvider client={client}><TooltipProvider><CommissionPanel userId={userId} /></TooltipProvider></QueryClientProvider>
    const mounted = render(view('user-a'))
    expect(screen.getByDisplayValue(summary.invitation_url)).toBeTruthy()
    mounted.rerender(view('user-b'))
    expect(screen.queryByDisplayValue(summary.invitation_url)).toBeNull()
    await waitFor(() => expect(screen.getByText('收益加载失败，请重试。')).toBeTruthy())
  })
  it('isolates earnings and pending operations when the signed-in account changes', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(['commissions'], summary)
    client.setQueryData(['commissions', 'user-a'], summary)
    vi.mocked(request).mockRejectedValue(new ApiError('连接中断', { status: 0, code: 'network_error' }))
    const view = (userId: string) => <QueryClientProvider client={client}><TooltipProvider><CommissionPanel userId={userId} /></TooltipProvider></QueryClientProvider>
    const mounted = render(view('user-a'))
    await userEvent.type(screen.getByLabelText('操作金额（元）'), '20')
    await userEvent.click(screen.getByRole('button', { name: '转使用余额' }))
    await userEvent.click(screen.getByRole('button', { name: '确认提交' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    mounted.rerender(view('user-b'))
    expect(screen.queryByDisplayValue(summary.invitation_url)).toBeNull()
    await waitFor(() => expect(screen.getByText('收益加载失败，请重试。')).toBeTruthy())
    vi.mocked(request).mockResolvedValue(summary)
    mounted.rerender(view('user-a'))
    await waitFor(() => expect(screen.getByLabelText('操作金额（元）')).toBeTruthy())
    expect((screen.getByLabelText('操作金额（元）') as HTMLInputElement).value).toBe('')
  })
  for (const [kind, label, amount] of [['bd', 'BD 消费分佣', '¥20.00'], ['developer', '插件开发者利润分佣', '¥16.00']] as const) {
    it(`${kind} sees the earned amount and maturity without internal cost calculations`, async () => {
      mount(false, kind)
      await userEvent.click(screen.getByText('最近收益流水'))
      expect(screen.getByText(label)).toBeTruthy()
      expect(screen.getByRole('cell', { name: amount })).toBeTruthy()
      expect(screen.getByText('可用时间')).toBeTruthy()
      expect(screen.queryByText(/实际接口成本|本金占比|分佣计算明细/)).toBeNull()
    })
  }
  it('BD wallet view shows the identity, invitation link and cumulative BD commission', () => {
    mount(false, 'bd')
    expect(screen.getByText('当前身份：')).toBeTruthy()
    expect(screen.getByText('BD')).toBeTruthy()
    expect(screen.getByText(/你是 BD：通过此链接注册的用户/)).toBeTruthy()
    expect(screen.getByText('BD 消费分佣累计')).toBeTruthy()
    expect(screen.queryByText('开发者利润分佣累计')).toBeNull()
  })
  it('developer view frames the shared account for the developer centre and attributes rows to plugins', async () => {
    mount(false, 'developer', 'developer')
    expect(screen.getByRole('heading', { name: '开发者收益账户' })).toBeTruthy()
    expect(screen.getByText('插件开发者')).toBeTruthy()
    expect(screen.queryByDisplayValue(summary.invitation_url)).toBeNull()
    expect(screen.getByText('开发者利润分佣累计')).toBeTruthy()
    await userEvent.click(screen.getByText('最近收益流水'))
    expect(screen.getByText('海报插件')).toBeTruthy()
  })
  it('ordinary users are told BD and developer access is invitation-only', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['commissions', 'fixture'], { ...summary, profile: { bd_active: false }, earned: {} })
    render(<QueryClientProvider client={client}><TooltipProvider><CommissionPanel userId="fixture" /></TooltipProvider></QueryClientProvider>)
    expect(screen.getByText('普通邀请人')).toBeTruthy()
    expect(screen.getByText('BD 与插件开发者由平台管理员邀请开通。')).toBeTruthy()
  })
  it('shows invitation, threshold, observation period and freezes both financial actions', () => {
    mount(true)
    expect(screen.getByDisplayValue(summary.invitation_url)).toBeTruthy()
    expect(screen.getByText(/累计净充值超过 10 元/)).toBeTruthy()
    expect(screen.getByText(/BD 取得付费消费的 20% · 插件开发者取得剩余利润的 40%/)).toBeTruthy()
    expect(screen.getByText(/开发者收益待成本确认后补计/)).toBeTruthy()
    expect(screen.queryByText(/一年|活动/)).toBeNull()
    expect(screen.getByText(/收益观察 30 天/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '转使用余额' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('button', { name: '申请提现' }).getAttribute('aria-disabled')).toBe('true')
  })
  it('requires confirmation and reuses the same key after an uncertain response', async () => {
    mount()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('操作金额（元）'), '20')
    await user.click(screen.getByRole('button', { name: '转使用余额' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    vi.mocked(request).mockImplementation(async (path) => {
      if (path.endsWith('/convert')) throw new ApiError('连接中断', { status: 0, code: 'network_error' })
      return summary
    })
    await user.click(screen.getByRole('button', { name: '确认提交' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const first = vi.mocked(request).mock.calls.find(([path]) => path.endsWith('/convert'))
    expect(first?.[1]?.body).toMatchObject({ amount_cny: '20' })
    vi.mocked(request).mockImplementation(async path => path.endsWith('/convert') ? { state: 'applied' } : summary)
    await user.click(screen.getByRole('button', { name: '转使用余额' }))
    await user.click(screen.getByRole('button', { name: '确认提交' }))
    await waitFor(() => expect(screen.getByText('已转入平台使用余额。')).toBeTruthy())
    const writes = vi.mocked(request).mock.calls.filter(([path]) => path.endsWith('/convert'))
    expect(writes).toHaveLength(2)
    expect(writes[1]?.[1]?.body).toEqual(writes[0]?.[1]?.body)
  })
  it('rejects a payout below 100 before sending a financial request', async () => {
    mount()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('操作金额（元）'), '99')
    await user.click(screen.getByRole('button', { name: '申请提现' }))
    expect(screen.getByRole('alert').textContent).toContain('至少 100 元')
    expect(vi.mocked(request).mock.calls.filter(([path]) => path.endsWith('/payouts'))).toHaveLength(0)
  })
})
