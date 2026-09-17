import { useEffect, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'
import { ExternalLink, LogIn } from 'lucide-react'
import { Button, Dialog, DialogContent, Input, cn, focusRing, buttonVariants } from '@/ui'
import { ApiError, isMock, request, type Wallet } from '@/shared/api'
import { qk, queryClient } from '@/shared/query'
import { VOUCHER_ERRORS, formatPoints } from './lib'

export const WALLET_KEY = ['account', 'wallet'] as const
export interface AccountWallet extends Wallet { frozen_cny?: string; entries?: { created_at: string; kind: string; amount_points: string }[] }

// Mock (`?mock=1`): balance in localStorage['ipzsk.mock.points'] (same as the studio); code IPZSK-1000 adds 1000 点, anything else is unavailable.
const MOCK_POINTS = 'ipzsk.mock.points'
const mockPoints = () => Number(localStorage.getItem(MOCK_POINTS) ?? 1000)
async function mockRedeem(code: string) {
  await new Promise(r => setTimeout(r, 400))
  if (code.toUpperCase() !== 'IPZSK-1000') throw new ApiError(VOUCHER_ERRORS.voucher_unavailable!, { status: 400, code: 'voucher_unavailable' })
  localStorage.setItem(MOCK_POINTS, String(mockPoints() + 1000))
  return { amount_points: '1000.00000000' }
}

/** null = signed out (401/403), matching recharge.js / points-wallet.js. `onUnauthorized` runs on 401 (the account page signs out). */
export async function fetchWallet(onUnauthorized?: () => void): Promise<AccountWallet | null> {
  if (isMock) return { available_points: mockPoints().toFixed(8), frozen_points: '0.00000000' }
  try { return await request<AccountWallet>('/api/me/wallet') }
  catch (e) { if (e instanceof ApiError && (e.status === 401 || e.status === 403)) { if (e.status === 401) onUnauthorized?.(); return null } throw e }
}

/** App-wide open state so the composer and the header points pill open the same dialog (host: <RechargeHost/> in the site header). */
export const useRechargeDialog = create<{ open: boolean }>(() => ({ open: false }))
export const openRecharge = () => useRechargeDialog.setState({ open: true })
export function RechargeHost() {
  const open = useRechargeDialog(s => s.open)
  return <RechargeDialog open={open} onOpenChange={o => useRechargeDialog.setState({ open: o })} />
}

// Port of recharge.js, shared by /account and the studio (in-app, no navigation). Money path (§6 exception): never optimistic, wait for the server, then refresh.
export function RechargeDialog({ open, onOpenChange, onUnauthorized }: { open: boolean; onOpenChange: (o: boolean) => void; onUnauthorized?: () => void }) {
  const wallet = useQuery({ queryKey: WALLET_KEY, queryFn: () => fetchWallet(onUnauthorized), enabled: open, refetchOnWindowFocus: true })
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const signedOut = wallet.data === null

  useEffect(() => { if (open) { setNotice(null); void wallet.refetch() } else setCode('') }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  async function redeem(e: FormEvent) {
    e.preventDefault()
    if (busy || signedOut) return
    const value = code.trim()
    if (!value) { setNotice({ text: '请输入兑换码。', error: true }); return }
    setBusy(true); setNotice({ text: '正在兑换…' })
    try {
      const data: { replayed?: boolean; amount_points: string } = isMock ? await mockRedeem(value) : await request('/api/me/vouchers/redeem', { body: { code: value } })
      setCode('')
      const text = data.replayed ? '这枚码已兑换到你的账户，未重复入账。' : '兑换成功，已到账 ' + formatPoints(data.amount_points) + '。'
      setNotice({ text })
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['account'] }), queryClient.invalidateQueries({ queryKey: qk.wallet })])
      const balance = queryClient.getQueryData<AccountWallet | null>(WALLET_KEY)?.available_points
      if (balance != null) setNotice({ text: text + '当前余额 ' + formatPoints(balance) + '。' })
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { queryClient.setQueryData(WALLET_KEY, null); onUnauthorized?.(); setNotice({ text: '登录已失效，请登录后再兑换。', error: true }) }
      else if (err instanceof ApiError && err.status !== 0) setNotice({ text: VOUCHER_ERRORS[err.code] ?? '兑换未成功，请稍后重试。', error: true })
      else setNotice({ text: '网络异常，暂未确认兑换结果。可使用同一码重试，不会重复入账。', error: true })
    } finally { setBusy(false) }
  }

  const available = wallet.data ? Number(wallet.data.available_points) : 0
  const frozen = wallet.data ? Number(wallet.data.frozen_points) : 0
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="充值 / 兑换" description="IPZSK · 账户点数" className="max-w-lg">
        <div className="grid gap-4">
          <div className="rounded-card bg-ink p-5 text-card">
            <p className="text-xs text-card/70">剩余可用点数</p>
            <p className="mt-1 text-[28px] font-black tabular-nums text-acid" aria-live="polite">
              {wallet.isPending ? '正在读取…' : wallet.isError ? '暂时无法读取' : signedOut ? '登录后查看' : formatPoints(wallet.data!.available_points)}
            </p>
            <p className="mt-1 text-xs text-card/70">
              {wallet.isError ? '可稍后重新打开面板刷新' : !wallet.data ? '' : frozen > 0 ? '处理中冻结 ' + formatPoints(frozen) : available <= 0 ? '兑换充值码后即可使用' : '网页与客户端实时共用'}
            </p>
          </div>
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line p-4">
            <div className="min-w-0 flex-1">
              <h3 className="font-bold">购买充值码</h3>
              <p className="mt-1 text-[13px] text-muted">前往商城购买，付款获得兑换码后，返回这里兑换。</p>
            </div>
            <a className={buttonVariants({ variant: 'secondary', size: 'sm' })} href="https://store.wayneinsightspring.com/" target="_blank" rel="noopener noreferrer">
              购买充值码<ExternalLink aria-hidden />
            </a>
          </section>
          <form onSubmit={redeem} className="grid gap-2 rounded-card border border-line p-4">
            <h3 className="font-bold">已有兑换码</h3>
            <div className="flex items-start gap-2 max-sm:flex-col max-sm:items-stretch">
              <div className="min-w-0 flex-1">
                <Input label="兑换码" name="code" placeholder="输入或粘贴兑换码" required maxLength={100} autoComplete="off" spellCheck={false}
                  value={code} onChange={e => setCode(e.target.value)} readOnly={busy} disabled={signedOut} disabledReason="请先登录" />
              </div>
              <Button type="submit" variant="primary" className="sm:mt-[25.5px]" loading={busy} loadingText="兑换中"
                disabled={signedOut} disabledReason="请先登录，兑换的点数会存入你的账户">确认兑换</Button>
            </div>
            {signedOut && (
              <p className="text-[13px] text-muted">请先登录，兑换的点数会存入你的账户。
                <a href="/account?next=recharge" className={cn('ml-1 inline-flex items-center gap-1 font-semibold text-label underline underline-offset-4', focusRing)}>登录后兑换<LogIn aria-hidden className="size-3.5" /></a>
              </p>
            )}
            {notice && <p role={notice.error ? 'alert' : 'status'} aria-live="polite" className={cn('text-sm', notice.error ? 'text-danger' : 'text-success')}>{notice.text}</p>}
          </form>
          <p className="text-xs leading-5 text-muted">10 元 = 1,000 点 · 50 元 = 5,000 点<br />网页与客户端共用点数，购买后需使用兑换码到账。</p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
