import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Images, ListChecks, LogIn, ScrollText, ShieldOff, Users, type LucideIcon } from 'lucide-react'
import { Badge, Button, OfflineBanner, Skeleton, cn, focusRing } from '@/ui'
import { ApiError, UNAUTHORIZED_EVENT, loginUrl } from '@/shared/api'
import { queryClient, useOnline } from '@/shared/query'
import { SiteHeader } from '@/studio/SiteHeader'
import { adminApi, type AdminMe } from './api'
import { ROLE_LABEL, can, type Capability } from './lib'
import { CasesPage } from './CasesPage'
import { CaseEditor } from './CaseEditor'
import { UsersPage } from './UsersPage'
import { GenerationsPage } from './GenerationsPage'
import { AuditPage } from './AuditPage'

export const LEGACY_ADMIN_URL = 'https://api.ipzsk.com/admin'
const ME_KEY = ['admin', 'me'] as const

const MeContext = createContext<AdminMe | null>(null)
export const useAdminMe = () => useContext(MeContext)!
/** Role-aware rendering: viewers get no write controls at all (not disabled ones). */
export const useCan = (cap: Capability) => can(useAdminMe().roles, cap)

const nav: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/admin/cases', label: '案例库', icon: Images },
  { to: '/admin/users', label: '用户与角色', icon: Users },
  { to: '/admin/generations', label: '生成记录', icon: ListChecks },
  { to: '/admin/audit', label: '审计日志', icon: ScrollText },
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
  const loginRequired = e?.status === 401 && e.code !== 'admin_session_expired'
  useEffect(() => { if (loginRequired) location.replace(loginUrl('/admin')) }, [loginRequired])

  let body: ReactNode
  if (me.isPending) body = <GateSkeleton />
  else if (e?.code === 'admin_session_expired') body = <GateMessage icon={LogIn} title="管理会话已过期" text="管理中台的登录有效期是 12 小时，重新登录后回到这里。" action={<Button variant="primary" onClick={() => location.assign(loginUrl('/admin'))}>重新登录</Button>} />
  else if (loginRequired) body = <GateMessage icon={LogIn} title="正在跳转登录…" text="管理中台需要先登录。" action={<Button variant="primary" onClick={() => location.assign(loginUrl('/admin'))}>去登录</Button>} />
  else if (e?.status === 403) body = <GateMessage icon={ShieldOff} title="没有访问权限" text="管理中台只对管理员、运营和只读成员开放。如需权限，请联系管理员为你的账户授予角色。" action={<Button onClick={() => location.assign('/studio')}>返回创作工作台</Button>} />
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
  const left = Math.max(0, Date.parse(me.session.expires_at) - Date.now())
  return (
    <div className="grid grid-cols-[220px_1fr] max-md:grid-cols-1">
      <aside aria-label="管理中台" className="sticky top-16 flex h-[calc(100dvh-64px)] flex-col gap-1 border-r border-line p-3 max-md:static max-md:h-auto max-md:flex-row max-md:overflow-x-auto max-md:border-b max-md:border-r-0">
        <div className="mb-2 grid gap-1.5 rounded-card bg-subtle px-3 py-2.5 max-md:hidden">
          <span className="truncate text-xs text-ink/80">{me.user.email}</span>
          <span className="flex flex-wrap gap-1" aria-label="当前角色">{me.roles.map(r => <Badge key={r} tone={r === 'admin' ? 'ink' : r === 'operator' ? 'acid' : 'outline'}>{ROLE_LABEL[r]}</Badge>)}</span>
          <span className="text-[11px] text-ink/80">会话剩余约 {Math.floor(left / 3600_000)} 小时</span>
        </div>
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => cn('flex h-10 shrink-0 items-center gap-2.5 rounded-control px-3 text-sm font-semibold transition-colors duration-(--duration-fast) hover:bg-subtle', isActive ? 'bg-ink text-acid hover:bg-ink' : 'text-ink/80', focusRing)}>
            <Icon className="size-[18px]" aria-hidden />{label}
          </NavLink>
        ))}
        <div className="mt-auto max-md:mt-0">
          <a href={LEGACY_ADMIN_URL} target="_blank" rel="noopener noreferrer" className={cn('flex h-10 shrink-0 items-center gap-2.5 rounded-control px-3 text-sm text-muted hover:bg-subtle', focusRing)}>
            <ExternalLink className="size-[18px]" aria-hidden />旧版管理后台
          </a>
          <p className="px-3 text-[11px] leading-5 text-muted max-md:hidden">充值码、计费、上游账户、开发者审核、插件、分成暂在旧版</p>
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
          <Route path="*" element={<Navigate to="/admin/cases" replace />} />
        </Routes>
      </main>
    </div>
  )
}
