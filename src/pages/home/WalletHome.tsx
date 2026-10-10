import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, RefreshCw, Wallet } from 'lucide-react'
import { Button, EmptyState, ErrorState, Skeleton, cn, focusRing } from '@/ui'
import { request } from '@/shared/api'
import {
  createCheckout, formatMoney, hasPendingPayment, paymentStates,
  type PaymentOptions, type PaymentOrders,
} from '@/shared/billing'
import { queryClient, useCurrentUser, useWallet } from '@/shared/query'
import { CommissionPanel } from './CommissionPanel'

interface UsageRow { id: string; model: string; created_at: string; charged_cny: string | null; billing_state?: string }
interface Usage { rows: UsageRow[] }

export function WalletHome() {
  const user = useCurrentUser()
  const signedIn = !!user.data
  const wallet = useWallet(signedIn)
  const usage = useQuery({ queryKey: ['home', 'usage'], enabled: signedIn, queryFn: () => request<Usage>('/api/me/usage') })
  const options = useQuery({ queryKey: ['account', 'payment-options'], enabled: signedIn, queryFn: () => request<PaymentOptions>('/api/me/payments/options') })
  const orders = useQuery({
    queryKey: ['account', 'payment-orders'], enabled: signedIn,
    queryFn: () => request<PaymentOrders>('/api/me/payments/orders'),
    refetchInterval: query => hasPendingPayment(query.state.data?.rows) ? 5_000 : false,
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(
    new URLSearchParams(location.search).get('payment') === 'return'
      ? { text: '已返回网站，请以下方充值记录为准。支付核实后余额会自动增加。' }
      : null,
  )

  async function refresh() {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ['wallet'] }),
      queryClient.refetchQueries({ queryKey: ['home', 'usage'] }),
      queryClient.refetchQueries({ queryKey: ['account', 'payment-orders'] }),
      queryClient.refetchQueries({ queryKey: ['account', 'payment-options'] }),
    ])
  }

  async function checkout(pack: string) {
    if (busy) return
    setBusy(pack); setNotice({ text: '正在前往 Waffo 微信收银台…' })
    try { location.assign(await createCheckout(pack)) }
    catch (error) {
      setBusy(null)
      setNotice({ text: (error as Error).message || '暂时无法打开收银台，请稍后重试。', error: true })
      await orders.refetch()
    }
  }

  if (user.isPending) return <main className="mx-auto grid min-h-[calc(100svh-64px)] w-[min(1180px,calc(100%-28px))] content-start gap-4 py-10 md:w-[min(1180px,calc(100%-80px))]"><Skeleton className="h-10 w-56" /><Skeleton className="h-56" /></main>

  return (
    <main className="mx-auto min-h-[calc(100svh-64px)] w-[min(1180px,calc(100%-28px))] py-8 md:w-[min(1180px,calc(100%-80px))] md:py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-xs font-bold tracking-[.12em] text-muted">我的工作台</p><h1 className="mt-2 text-[32px] font-black tracking-[-.04em]">余额、充值与账单</h1></div>
        {signedIn && <Button variant="secondary" size="sm" icon={<RefreshCw />} onClick={() => void refresh()}>刷新</Button>}
      </header>

      {!signedIn ? (
        <section className="mt-6 flex flex-wrap items-center justify-between gap-5 rounded-panel border border-line bg-acid-soft p-6 md:p-8">
          <div><h2 className="text-lg font-bold">登录后，管理你的创作余额与账单。</h2><p className="mt-2 text-sm leading-6 text-muted">新用户完成注册与邮箱验证后赠送 ¥5.00，每位用户限一次。</p></div>
          <a href="/account?next=%2F%23wallet" className={cn('inline-flex h-11 items-center gap-2 rounded-control bg-acid px-5 text-sm font-bold text-white hover:bg-acid-deep', focusRing)}>登录 / 注册<ArrowUpRight aria-hidden /></a>
        </section>
      ) : (
        <>
          <div className="mt-6 grid gap-5 md:grid-cols-[.85fr_1.3fr]">
            <section className="rounded-panel border border-line bg-[linear-gradient(135deg,var(--color-acid-soft),white)] p-6 md:p-8">
              <p className="text-sm text-muted">可用余额 · 人民币</p>
              {wallet.isPending ? <Skeleton className="mt-4 h-12 w-48" /> : wallet.isError ? <ErrorState reason="余额读取失败。" action={{ label: '重试', onClick: () => void wallet.refetch() }} /> : (
                <p className="mt-3 text-[46px] font-black tracking-[-.04em] tabular-nums">{formatMoney(wallet.data?.available_cny)}</p>
              )}
              <p className="mt-4 break-all text-sm">{user.data?.email}</p>
              <p className="mt-2 text-xs leading-5 text-muted">用于 AI 生图、生视频及平台付费服务，余额不支持提现。</p>
              <div className="mt-5 flex gap-4 text-sm font-semibold text-label"><a href="/studio?kind=image">去生图 ↗</a><a href="/studio?kind=video">去生视频 ↗</a></div>
            </section>

            <section className="rounded-panel border border-line bg-card p-6 md:p-8">
              <h2 className="text-lg font-bold">在线充值</h2>
              <p className="mt-2 text-sm text-muted">微信支付 · 付款核实后自动到账</p>
              <div className="mt-5 grid grid-cols-3 gap-2">
                {(options.data?.enabled ? options.data.packs : []).map(pack => (
                  <Button key={pack.key} variant="secondary" className="h-auto min-h-20 flex-col" loading={busy === pack.key} loadingText="跳转中" disabled={!!busy} disabledReason="正在打开收银台" onClick={() => void checkout(pack.key)}>
                    <strong className="text-xl">{formatMoney(pack.amount_cny)}</strong><small className="font-normal">到账同额余额</small>
                  </Button>
                ))}
              </div>
              {options.isPending && <p className="mt-4 text-sm text-muted">正在读取充值档位…</p>}
              {options.isError && <p role="alert" className="mt-4 text-sm text-danger">充值选项加载失败，请刷新重试。</p>}
              {options.data && !options.data.enabled && <p className="mt-4 text-sm text-muted">在线充值暂未开放。</p>}
              <p className="mt-4 text-xs leading-5 text-muted">点击金额将前往 Waffo 收银台，自动带入登录邮箱；账单国家默认为中国。一次性购买，不自动续费。</p>
              {notice && <p role={notice.error ? 'alert' : 'status'} className={cn('mt-3 text-sm', notice.error ? 'text-danger' : 'text-success')}>{notice.text}</p>}
            </section>
          </div>

          <section className="mt-5 rounded-panel border border-line bg-card p-6 md:p-8">
            <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">最近消费</h2><a className="text-sm font-semibold text-label" href="/account">全部消费明细 ↗</a></div>
            <p className="mt-2 text-xs text-muted">展示实际人民币扣款；账单回传前显示“待结算”。</p>
            {usage.isPending ? <Skeleton className="mt-5 h-28" /> : usage.isError ? <ErrorState reason="消费记录加载失败。" action={{ label: '重试', onClick: () => void usage.refetch() }} /> : !usage.data?.rows.length ? (
              <EmptyState icon={Wallet} text="还没有消费记录，生成内容后会显示在这里。" />
            ) : (
              <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="text-xs text-muted"><tr><th className="pb-3">模型</th><th className="pb-3">时间</th><th className="pb-3 text-right">扣款（人民币）</th></tr></thead><tbody>
                {usage.data.rows.slice(0, 5).map(row => <tr key={row.id} className="border-t border-line"><td className="py-3">{row.model || '模型调用'}</td><td className="py-3 text-muted">{new Date(row.created_at).toLocaleString('zh-CN')}</td><td className="py-3 text-right tabular-nums">{row.charged_cny != null && ['settled', 'released'].includes(row.billing_state ?? '') ? formatMoney(row.charged_cny, true) : '待结算'}</td></tr>)}
              </tbody></table></div>
            )}
          </section>

          {user.data && <CommissionPanel userId={user.data.id} />}
          <details className="mt-5 rounded-panel border border-line bg-card p-6 md:p-8">
            <summary className={cn('cursor-pointer font-bold', focusRing)}>最近充值记录</summary>
            {!orders.data?.rows.length ? <p className="mt-3 text-sm text-muted">{orders.isPending ? '正在读取…' : '还没有充值记录。'}</p> : <ul className="mt-4 grid gap-3 text-sm">
              {orders.data.rows.slice(0, 5).map(order => <li key={order.id} className="border-t border-line pt-3 first:border-0 first:pt-0"><strong>{formatMoney(order.amount_cny)}</strong> · {paymentStates[order.state] ?? '状态待确认'}<small className="mt-1 block text-muted">{new Date(order.created_at).toLocaleString('zh-CN')}{order.mode === 'test' ? ' · 测试' : ''}</small></li>)}
            </ul>}
          </details>
        </>
      )}
    </main>
  )
}
