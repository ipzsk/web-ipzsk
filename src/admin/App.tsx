import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Gauge, Grid3x3, Images, ListChecks, LogIn, Logs, ScrollText, Server, ShieldOff, Users, type LucideIcon } from 'lucide-react'
import { Badge, Button, OfflineBanner, Skeleton, cn, focusRing } from '@/ui'
import { ApiError, UNAUTHORIZED_EVENT, isMock, loginUrl, request } from '@/shared/api'
import { queryClient, useOnline } from '@/shared/query'
import { SiteHeader } from '@/studio/SiteHeader'
import { adminApi, type AdminMe } from './api'
import { ROLE_LABEL, can, sessionLeft, type Capability } from './lib'
import { CasesPage } from './CasesPage'
import { CaseEditor } from './CaseEditor'
import { UsersPage } from './UsersPage'
import { GenerationsPage } from './GenerationsPage'
import { AuditPage } from './AuditPage'
import { LaneMatrixPage } from './ops/LaneMatrixPage'
import { DashboardPage } from './ops/DashboardPage'
import { LogsPage } from './ops/LogsPage'
import { ChannelsPage } from './ops/ChannelsPage'

export const LEGACY_ADMIN_URL = 'https://api.ipzsk.com/admin'
const ME_KEY = ['admin', 'me'] as const

const MeContext = createContext<AdminMe | null>(null)
export const useAdminMe = () => useContext(MeContext)!
/** Role-aware rendering: viewers get no write controls at all (not disabled ones). */
export const useCan = (cap: Capability) => can(useAdminMe().roles, cap)

const nav: { group?: string; items: { to: string; label: string; icon: LucideIcon }[] }[] = [
  { items: [
    { to: '/admin/cases', label: '案例库', icon: Images },
    { to: '/admin/users', label: '用户与角色', icon: Users },
    { to: '/admin/generations', label: '生成记录', icon: ListChecks },
    { to: '/admin/audit', label: '审计日志', icon: ScrollText },
  ] },
  { group: '运维', items: [
    { to: '/admin/ops/lane-matrix', label: '线路矩阵', icon: Grid3x3 },
    { to: '/admin/ops/dashboard', label: '仪表盘', icon: Gauge },
    { to: '/admin/ops/logs', label: '日志', icon: Logs },
    { to: '/admin/ops/channels', label: '渠道', icon: Server },
  ] },
]

export function App() {
  const me = useQuery({ queryKey: ME_KEY, queryFn: adminApi.me, retry: false, staleTime: 60_000 })

  // Any 401 later (e.g. the 12h admin session runs out mid-edit) → re-run the gate.
  useEffect(() => {
    const on = () => void queryClient.invalidateQueries({ queryKey: ME_KEY })
    window.addEventListener(UNAUTHORIZED_EVENT, on)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, on)
  }, [])

  const e = me.error instanceof ApiError ? me.error : null
  // customer_login_required can arrive as 403 too (contract): it always means "sign in", never "you lack a role".
  const loginRequired = e?.code === 'customer_login_required' || (e?.status === 401 && e.code !== 'admin_session_expired')
  useEffect(() => { if (loginRequired) location.replace(loginUrl('/admin')) }, [loginRequired])

  let body: ReactNode
  if (me.isPending) body = <GateSkeleton />
  else if (e?.code === 'admin_session_expired') body = <GateMessage icon={LogIn} title="管理会话已过期" text="管理中台的操作要求最近 12 小时内登录过。你的网站登录仍然有效，所以要先退出、再登录一次：退出后会回到登录页，登录完成自动回到这里。" action={<ReloginButton />} />
  else if (loginRequired) body = <GateMessage icon={LogIn} title="正在跳转登录…" text="管理中台需要先登录。" action={<Button variant="primary" onClick={() => location.assign(loginUrl('/admin'))}>去登录</Button>} />
  else if (e?.status === 403) body = <GateMessage icon={ShieldOff} title="没有访问权限" text="你的账户没有管理中台的角色。管理中台只对管理员、运营和只读成员开放，重新登录也不会改变这一点，请联系管理员为你的账户授予角色。" action={<Button onClick={() => location.assign('/studio')}>返回创作工作台</Button>} />
  else if (me.isError) body = <GateMessage icon={ShieldOff} title="加载失败" text="暂时无法确认你的权限，请检查网络后重试。" action={<Button variant="primary" onClick={() => void me.refetch()}>重试</Button>} />
  else body = <MeContext.Provider value={me.data}><Shell /></MeContext.Provider>

  return <Chrome>{body}</Chrome>
}

function Chrome({ children }: { children: ReactNode }) {
  const online = useOnline()
  return (
    <div className="min-h-dvh">
      <div className="sticky top-0 z-40">
        {!online && <OfflineBanner />}
        <SiteHeader />
      </div>
      {children}
    </div>
  )
}

/**
 * The 12h admin window only resets on a fresh sign-in, and the site session (7d, auto-renewing) keeps
 * /account showing the signed-in profile — so re-auth has to sign out first, same endpoint as 个人中心.
 */
function ReloginButton({ size }: { size?: 'sm' }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button variant="primary" size={size} loading={busy} loadingText="正在退出" onClick={async () => {
      setBusy(true)
      if (!isMock) { try { await request('/api/auth/sign-out', { body: {} }) } catch { /* already signed out → still go to login */ } }
      location.replace(loginUrl('/admin'))
    }}>退出并重新登录</Button>
  )
}

function GateSkeleton() {
  return (
    <div className="grid grid-cols-[220px_1fr] gap-8 p-8" aria-busy="true" aria-label="正在确认权限">
      <div className="grid content-start gap-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-10" />)}</div>
      <div className="grid content-start gap-3"><Skeleton className="h-9 w-48" />{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14" />)}</div>
    </div>
  )
}

function GateMessage({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text: string; action: ReactNode }) {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-24 text-center">
      <Icon className="size-8 text-muted" aria-hidden />
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="text-sm leading-6 text-muted">{text}</p>
      <div className="mt-2 flex gap-2">{action}<a href={LEGACY_ADMIN_URL} className={cn('inline-flex h-10 items-center gap-1.5 rounded-control px-4 text-sm text-muted hover:bg-subtle', focusRing)}>旧版管理后台<ExternalLink aria-hidden /></a></div>
    </main>
  )
}

function Shell() {
  const me = useAdminMe()
  const left = sessionLeft(me.session.expires_at)
  return (
    <div className="grid grid-cols-[220px_1fr] max-md:grid-cols-1">
      <aside aria-label="管理中台" className="sticky top-16 flex h-[calc(100dvh-64px)] flex-col gap-1 border-r border-line p-3 max-md:static max-md:h-auto max-md:flex-row max-md:flex-wrap max-md:gap-x-0.5 max-md:px-3 max-md:py-2 max-md:border-b max-md:border-r-0">
        <div className="mb-2 grid gap-1.5 rounded-card bg-subtle px-3 py-2.5 max-md:hidden">
          <span className="truncate text-xs text-ink/80">{me.user.email}</span>
          <span className="flex flex-wrap gap-1" aria-label="当前角色">{me.roles.map(r => <Badge key={r} tone={r === 'admin' ? 'ink' : r === 'operator' ? 'acid' : 'outline'}>{ROLE_LABEL[r]}</Badge>)}</span>
          <span className={cn('text-[11px]', left.low ? 'text-danger' : 'text-ink/80')}>{left.label}</span>
          {left.low && <><span className="text-[11px] leading-4 text-muted">到期后管理操作会被拒绝，建议先重新登录。</span><ReloginButton size="sm" /></>}
        </div>
        {nav.map(({ group, items }) => [
          group && <p key={group} className="mt-3 px-3 pb-1 text-[11px] font-semibold text-muted max-md:hidden">{group}</p>,
          ...items.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => cn('flex h-10 shrink-0 items-center gap-2.5 rounded-control px-3 text-sm font-semibold max-md:h-8 max-md:gap-1.5 max-md:px-2.5 max-md:text-[13px] transition-colors duration-(--duration-fast) hover:bg-subtle', isActive ? 'bg-acid-soft text-label hover:bg-acid-soft' : 'text-ink/80', focusRing)}>
            <Icon className="size-[18px]" aria-hidden />{label}
          </NavLink>
        ))])}
        <div className="mt-auto max-md:mt-0">
          <a href={LEGACY_ADMIN_URL} target="_blank" rel="noopener noreferrer" className={cn('flex h-10 shrink-0 items-center gap-2.5 rounded-control px-3 text-sm text-muted hover:bg-subtle max-md:h-8 max-md:gap-1.5 max-md:px-2.5 max-md:text-[13px]', focusRing)}>
            <ExternalLink className="size-[18px]" aria-hidden />旧版管理后台
          </a>
          <p className="px-3 text-[11px] leading-5 text-muted max-md:hidden">充值码、计费、开发者审核、插件、分成暂在旧版；上游渠道见「运维」</p>
        </div>
      </aside>
      <main className="min-w-0 px-8 pb-16 pt-6 max-md:px-4">
        <Routes>
          <Route path="/admin" element={<Navigate to="/admin/cases" replace />} />
          <Route path="/admin/cases" element={<CasesPage />} />
          <Route path="/admin/cases/new" element={<CaseEditor />} />
          <Route path="/admin/cases/:id" element={<CaseEditor />} />
          <Route path="/admin/users" element={<UsersPage />} />
          <Route path="/admin/generations" element={<GenerationsPage />} />
          <Route path="/admin/audit" element={<AuditPage />} />
          <Route path="/admin/ops/dashboard" element={<DashboardPage />} />
          <Route path="/admin/ops/lane-matrix" element={<LaneMatrixPage />} />
          <Route path="/admin/ops/logs" element={<LogsPage />} />
          <Route path="/admin/ops/channels" element={<ChannelsPage />} />
          <Route path="*" element={<Navigate to="/admin/cases" replace />} />
        </Routes>
      </main>
    </div>
  )
}
