import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'
import { ExternalLink, LogIn } from 'lucide-react'
import { Button, Dialog, DialogContent, cn, focusRing } from '@/ui'
import { ApiError, isMock, request, type Wallet } from '@/shared/api'
import {
  createCheckout, formatMoney, hasPendingPayment, paymentStates,
  type PaymentOptions, type PaymentOrders,
} from '@/shared/billing'

export const WALLET_KEY = ['account', 'wallet'] as const
export type AccountWallet = Wallet

/** null = signed out (401/403). `onUnauthorized` runs on 401 so the account page can return to login. */
export async function fetchWallet(onUnauthorized?: () => void): Promise<AccountWallet | null> {
  if (isMock) return { available_cny: '10.00', frozen_cny: '0.00', available_points: '1000.00000000', frozen_points: '0.00000000' }
  try { return await request<AccountWallet>('/api/me/wallet') }
  catch (e) { if (e instanceof ApiError && (e.status === 401 || e.status === 403)) { if (e.status === 401) onUnauthorized?.(); return null } throw e }
}

/** App-wide state: the studio header and composer open the same online-recharge dialog. */
export const useRechargeDialog = create<{ open: boolean }>(() => ({ open: false }))
export const openRecharge = () => useRechargeDialog.setState({ open: true })
export function RechargeHost() {
  const open = useRechargeDialog(s => s.open)
  return <RechargeDialog open={open} onOpenChange={o => useRechargeDialog.setState({ open: o })} />
}

export function RechargeDialog({ open, onOpenChange, onUnauthorized }: { open: boolean; onOpenChange: (o: boolean) => void; onUnauthorized?: () => void }) {
  const wallet = useQuery({ queryKey: WALLET_KEY, queryFn: () => fetchWallet(onUnauthorized), enabled: open, refetchOnWindowFocus: true })
  const signedIn = wallet.data != null
  const options = useQuery({
    queryKey: ['account', 'payment-options'], enabled: open && signedIn && !isMock,
    queryFn: () => request<PaymentOptions>('/api/me/payments/options'),
  })
  const orders = useQuery({
    queryKey: ['account', 'payment-orders'], enabled: open && signedIn && !isMock,
    queryFn: () => request<PaymentOrders>('/api/me/payments/orders'),
    refetchInterval: query => hasPendingPayment(query.state.data?.rows) ? 5_000 : false,
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)

  useEffect(() => {
    if (!open) { setBusy(null); setNotice(null); return }
    void wallet.refetch()
    if (new URLSearchParams(location.search).get('payment') === 'return') {
      setNotice({ text: '已返回网站，请以下方充值记录为准。支付核实后余额会自动增加。' })
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  async function checkout(pack: string) {
    if (busy) return
    setBusy(pack); setNotice({ text: '正在前往 Waffo 微信收银台…' })
    try { location.assign(await createCheckout(pack)) }
    catch (error) {
      const e = error as ApiError
      const messages: Record<string, string> = {
        payment_email_unavailable: '账户邮箱不可用，请重新登录或联系客服。',
        payment_checkout_already_requested: '充值请求已提交，请先查看充值记录。',
        online_payment_unavailable: '在线充值暂不可用，请稍后再试。',
        rate_limited: '操作太频繁，请稍后再试。',
      }
      setNotice({ text: messages[e.code] ?? e.message ?? '暂时无法打开收银台，请稍后重试。', error: true })
      setBusy(null)
      await orders.refetch()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="在线充值" description="IPZSK · 人民币账户余额" className="max-w-lg">
        <div className="grid gap-4">
          <div className="rounded-card bg-ink p-5 text-card">
            <p className="text-xs text-card/70">可用余额 · 人民币</p>
            <p className="mt-1 text-[28px] font-black tabular-nums text-white" aria-live="polite">
              {wallet.isPending ? '正在读取…' : wallet.isError ? '暂时无法读取' : wallet.data === null ? '登录后查看' : formatMoney(wallet.data.available_cny)}
            </p>
            <p className="mt-1 text-xs text-card/70">用于 AI 生图、生视频及平台付费服务，余额不支持提现。</p>
          </div>

          {wallet.data === null ? (
            <p className="rounded-card border border-line p-4 text-sm text-muted">请先登录，充值金额会自动进入你的账户。
              <a href="/account?next=recharge" className={cn('ml-1 inline-flex items-center gap-1 font-semibold text-label underline underline-offset-4', focusRing)}>登录 / 注册<LogIn aria-hidden className="size-3.5" /></a>
            </p>
          ) : (
            <section className="rounded-card border border-line p-4">
              <div className="flex items-center justify-between gap-3">
                <div><h3 className="font-bold">选择充值金额</h3><p className="mt-1 text-[13px] text-muted">微信支付 · 一次性购买，不自动续费</p></div>
                <ExternalLink aria-hidden className="text-muted" />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {(options.data?.enabled ? options.data.packs : []).map(pack => (
                  <Button key={pack.key} variant="secondary" className="h-auto min-h-16 flex-col" loading={busy === pack.key} loadingText="跳转中"
                    disabled={!!busy} disabledReason="正在打开收银台" onClick={() => void checkout(pack.key)}>
                    <strong className="text-lg">{formatMoney(pack.amount_cny)}</strong><small className="font-normal">到账同额余额</small>
                  </Button>
                ))}
              </div>
              {options.isPending && <p className="mt-3 text-sm text-muted">正在读取充值档位…</p>}
              {options.isError && <p role="alert" className="mt-3 text-sm text-danger">充值选项加载失败，请稍后重试。</p>}
              {options.data && !options.data.enabled && <p className="mt-3 text-sm text-muted">在线充值暂未开放。</p>}
              {options.data?.mode === 'test' && <p className="mt-3 text-sm text-warning">管理员测试环境：测试付款不会增加正式可消费额度。</p>}
              <p className="mt-3 text-xs leading-5 text-muted">点击金额后将前往 Waffo 收银台，自动带入登录邮箱，账单国家默认为中国。当前人民币渠道为微信支付。</p>
            </section>
          )}

          {notice && <p role={notice.error ? 'alert' : 'status'} className={cn('text-sm', notice.error ? 'text-danger' : 'text-success')}>{notice.text}</p>}

          {!!orders.data?.rows.length && (
            <details className="rounded-card border border-line p-4">
              <summary className={cn('cursor-pointer font-bold', focusRing)}>最近充值记录</summary>
              <ul className="mt-3 grid gap-2 text-sm text-muted">
                {orders.data.rows.slice(0, 5).map(order => (
                  <li key={order.id} className="border-t border-line pt-2 first:border-0 first:pt-0">
                    <span className="font-semibold text-ink">{formatMoney(order.amount_cny)}</span> · {paymentStates[order.state] ?? '状态待确认'}
                    <small className="mt-1 block">{new Date(order.created_at).toLocaleString('zh-CN')}{order.mode === 'test' ? ' · 测试' : ''}</small>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
