import { useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, LogIn, Plus, Puzzle, RefreshCw, Search, UserRound } from 'lucide-react'
import { Badge, Button, Dialog, DialogContent, DialogFooter, EmptyState, ErrorState, Input, Skeleton, buttonVariants, cn, focusRing, toast } from '@/ui'
import { loginUrl } from '@/shared/api'
import { queryClient, useCurrentUser } from '@/shared/query'
import { CommissionPanel } from '@/pages/home/CommissionPanel'
import {
  DEV_LABELS, DEV_PROFILE_KEY, DevError, amount, canWithdraw, count, defaultRange, devApi, gateFor, pluginStatus,
  type DevProfile, type Plugin, type Release, type UsageRow,
} from './lib'

// Port of developer.js. Role-aware: signed out → login gate; not approved → application gate; approved → workspace.
const PROFILE = DEV_PROFILE_KEY

function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="min-w-0 rounded-card border border-line bg-card p-6 max-sm:p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-bold">{title}</h2>{action}</div>
      {children}
    </section>
  )
}

function Table({ headers, rows, empty = '暂无记录' }: { headers: string[]; rows: ReactNode[][]; empty?: string }) {
  if (!rows.length) return <EmptyState icon={Puzzle} text={empty} />
  return (
    <div className="-mx-6 overflow-x-auto max-sm:-mx-4">
      <table className="w-full min-w-[560px] text-left text-[13px]">
        <thead><tr className="bg-subtle/60 text-xs text-muted">{headers.map(h => <th key={h} scope="col" className="px-6 py-2.5 font-semibold">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line">{r.map((c, j) => <td key={j} className="px-6 py-3 align-middle">{c ?? '—'}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

/** Runs a write; errors surface in place (dialog) or as a toast. 401 flips the page to the login gate. */
function useAction() {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = async (id: string, fn: () => Promise<unknown>) => {
    if (busy) return false
    setBusy(id); setError(null)
    try { await fn(); return true }
    catch (e) {
      if (!(e instanceof DevError && e.status === 401)) setError((e as Error).message)
      return false
    } finally { setBusy(null) }
  }
  return { busy, error, setError, run }
}

const refreshAll = () => queryClient.refetchQueries({ queryKey: ['developer'] })

export function DeveloperPage() {
  const profile = useQuery<DevProfile | null | 'signed-out'>({
    queryKey: PROFILE,
    queryFn: async () => {
      try { return (await devApi<{ profile: DevProfile | null }>('')).profile }
      catch (e) { if (e instanceof DevError && e.status === 401) return 'signed-out'; throw e }
    },
    retry: false,
  })
  const data = profile.data
  const approved = !!data && data !== 'signed-out' && data.state === 'approved'

  return (
    <main className="mx-auto w-full max-w-[1160px] px-7 pb-16 pt-9 max-sm:px-4 max-sm:pt-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[.2em] text-muted">IPZSK / DEVELOPERS</p>
          <h1 className="mt-2 text-[32px] font-black tracking-[-.5px] max-sm:text-[26px]">开发者中心</h1>
        </div>
        <a href="/account" className={buttonVariants({ variant: 'secondary', size: 'sm' })}><UserRound aria-hidden />个人账户</a>
      </header>

      <div className="mt-6">
        {profile.isPending ? <div className="grid gap-3 rounded-card border border-line bg-card p-6"><Skeleton className="h-6 w-40" /><Skeleton className="h-4 w-72" /></div>
          : profile.isError ? <ErrorState reason={profile.error.message} action={{ label: '重试', onClick: () => void profile.refetch() }} />
            : data === 'signed-out' ? (
              <section className="rounded-card border border-line bg-card p-6">
                <p className="text-sm">插件开发者由管理员邀请开通。使用被邀请的 IPZSK 账户登录，管理插件并查看开发者分佣。</p>
                <a href={loginUrl('/developer')} className={cn(buttonVariants({ variant: 'primary' }), 'mt-4')}><LogIn aria-hidden />登录 / 注册</a>
              </section>
            ) : approved ? <Workspace profile={data as DevProfile} /> : <Gate profile={data as DevProfile | null} />}
      </div>
    </main>
  )
}

function Gate({ profile }: { profile: DevProfile | null }) {
  const gate = gateFor(profile)!
  return (
    <section className="rounded-card border border-line bg-card p-6 max-sm:p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-bold">{gate.title}</h2>
        {profile && <Badge tone={profile.state === 'rejected' || profile.state === 'disabled' ? 'danger' : 'warning'}>{DEV_LABELS[profile.state] ?? profile.state}</Badge>}
      </div>
      <p className="mt-2 text-sm leading-6 text-muted">{gate.body}</p>
      <a href="/account" className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'mt-4')}>查看我的身份与邀请</a>
    </section>
  )
}

function Workspace({ profile }: { profile: DevProfile }) {
  const plugins = useQuery({ queryKey: ['developer', 'plugins'], queryFn: async () => (await devApi<{ plugins: Plugin[] }>('/plugins')).plugins })
  const user = useCurrentUser()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const selected = plugins.data?.find(p => p.id === selectedId) ?? null

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5">
      <section className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">{profile.display_name} · 我的插件</h2>
          <p className="mt-1.5 text-[13px] text-muted">管理发布，查看使用与收益。</p>
        </div>
        <Button size="sm" icon={<RefreshCw />} loading={refreshing} loadingText="刷新中" onClick={async () => {
          setRefreshing(true)
          try { await queryClient.refetchQueries({ queryKey: ['developer'] }, { throwOnError: true }) }
          catch (e) { toast({ title: (e as Error).message, tone: 'error' }) }
          finally { setRefreshing(false) }
        }}>刷新</Button>
      </section>

      <Card title="我的插件与版本">
        {plugins.isPending ? <div className="grid gap-2">{[0, 1].map(i => <Skeleton key={i} className="h-10" />)}</div>
          : plugins.isError ? <ErrorState reason={plugins.error.message} action={{ label: '重试', onClick: () => void plugins.refetch() }} />
            : <Table headers={['插件', '发布状态', '累计使用人数', '操作']} empty="还没有插件，先在下方创建一个。" rows={plugins.data.map(p => {
              const s = pluginStatus(p)
              return [
                <strong>{p.name}</strong>,
                <div><Badge tone={s.status === '已上架' ? 'success' : s.status === '已停用' ? 'danger' : s.status === '待审核' ? 'warning' : 'outline'}>{s.status}</Badge>{s.newPending && <small className="mt-1 block text-[11px] text-muted">新版本待审核</small>}</div>,
                <span className="tabular-nums">{count(p.active_users)}</span>,
                <Button size="sm" onClick={() => setSelectedId(p.id)}>管理</Button>,
              ]
            })} />}
        <CreatePlugin />
      </Card>

      <Earnings plugins={plugins.data ?? []} />
      {user.data && <CommissionPanel userId={user.data.id} view="developer" />}
      {selected && <ReleasesDialog plugin={selected} onClose={() => setSelectedId(null)} />}
    </div>
  )
}

function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group mt-4 border-t border-line pt-4">
      <summary className={cn('flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-[6px] text-sm font-semibold hover:text-label [&::-webkit-details-marker]:hidden', focusRing)}>
        <ChevronRight aria-hidden className="transition-transform group-open:rotate-90" />{title}
      </summary>
      {children}
    </details>
  )
}

function CreatePlugin() {
  const action = useAction()
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    if (!form.reportValidity()) return
    void action.run('create', async () => {
      await devApi('/plugins', Object.fromEntries(new FormData(form)))
      form.reset(); await refreshAll()
      toast({ title: '插件已创建', tone: 'success' })
    })
  }
  return (
    <Fold title="创建插件">
      <form onSubmit={submit} className="mt-4 grid max-w-[600px] grid-cols-2 gap-3 max-sm:grid-cols-1">
        <Input label="插件标识" name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} hint="小写字母、数字和连字符" />
        <Input label="显示名称" name="name" required maxLength={100} />
        <Input label="GitHub 仓库（owner/repo）" name="repository" required maxLength={200} />
        <Input label="npm 包名" name="package_name" required maxLength={214} />
        {action.error && <p role="alert" className="col-span-full text-sm text-danger">{action.error}</p>}
        <div className="col-span-full"><Button type="submit" variant="primary" icon={<Plus />} loading={action.busy === 'create'} loadingText="正在创建">创建</Button></div>
      </form>
    </Fold>
  )
}

function ReleasesDialog({ plugin: p, onClose }: { plugin: Plugin; onClose: () => void }) {
  const releases = useQuery({ queryKey: ['developer', 'releases', p.id], queryFn: async () => (await devApi<{ releases: Release[] }>('/plugins/' + p.id + '/releases')).releases })
  const action = useAction()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(p.name)
  const [url, setUrl] = useState('')
  const [asset, setAsset] = useState('')

  const submitRelease = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!e.currentTarget.reportValidity()) return
    void action.run('release', async () => {
      await devApi('/plugins/' + p.id + '/releases', { release_url: url, asset_name: asset || undefined })
      setUrl(''); setAsset(''); await refreshAll()
      toast({ title: '已提交审核', tone: 'success' })
    })
  }
  const rename = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    void action.run('rename', async () => { await devApi('/plugins/' + p.id + '/settings', { name }); await refreshAll(); setRenaming(false) })
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent title={p.name} description={`共 ${p.versions} 个版本 · 分成比例 ${p.revenue_share_bps == null ? '待配置' : p.revenue_share_bps / 100 + '%'}`} className="max-h-[calc(100dvh-32px)] max-w-[900px] overflow-y-auto">
        <div className="grid gap-4">
          {action.error && <ErrorState reason={action.error} />}
          {renaming ? (
            <form onSubmit={rename} className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1"><Input label="插件名称" value={name} maxLength={100} required autoFocus onChange={e => setName(e.target.value)} /></div>
              <Button type="submit" variant="primary" loading={action.busy === 'rename'} loadingText="保存中" disabled={!name.trim()} disabledReason="名称不能为空">保存</Button>
              <Button variant="ghost" onClick={() => { setRenaming(false); setName(p.name) }}>取消</Button>
            </form>
          ) : <div><Button size="sm" onClick={() => setRenaming(true)}>修改名称</Button></div>}

          <Fold title="提交新版本">
            <form onSubmit={submitRelease} className="mt-4 grid max-w-[700px] gap-3">
              <Input label="GitHub Release 地址" type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder={`https://github.com/${p.repository}/releases/tag/v1.0.0`} />
              <Input label="附件名（多个 .tgz 时填写）" value={asset} onChange={e => setAsset(e.target.value)} />
              <p className="text-xs text-muted">使用 npm pack 构建的安装包，提交后等待审核。</p>
              <div><Button type="submit" variant="primary" loading={action.busy === 'release'} loadingText="正在提交">提交审核</Button></div>
            </form>
          </Fold>

          <div className="mt-2">
            {releases.isPending ? <Skeleton className="h-20" /> : releases.isError ? <ErrorState reason={releases.error.message} action={{ label: '重试', onClick: () => void releases.refetch() }} />
              : <Table headers={['版本', '状态', '审核说明', '操作']} empty="还没有版本，提交第一个版本开始审核。" rows={releases.data.map(r => [
                <span className="font-mono">{r.version}</span>,
                <span>{DEV_LABELS[r.state] ?? r.state}{r.withdrawal_requested ? ' · 下架申请中' : ''}</span>,
                r.review_note || '—',
                canWithdraw(r) ? <Button size="sm" variant="danger-ghost" loading={action.busy === 'withdraw-' + r.id} loadingText="提交中" disabled={!!action.busy && action.busy !== 'withdraw-' + r.id} disabledReason="正在处理其他操作"
                  onClick={() => void action.run('withdraw-' + r.id, async () => { await devApi('/plugins/' + p.id + '/releases/' + r.id + '/withdraw', {}); await refreshAll() })}>{r.state === 'pending' ? '撤回申请' : '申请下架'}</Button> : '—',
              ])} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Earnings({ plugins }: { plugins: Plugin[] }) {
  const [draft, setDraft] = useState({ ...defaultRange(), plugin_id: '' })
  const [params, setParams] = useState(draft)
  const usage = useQuery({
    queryKey: ['developer', 'usage', params],
    queryFn: async () => (await devApi<{ rows: UsageRow[] }>('/usage?' + new URLSearchParams(params))).rows,
    placeholderData: prev => prev,
  })
  const [detail, setDetail] = useState<UsageRow | null>(null)
  const fetching = usage.isFetching && JSON.stringify(params) === JSON.stringify(draft)
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!e.currentTarget.reportValidity()) return
    setParams({ ...draft })
    if (JSON.stringify(params) === JSON.stringify(draft)) void usage.refetch()
  }
  return (
    <Card title="收益">
      <form onSubmit={submit} className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-40 max-sm:w-full"><Input label="从" type="date" required value={draft.from} onChange={e => setDraft(d => ({ ...d, from: e.target.value }))} /></div>
        <div className="w-40 max-sm:w-full"><Input label="至" type="date" required value={draft.to} onChange={e => setDraft(d => ({ ...d, to: e.target.value }))} /></div>
        <label className="grid gap-1.5 text-[13px] font-semibold max-sm:w-full">插件
          <select value={draft.plugin_id} onChange={e => setDraft(d => ({ ...d, plugin_id: e.target.value }))}
            className={cn('h-10 min-w-40 cursor-pointer rounded-control border border-line bg-card px-3 text-sm font-normal hover:border-muted focus:border-acid focus:ring-3 focus:ring-acid/10', focusRing, 'focus-visible:outline-offset-0')}>
            <option value="">全部</option>
            {plugins.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <Button type="submit" variant="primary" icon={<Search />} loading={fetching} loadingText="查询中" className="max-sm:w-full">查询</Button>
      </form>
      {usage.isPending ? <Skeleton className="h-16" /> : usage.isError ? <ErrorState reason={usage.error.message} action={{ label: '重试', onClick: () => void usage.refetch() }} />
        : <Table headers={['插件 / 模型', '用户计费收入', '我的收益（未结算）', '明细']} empty="这个时间段还没有收益记录。" rows={usage.data.map(r => [
          `${r.plugin_name} / ${r.model}`, <span className="tabular-nums">{amount(r.billed_revenue_cny)}</span>, <span className="tabular-nums">{amount(r.accrued_earnings_cny)}</span>,
          <Button size="sm" onClick={() => setDetail(r)}>查看</Button>,
        ])} />}
      <p className="mt-4 text-xs text-muted">新规则下插件开发者取得剩余利润的 40%：有效付费 API 消费减对应的实际上游成本和 BD 分佣（消费的 20%），不低于 0；上游成本确认后计提。赠送额度不分佣，历史收益保留原规则。可用余额、转余额和提现见下方收益账户。</p>
      <Dialog open={!!detail} onOpenChange={o => { if (!o) setDetail(null) }}>
        {detail && (
          <DialogContent title={`${detail.plugin_name} · 用量明细`} className="max-w-lg">
            <dl className="grid divide-y divide-line text-sm">
              {([['使用人数', count(detail.active_users)], ['调用次数', detail.requests], ['失败次数', detail.failed_requests], ['输入 / 输出 token', `${count(detail.input_tokens)} / ${count(detail.output_tokens)}`], ['未返回 token', detail.unknown_token_requests + ' 次'], ['媒体任务 / 完成', `${detail.media_tasks} / ${detail.completed_media_tasks}`], ['未配置分成比例的计费请求', detail.unconfigured_share_requests + ' 笔']] as const).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2.5"><dt className="text-muted">{k}</dt><dd className="tabular-nums">{String(v)}</dd></div>
              ))}
            </dl>
            <DialogFooter><Button onClick={() => setDetail(null)}>关闭</Button></DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  )
}
