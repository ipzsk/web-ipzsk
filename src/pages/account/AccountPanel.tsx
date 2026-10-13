import { useReducer, useState, type ReactNode } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Copy, Download, FolderOpen, Image, KeyRound, LogOut, RefreshCw, TriangleAlert, Wallet } from 'lucide-react'
import { Badge, Button, Dialog, DialogContent, DialogFooter, EmptyState, ErrorState, Input, Skeleton, cn, focusRing, toast } from '@/ui'
import { qk, queryClient } from '@/shared/query'
import { formatMoney } from '@/shared/billing'
import {
  USAGE_STATUS, activeTokenCount, call, tokenInitial, tokenReducer, tokenStatus, usageAmounts,
  type TokenRow, type UsageRow,
} from './lib'
import { WALLET_KEY, fetchWallet } from './Recharge'

export interface Profile { user: { email: string; name?: string | null; email_verified: boolean; created_at: string } }
interface Usage { rows: UsageRow[]; page: number; page_size: number; count: number; summary: { requests: number } }

const usageQuery = (page: number) => ({ queryKey: ['account', 'usage', page], queryFn: () => call<Usage>(page === 1 ? '/api/me/usage' : '/api/me/usage?page=' + page) })
const time = (v: string) => new Date(v).toLocaleString('zh-CN')

function Card({ title, children, className, action }: { title?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={cn('min-w-0 rounded-card border border-line bg-card p-6 max-sm:p-4', className)}>
      {(title || action) && <div className="mb-4 flex items-center justify-between gap-3">{title && <h2 className="text-base font-bold">{title}</h2>}{action}</div>}
      {children}
    </section>
  )
}

function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group min-w-0 rounded-card border border-line bg-card">
      <summary className={cn('flex cursor-pointer list-none items-center gap-2 rounded-card px-6 py-5 font-bold hover:bg-subtle/60 max-sm:px-4 [&::-webkit-details-marker]:hidden', focusRing)}>
        <ChevronRight aria-hidden className="transition-transform duration-(--duration-fast) group-open:rotate-90" />{title}
      </summary>
      <div className="grid gap-4 px-6 pb-6 max-sm:px-4">{children}</div>
    </details>
  )
}

export function AccountPanel({ profile, onRecharge, onSignedOut }: { profile: Profile; onRecharge: () => void; onSignedOut: () => void }) {
  const [page, setPage] = useState(1)
  const [paging, setPaging] = useState<-1 | 1 | null>(null)
  // Legacy refreshPoints: every 30 s + on focus.
  const wallet = useQuery({ queryKey: WALLET_KEY, queryFn: fetchWallet, refetchInterval: 30_000 })
  const usage = useQuery({ ...usageQuery(page), placeholderData: keepPreviousData, refetchInterval: 30_000 })
  const tokens = useQuery({ queryKey: ['account', 'tokens'], queryFn: () => call<{ rows: TokenRow[] }>('/api/me/tokens') })
  const [refreshing, setRefreshing] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const user = profile.user
  const joined = new Date(user.created_at)

  async function goPage(delta: -1 | 1) {
    const target = page + delta
    setPaging(delta)
    try { await queryClient.fetchQuery(usageQuery(target)); setPage(target) }
    catch (e) { toast({ title: (e as Error).message, tone: 'error' }) }
    finally { setPaging(null) }
  }
  async function refresh() {
    setRefreshing(true)
    try { await queryClient.refetchQueries({ queryKey: ['account'] }, { throwOnError: true }) }
    catch (e) { toast({ title: (e as Error).message || '刷新失败', description: '请稍后再点刷新。', tone: 'error' }) }
    finally { setRefreshing(false) }
  }
  async function logout() {
    setLoggingOut(true)
    try {
      await call('/api/auth/sign-out', {})
      queryClient.setQueryData(qk.me, null); queryClient.setQueryData(qk.wallet, null)
      onSignedOut()
    } catch (e) { toast({ title: (e as Error).message, tone: 'error' }); setLoggingOut(false) }
  }

  const w = wallet.data
  const available = w ? Number(w.available_cny) : 0
  return (
    <div className="grid min-w-0 grid-cols-1 gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[32px] font-black tracking-[-.5px] max-sm:text-[26px]">个人中心</h1>
          <p className="mt-1 text-sm text-muted">管理个人资料、创作内容与账户收支。</p>
          <p className="mt-3 break-all text-sm">{user.email}</p>
        </div>
        <Button variant="secondary" size="sm" icon={<LogOut />} loading={loggingOut} loadingText="正在退出" onClick={() => void logout()}>退出登录</Button>
      </header>

      <Card title="账号资料">
        <dl className="grid grid-cols-3 gap-4 max-sm:grid-cols-1">
          {[['显示名称', user.name || '未设置'], ['邮箱状态', user.email_verified ? '已验证' : '未验证'], ['注册时间', Number.isNaN(joined.getTime()) ? '暂无记录' : joined.toLocaleDateString('zh-CN')]].map(([k, v]) => (
            <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="mt-1.5 text-sm">{v}</dd></div>
          ))}
        </dl>
      </Card>

      <nav aria-label="我的内容" className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
        {([['/workspace', '我的内容工作台', '选题、草稿与排版 · 本机保存', FolderOpen], ['/workspace#images', '我的图片', '查看当前账号的云端图片', Image], ['/#downloads', '下载客户端', '查看最新正式版', Download]] as const).map(([href, title, sub, Icon]) => (
          <a key={href} href={href} className={cn('group flex items-start gap-3 rounded-card border border-line bg-card p-5 transition-[transform,box-shadow,border-color] duration-(--duration-fast) hover:border-muted hover:shadow-md motion-safe:hover:-translate-y-px active:scale-[.99]', focusRing)}>
            <Icon aria-hidden className="mt-0.5 size-[18px] text-label" />
            <span><strong className="block text-sm">{title}</strong><small className="mt-1 block text-xs text-muted">{sub}</small></span>
          </a>
        ))}
      </nav>

      <div className="grid grid-cols-2 gap-5 max-md:grid-cols-1">
        <Card title="可用余额" action={<Button variant="ghost" size="sm" icon={<RefreshCw />} loading={refreshing} loadingText="刷新中" onClick={() => void refresh()}>刷新</Button>}>
          {wallet.isPending ? <Skeleton className="h-10 w-48" /> : wallet.isError ? (
            <ErrorState reason="暂时无法读取余额。" action={{ label: '重试', onClick: () => void wallet.refetch() }} />
          ) : w && <>
            <p className="text-[40px] font-black leading-tight tabular-nums text-ink max-sm:text-[32px]">{formatMoney(w.available_cny)}</p>
            {Number(w.frozen_cny) !== 0 && <p className="mt-2 text-sm text-muted">处理中冻结 {formatMoney(w.frozen_cny)}</p>}
            <p className="mt-2 text-sm text-muted">{available > 0 ? `已使用 ${usage.data?.summary.requests ?? '…'} 次 · 网页与客户端共用人民币余额` : '暂无可用余额，请先在线充值后使用。'}</p>
          </>}
        </Card>
        <Card title="在线充值">
          <p className="text-sm text-muted">支持 10 元、50 元、100 元三档微信支付，付款核实后自动到账。</p>
          <Button variant="primary" className="mt-5" icon={<Wallet />} onClick={onRecharge}>选择充值金额</Button>
        </Card>
      </div>

      <Card title="消费记录">
        {usage.isPending ? <div className="grid gap-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-9" />)}</div>
          : usage.isError && !usage.data ? <ErrorState reason={usage.error.message} action={{ label: '重试', onClick: () => void usage.refetch() }} />
            : usage.data && <>
              {usage.data.rows.length === 0 ? <EmptyState icon={Wallet} text="还没有消费记录，生成内容后会显示在这里。" /> : (
                <div className="-mx-6 overflow-x-auto max-sm:-mx-4">
                  <table className="w-full min-w-[1180px] table-fixed text-left text-[13px]">
                    <colgroup><col className="w-[170px]" /><col /><col className="w-[88px]" /><col className="w-[140px]" /><col className="w-[110px]" /><col className="w-[100px]" /><col className="w-[110px]" /><col className="w-[120px]" /><col className="w-[190px]" /></colgroup>
                    <thead><tr className="bg-subtle/60 text-xs text-muted">{['时间', '模型 / 插件', '状态', '输入 / 输出 Token', '原扣款', '退款', '净消费', '计价版本', '请求编号'].map(h => <th key={h} scope="col" className="whitespace-nowrap px-4 py-2.5 font-semibold first:pl-6 last:pr-6">{h}</th>)}</tr></thead>
                    <tbody>
                      {usage.data.rows.map(r => { const amounts = usageAmounts(r, v => formatMoney(v, true)); return (
                        <tr key={r.id} className="border-t border-line">
                          <td className="whitespace-nowrap py-3 pl-6 pr-4 tabular-nums">{time(r.created_at)}</td>
                          <td className="px-4 py-3"><span className="block truncate" title={r.model}>{r.model}</span>{amounts.plugin && <span className="block truncate text-xs text-muted" title={amounts.plugin}>{amounts.plugin}</span>}</td>
                          <td className="whitespace-nowrap px-4 py-3"><Badge tone={r.status === 'succeeded' ? 'success' : r.status === 'failed' ? 'danger' : r.status === 'uncertain' ? 'warning' : 'neutral'}>{USAGE_STATUS[r.status] ?? r.status}</Badge></td>
                          <td className="whitespace-nowrap px-4 py-3 tabular-nums">{r.input_tokens ?? '待核实'} / {r.output_tokens ?? '待核实'}</td>
                          <td className="whitespace-nowrap px-4 py-3 tabular-nums">{amounts.charged}</td>
                          <td className="whitespace-nowrap px-4 py-3 tabular-nums">{amounts.refunded}</td>
                          <td className="whitespace-nowrap px-4 py-3 font-semibold tabular-nums">{amounts.net}</td>
                          <td className="truncate px-4 py-3 text-xs text-muted" title={amounts.pricing}>{amounts.pricing}</td>
                          <td className="py-3 pl-4 pr-6">
                            <span className="flex items-center gap-1">
                              <span className="truncate font-mono text-xs text-muted" title={r.id}>{r.id}</span>
                              <button type="button" aria-label="复制请求编号" title="复制请求编号" className={cn('grid size-6 shrink-0 place-items-center rounded-[6px] text-muted hover:bg-subtle hover:text-ink', focusRing)}
                                onClick={() => void navigator.clipboard.writeText(r.id).then(() => toast({ title: '已复制请求编号。', tone: 'success' }), () => toast({ title: '复制失败，请手动选中文本复制。', tone: 'error' }))}><Copy aria-hidden className="size-3.5" /></button>
                            </span>
                          </td>
                        </tr>
                      ) })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-4">
                <Button size="sm" icon={<ChevronLeft />} loading={paging === -1} loadingText="上一页" disabled={usage.data.page <= 1 || paging !== null} disabledReason={paging ? '正在加载' : '已经是第一页'} onClick={() => void goPage(-1)}>上一页</Button>
                <span className="text-xs text-muted tabular-nums">第 {usage.data.page} 页 · 共 {usage.data.count} 条</span>
                <Button size="sm" loading={paging === 1} loadingText="下一页" disabled={usage.data.page * usage.data.page_size >= usage.data.count || paging !== null} disabledReason={paging ? '正在加载' : '已经是最后一页'} onClick={() => void goPage(1)}>下一页<ChevronRight aria-hidden /></Button>
              </div>
            </>}
      </Card>

      <Fold title="余额变动">
        {!w?.entries?.length ? <p className="text-sm text-muted">{wallet.isPending ? '正在读取…' : '暂无余额变动。'}</p> : (
          <ul className="grid gap-2 text-sm text-muted">
            {w.entries.map((r, i) => <li key={i} className="tabular-nums">{time(r.created_at)} · {({consumption:'消费',signup_bonus:'注册赠送',admin_grant:'平台补发',earnings_conversion:'收益转余额',service_refund:'消费退款',payment_refund:'充值退款'} as Readonly<Record<string,string>>)[r.kind] ?? '充值'} {formatMoney(r.amount_cny, true)}</li>)}
          </ul>
        )}
      </Fold>

      <Fold title="高级设置 · API 接入"><Tokens query={tokens} /></Fold>

      <Fold title="帮助与数据说明">
        <p className="text-sm leading-6 text-muted">内容工作台的草稿与偏好目前保存在本机浏览器，按登录账号区分；更换设备不会自动同步。图片库读取当前账号的云端记录。</p>
        <p className="text-sm leading-6 text-muted">需要找回密码时，可退出登录，在登录页选择「忘记密码」。客户端下载与更新说明见首页的版本说明。</p>
      </Fold>
    </div>
  )
}

function Tokens({ query }: { query: ReturnType<typeof useQuery<{ rows: TokenRow[] }>> }) {
  const [state, dispatch] = useReducer(tokenReducer, tokenInitial)
  const [name, setName] = useState('')
  const [rpm, setRpm] = useState('')
  const [expiry, setExpiry] = useState('')
  const [confirm, setConfirm] = useState<TokenRow | null>(null)
  const rows = query.data?.rows ?? []

  // §6: token issue/revoke wait for the server; the list only changes after it answers.
  async function issue() {
    dispatch({ type: 'issue' })
    try {
      const r = await call<{ token: string }>('/api/me/tokens', {
        name: name || '默认凭证',
        rpm: rpm ? Number(rpm) : null,
        expires_at: expiry ? new Date(expiry).toISOString() : null,
      })
      dispatch({ type: 'issued', token: r.token })
      await queryClient.refetchQueries({ queryKey: ['account', 'tokens'] })
    } catch (e) { dispatch({ type: 'issueFailed' }); toast({ title: (e as Error).message, tone: 'error' }) }
  }
  async function revoke(row: TokenRow) {
    dispatch({ type: 'revoke', id: row.id })
    try {
      await call(`/api/me/tokens/${row.id}/revoke`, {})
      await queryClient.refetchQueries({ queryKey: ['account', 'tokens'] })
      setConfirm(null); toast({ title: `已吊销「${row.name}」`, tone: 'success' })
    } catch (e) { toast({ title: (e as Error).message, tone: 'error' }) }
    finally { dispatch({ type: 'revoked' }) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(state.revealed ?? ''); toast({ title: '已复制凭证。', tone: 'success' }) }
    catch { toast({ title: '复制失败，请手动选中文本复制。', tone: 'error' }) }
  }

  const busyReason = state.issuing ? '正在生成凭证' : '正在吊销凭证'
  return <>
    <p className="text-sm text-muted">{query.isPending ? '正在读取凭证…' : `共 ${activeTokenCount(rows)} 把有效凭证，共用当前账户钱包。`}</p>
    <p className="text-xs text-muted">Base URL：<code className="rounded bg-subtle px-1.5 py-0.5 font-mono">https://api.ipzsk.com/v1</code></p>

    {query.isError ? <ErrorState reason={query.error.message} action={{ label: '重试', onClick: () => void query.refetch() }} />
      : rows.length > 0 && (
        <ul className="grid divide-y divide-line rounded-control border border-line">
          {rows.map(r => {
            const status = tokenStatus(r)
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                <KeyRound aria-hidden className="text-muted" />
                <strong className="min-w-0 break-all">{r.name}</strong>
                <code className="font-mono text-xs text-muted">{r.prefix}…</code>
                <Badge tone={status === '有效' ? 'success' : 'outline'}>{status}</Badge>
                <span className="text-xs text-muted">限速 {r.rpm ?? '账户上限'} · 到期 {r.expires_at ? time(r.expires_at) : '永久'}</span>
                {!r.revoked_at && (
                  <Button variant="danger-ghost" size="sm" className="ml-auto" disabled={state.issuing || !!state.revoking} disabledReason={busyReason} onClick={() => setConfirm(r)}>吊销</Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

    <div className="grid gap-3 rounded-control bg-subtle/50 p-4">
      <Input label="凭证名称" maxLength={100} placeholder="例如：我的电脑" value={name} onChange={e => setName(e.target.value)} />
      <details className="group">
        <summary className={cn('flex w-fit cursor-pointer list-none items-center gap-1 rounded-[6px] text-[13px] font-semibold hover:text-label [&::-webkit-details-marker]:hidden', focusRing)}>
          <ChevronRight aria-hidden className="size-3.5 transition-transform group-open:rotate-90" />限速与有效期（可选）
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <Input label="每分钟请求上限（留空沿用账户）" type="number" min={1} max={600} inputMode="numeric" value={rpm} onChange={e => setRpm(e.target.value)} />
          <Input label="有效期（留空永久）" type="datetime-local" value={expiry} onChange={e => setExpiry(e.target.value)} />
        </div>
      </details>
      <div>
        <Button variant="primary" icon={<KeyRound />} loading={state.issuing} loadingText="正在生成" disabled={!!state.revoking} disabledReason={busyReason} onClick={() => void issue()}>创建独立 API 凭证</Button>
      </div>
    </div>

    {state.revealed && (
      <section aria-labelledby="token-once" className="grid gap-3 rounded-control border-2 border-ink bg-card p-4">
        <p id="token-once" className="flex items-center gap-2 text-sm font-bold"><TriangleAlert aria-hidden className="text-warning" />完整凭证只显示这一次，请妥善保存。</p>
        <textarea readOnly rows={3} aria-label="新生成的 API 凭证" value={state.revealed} onFocus={e => e.currentTarget.select()}
          className={cn('w-full resize-none break-all rounded-control border border-line bg-subtle/60 p-3 font-mono text-[13px]', focusRing)} />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" icon={<Copy />} onClick={() => void copy()}>复制凭证</Button>
          <Button variant="ghost" size="sm" onClick={() => dispatch({ type: 'reset' })}>我已保存，隐藏</Button>
        </div>
      </section>
    )}

    <Dialog open={!!confirm} onOpenChange={o => { if (!o && !state.revoking) setConfirm(null) }}>
      {confirm && (
        <DialogContent title={`吊销「${confirm.name}」？`} description="使用它的应用将停止调用。吊销后无法恢复，需要时请重新生成新凭证。">
          <DialogFooter>
            <Button variant="ghost" disabled={!!state.revoking} disabledReason="正在吊销" onClick={() => setConfirm(null)}>取消</Button>
            <Button variant="danger" loading={state.revoking === confirm.id} loadingText="正在吊销" onClick={() => void revoke(confirm)}>吊销</Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  </>
}
