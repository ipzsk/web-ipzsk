import { useRef, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge, Button, Dialog, DialogContent, DialogFooter, ErrorState, Input, Skeleton } from '@/ui'
import { ApiError, request } from '@/shared/api'
import { queryClient } from '@/shared/query'
import { formatMoney } from '@/shared/billing'

interface Transaction {
  readonly id: string
  readonly amount_cny: string
  readonly state: string
  readonly created_at: string
}
interface CommissionSummary {
  readonly invitation_url: string
  readonly referrals: number
  readonly profile: { readonly bd_active: boolean }
  /** The caller's own developer profile; null when never invited. */
  readonly developer: { readonly state: string; readonly display_name: string } | null
  readonly policy: { readonly bd_share_bps: number; readonly developer_share_bps: number; readonly developer_basis: 'remaining_profit'; readonly active: boolean }
  readonly balance: { readonly total_cny: string; readonly available_cny: string; readonly withdrawable_cny: string; readonly frozen: boolean }
  /** Lifetime accrual per source, net of refunds. Missing key = nothing earned from that source. */
  readonly earned: { readonly bd?: string; readonly developer?: string; readonly invitation?: string }
  readonly ledger: readonly { readonly kind: string; readonly amount_cny: string; readonly created_at: string; readonly available_at: string; readonly request_id?: string | null; readonly plugin_name?: string | null }[]
  readonly payouts: readonly Transaction[]
  readonly conversions: readonly Transaction[]
}
/** wallet: invitation and earnings centre on the home page. developer: the same shared account, framed for the developer centre. */
type View = 'wallet' | 'developer'
const labels: Readonly<Record<string, string>> = {
  bd: 'BD 消费分佣', developer: '插件开发者利润分佣', invitation: '邀请奖励', conversion: '转使用余额', payout: '提现',
  requested: '待审核', approved: '待人工转账', paid: '已打款', cancelled: '已取消', pending: '待转入', applying: '正在转入', applied: '已转入', review: '待人工核对',
}
const errors: Readonly<Record<string, string>> = {
  insufficient_earnings: '可用收益不足，请检查观察期及提现中的金额。', earnings_frozen: '收益正在核对，请联系平台处理。',
  payout_minimum_or_precision: '单笔提现至少 100 元，最多两位小数。', conversion_minimum: '转余额至少 0.01 元。',
  idempotency_conflict: '这笔操作已有记录，请先核对下方记录。',
}
type Action = 'convert' | 'payouts'
interface Attempt { readonly action: Action; readonly amount: string; readonly key: string }

export function CommissionPanel({ userId, view = 'wallet' }: { readonly userId: string; readonly view?: View }) {
  return <CommissionAccountPanel key={userId} userId={userId} view={view} />
}

function CommissionAccountPanel({ userId, view }: { readonly userId: string; readonly view: View }) {
  const summary = useQuery({ queryKey: ['commissions', userId], queryFn: () => request<CommissionSummary>('/api/me/commissions') })
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState<Action | null>(null)
  const [notice, setNotice] = useState<{ readonly text: string; readonly error: boolean } | null>(null)
  const attempt = useRef<Attempt | null>(null)
  const data = summary.data
  const percent = (bps: number) => `${bps / 100}%`

  function propose(action: Action) {
    if (busy || data?.balance.frozen) return
    const valid = /^(0|[1-9]\d{0,8})(\.\d{1,8})?$/.test(value) && Number(value) >= (action === 'convert' ? 0.01 : 100)
    if (!valid || (action === 'payouts' && !/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(value))) {
      setNotice({ text: action === 'convert' ? '请输入至少 0.01 元，最多八位小数。' : '请输入至少 100 元，最多两位小数。', error: true })
      return
    }
    if (attempt.current && (attempt.current.action !== action || attempt.current.amount !== value)) {
      setNotice({ text: '上一笔结果尚未确认。请先核对记录，或用原金额重试同一操作。', error: true }); return
    }
    setConfirmation(action)
  }

  async function submit() {
    if (!confirmation || busy) return
    const action = confirmation
    const item = attempt.current ?? { action, amount: value, key: crypto.randomUUID() }
    attempt.current = item
    setBusy(true); setNotice(null)
    try {
      const body = { amount_cny: item.amount, idempotency_key: item.key }
      const result = action === 'convert'
        ? await request<Transaction>('/api/me/commissions/convert', { body })
        : await request<Transaction>('/api/me/commissions/payouts', { body })
      attempt.current = null; setValue(''); setConfirmation(null)
      setNotice({ text: action === 'convert' ? (result.state === 'applied' ? '已转入平台使用余额。' : '转入申请已提交，请以下方记录为准。') : '提现申请已提交，平台审核后人工转账。', error: false })
      await Promise.all([summary.refetch(), queryClient.invalidateQueries({ queryKey: ['wallet'] })])
    } catch (error) {
      if (!(error instanceof Error)) throw error
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.code !== 'idempotency_conflict') attempt.current = null
      setNotice({ text: error instanceof ApiError ? errors[error.code] ?? '操作结果待确认，请刷新记录或按原金额重试。' : error.message, error: true })
      setConfirmation(null)
      await summary.refetch()
    } finally { setBusy(false) }
  }

  function formSubmit(event: FormEvent) { event.preventDefault(); propose('convert') }

  const bd = !!data?.profile.bd_active
  const developer = data?.developer?.state === 'approved'
  const identity = [bd && 'BD', developer && '插件开发者'].filter(Boolean).join(' · ') || '普通邀请人'
  const earned = data ? ([['bd', 'BD 消费分佣累计', bd], ['developer', '开发者利润分佣累计', developer], ['invitation', '邀请奖励累计', view === 'wallet']] as const)
    .filter(([kind, , show]) => show || data.earned[kind] !== undefined).map(([kind, label]) => [label, data.earned[kind] ?? '0'] as const) : []

  return <section className="mt-5 rounded-panel border border-line bg-card p-6 md:p-8" aria-labelledby="commission-title">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="commission-title" className="text-lg font-bold">{view === 'developer' ? '开发者收益账户' : '邀请与收益'}</h2><Button size="sm" variant="secondary" onClick={() => void summary.refetch()}>核对记录</Button></div>
    <p className="mt-2 text-sm leading-6 text-muted">{view === 'developer'
      ? '开发者利润分佣与 BD 分佣、邀请奖励进入同一个收益账户，余额、提现和转余额共用。规则不设期限；赠送额度不分佣。'
      : '邀请的新用户累计净充值超过 10 元，奖励 5 元，每人一次。BD 和插件开发者按有效付费 API 消费分佣，规则不设期限；赠送额度不分佣。'}</p>
    {summary.isPending ? <Skeleton className="mt-5 h-32" /> : summary.isError ? <ErrorState reason="收益加载失败，请重试。" action={{ label: '重试', onClick: () => void summary.refetch() }} /> : data && <>
      <p className="mt-4 flex flex-wrap items-center gap-2 text-sm">当前身份：<Badge tone={bd || developer ? 'success' : 'outline'}>{identity}</Badge>
        {!bd && !developer && <span className="text-muted">BD 与插件开发者由平台管理员邀请开通。</span>}</p>
      {view === 'wallet' && <label className="mt-5 block text-sm font-medium">我的邀请链接（已邀请 {data.referrals} 人）<Input className="mt-2" value={data.invitation_url} readOnly onFocus={event => event.currentTarget.select()} /></label>}
      {view === 'wallet' && bd && <p className="mt-2 text-sm text-muted">你是 BD：通过此链接注册的用户产生有效付费 API 消费后，你取得其中的 {percent(data.policy.bd_share_bps)}。</p>}
      <p className="mt-2 text-sm text-muted">分佣规则{data.policy.active ? '已启用' : '暂未启用'} · BD 取得付费消费的 {percent(data.policy.bd_share_bps)} · 插件开发者取得剩余利润的 {percent(data.policy.developer_share_bps)}</p>
      <p className="mt-1 text-xs leading-5 text-muted">剩余利润 = 付费消费 − 对应的实际上游成本 − BD 分佣，不低于 0。上游成本确认前，BD 收益照常计提，开发者收益待成本确认后补计。</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">{[['收益余额', data.balance.total_cny], ['可转使用余额', data.balance.available_cny], ['本月可申请提现', data.balance.withdrawable_cny]].map(([label, amount]) => <div key={label}><p className="text-xs text-muted">{label}</p><p className="mt-1 text-xl font-bold tabular-nums">{formatMoney(amount, true)}</p></div>)}</div>
      {earned.length > 0 && <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">{earned.map(([label, amount]) => <div key={label} className="flex gap-2"><dt className="text-muted">{label}</dt><dd className="tabular-nums">{formatMoney(amount, true)}</dd></div>)}</dl>}
      <p className="mt-3 text-xs leading-5 text-muted">收益观察 30 天。上月已成熟收益按月结算，提现至少 100 元，平台审核后每月 15 日人工转账（非工作日顺延）。转为使用余额至少 0.01 元，转入后不能退回或再次分佣。</p>
      {data.balance.frozen && <p role="status" className="mt-3 text-sm text-danger">收益正在核对，转余额与提现暂时冻结。请联系平台。</p>}
      <form className="mt-5 flex flex-wrap items-end gap-3" onSubmit={formSubmit}>
        <label className="grid gap-2 text-sm">操作金额（元）<Input inputMode="decimal" value={value} onChange={event => setValue(event.currentTarget.value)} disabled={busy} /></label>
        <Button type="submit" disabled={busy || data.balance.frozen}>转使用余额</Button><Button type="button" variant="secondary" disabled={busy || data.balance.frozen} onClick={() => propose('payouts')}>申请提现</Button>
      </form>
      {notice && <p role={notice.error ? 'alert' : 'status'} className="mt-3 text-sm">{notice.text}</p>}
      <details className="mt-5 border-t border-line pt-4"><summary className="cursor-pointer font-medium">转余额与提现记录</summary>
        {[...data.conversions, ...data.payouts].length === 0 ? <p className="mt-3 text-sm text-muted">还没有申请记录。</p> : <ul className="mt-3 grid gap-3 text-sm">{[...data.conversions, ...data.payouts].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(row => <li key={row.id}><strong>{formatMoney(row.amount_cny, true)}</strong> · {labels[row.state] ?? '待核对'}<small className="block text-muted">{new Date(row.created_at).toLocaleString('zh-CN')} · {row.id}</small></li>)}</ul>}
      </details>
      <details className="mt-4 border-t border-line pt-4"><summary className="cursor-pointer font-medium">最近收益流水</summary>
        {data.ledger.length === 0 ? <p className="mt-3 text-sm text-muted">还没有收益流水。</p> : <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead><tr><th className="py-2">项目</th><th>金额（元）</th><th>来源</th><th>时间</th><th>可用时间</th></tr></thead><tbody>{data.ledger.map((row, index) => <tr key={index} className="border-t border-line"><td className="py-2">{labels[row.kind] ?? row.kind}</td><td className="tabular-nums">{formatMoney(row.amount_cny, true)}</td><td className="text-muted">{row.plugin_name ?? (row.request_id ? '请求 ' + row.request_id.slice(0, 8) : '—')}</td><td>{new Date(row.created_at).toLocaleString('zh-CN')}</td><td>{new Date(row.available_at).toLocaleString('zh-CN')}</td></tr>)}</tbody></table></div>}
      </details>
    </>}
    <Dialog open={confirmation !== null} onOpenChange={open => { if (!open && !busy) setConfirmation(null) }}><DialogContent title={confirmation === 'convert' ? '确认转为使用余额' : '确认申请提现'} description={confirmation === 'convert' ? `${value} 元将转入平台使用余额，转入后不能退回收益余额，也不能再提现。` : `申请提现 ${value} 元，审核期间该金额会冻结，请联系平台核对收款信息。`}><DialogFooter><Button variant="secondary" disabled={busy} onClick={() => setConfirmation(null)}>取消</Button><Button loading={busy} loadingText="正在提交" onClick={() => void submit()}>确认提交</Button></DialogFooter></DialogContent></Dialog>
  </section>
}
