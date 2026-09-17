import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Plus, ShieldCheck, UserSearch, X } from 'lucide-react'
import { Badge, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EmptyState, ErrorState, Button, Skeleton, Tooltip, cn, focusRing, toast } from '@/ui'
import { queryClient } from '@/shared/query'
import { adminApi, type AdminUserDetail } from './api'
import { GEN_STATUS_LABEL, ROLES, ROLE_LABEL, fmtPoints, fmtTime, revokeBlockReason, type Role } from './lib'
import { Confirm, Drawer, FilterInput, KV, PageHeader } from './ui'
import { useAdminMe, useCan } from './App'

const roleTone = (r: Role) => (r === 'admin' ? 'ink' : r === 'operator' ? 'acid' : 'outline') as 'ink' | 'acid' | 'outline'

export function UsersPage() {
  const [sp, setSp] = useSearchParams()
  const q = sp.get('q') ?? ''
  const userId = sp.get('user')
  const [text, setText] = useState(q)
  const patch = (k: string, v: string | null) => setSp(cur => { const p = new URLSearchParams(cur); if (v) p.set(k, v); else p.delete(k); return p })
  useEffect(() => { if (text.trim() === q) return; const t = setTimeout(() => patch('q', text.trim()), 250); return () => clearTimeout(t) }) // eslint-disable-line react-hooks/exhaustive-deps

  const results = useQuery({ queryKey: ['admin', 'users', q], queryFn: () => adminApi.users.search(q), enabled: !!q })
  const staff = useQuery({ queryKey: ['admin', 'staff'], queryFn: adminApi.users.staff })
  const open = (id: string) => patch('user', id)

  return (
    <section>
      <PageHeader title="用户与角色" />
      <div className="mb-4 max-w-md">
        <FilterInput label="搜索用户" type="search" value={text} onChange={e => setText(e.target.value)} placeholder="邮箱、昵称或用户 id" className="w-full" />
      </div>

      {q && (
        <div className="mb-8">
          {results.isError ? <ErrorState reason="搜索失败，请重试" action={{ label: '重试', onClick: () => void results.refetch() }} />
            : results.isPending ? <div className="grid gap-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-12" />)}</div>
            : !results.data.items.length ? <EmptyState icon={UserSearch} text={`没有找到「${q}」`} />
            : <UserTable rows={results.data.items.map(u => ({ id: u.id, email: u.email, name: u.name ?? '', roles: u.roles, extra: fmtTime(u.created_at) + (u.email_verified ? '' : ' · 邮箱未验证') }))} onOpen={open} extraLabel="注册时间" />}
        </div>
      )}

      <h2 className="mb-2 flex items-center gap-2 text-base font-bold"><ShieldCheck aria-hidden />管理成员</h2>
      {staff.isError ? <ErrorState reason="管理成员加载失败" action={{ label: '重试', onClick: () => void staff.refetch() }} />
        : staff.isPending ? <Skeleton className="h-40" />
        : <UserTable rows={staff.data.map(s => ({ id: s.user.id, email: s.user.email, name: s.user.name ?? '', roles: s.roles.map(r => r.role), extra: s.roles.map(r => `${ROLE_LABEL[r.role]} ${r.granted_by ? `由 ${r.granted_by.email}` : ''}`).join('；') }))} onOpen={open} extraLabel="授予" />}

      <UserDrawer id={userId} onClose={() => patch('user', null)} />
    </section>
  )
}

function UserTable({ rows, onOpen, extraLabel }: { rows: { id: string; email: string | null; name: string; roles: Role[]; extra: string }[]; onOpen: (id: string) => void; extraLabel: string }) {
  const th = 'border-b border-line py-2 text-left text-xs font-semibold text-muted'
  return (
    <table className="w-full border-separate border-spacing-0 text-sm">
      <thead><tr><th className={th}>邮箱</th><th className={th}>昵称</th><th className={th}>角色</th><th className={th}>{extraLabel}</th></tr></thead>
      <tbody>
        {rows.map(u => (
          <tr key={u.id} className="hover:bg-card">
            <td className="border-b border-line py-2.5"><button type="button" onClick={() => onOpen(u.id)} className={cn('rounded-[4px] font-semibold hover:underline', focusRing)}>{u.email ?? u.name ?? u.id}</button></td>
            <td className="border-b border-line py-2.5 text-muted">{u.name}</td>
            <td className="border-b border-line py-2.5"><span className="flex flex-wrap gap-1">{u.roles.length ? u.roles.map(r => <Badge key={r} tone={roleTone(r)}>{ROLE_LABEL[r]}</Badge>) : <span className="text-muted">普通用户</span>}</span></td>
            <td className="border-b border-line py-2.5 text-xs text-muted">{u.extra}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

type Pending = { kind: 'grant' | 'revoke'; role: Role } | null

function UserDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const me = useAdminMe()
  const canRoles = useCan('roles.write')
  const detail = useQuery({ queryKey: ['admin', 'user', id], queryFn: () => adminApi.users.get(id!), enabled: !!id })
  const staff = useQuery({ queryKey: ['admin', 'staff'], queryFn: adminApi.users.staff, enabled: !!id && canRoles })
  const [pending, setPending] = useState<Pending>(null)
  const d = detail.data
  const adminCount = staff.data?.filter(s => s.roles.some(r => r.role === 'admin')).length ?? 0
  const held = d?.roles.map(r => r.role) ?? []

  // §6 exception: role changes wait for the server, then refresh everything that shows roles.
  const apply = async () => {
    const { kind, role } = pending!
    await (kind === 'grant' ? adminApi.users.grant(id!, role) : adminApi.users.revoke(id!, role))
    await Promise.all([queryClient.invalidateQueries({ queryKey: ['admin', 'user', id] }), queryClient.invalidateQueries({ queryKey: ['admin', 'staff'] }), queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })])
    toast({ title: kind === 'grant' ? `已授予${ROLE_LABEL[role]}角色` : `已撤销${ROLE_LABEL[role]}角色`, tone: 'success' })
  }

  return (
    <Drawer open={!!id} onClose={onClose} title={d?.user.email ?? '用户详情'}>
      {detail.isError ? <ErrorState reason="用户加载失败" action={{ label: '重试', onClick: () => void detail.refetch() }} />
        : !d ? <div className="grid gap-3"><Skeleton className="h-24" /><Skeleton className="h-32" /></div>
        : (
          <div className="grid gap-6">
            <dl>
              <KV k="用户 id"><code className="text-xs">{d.user.id}</code></KV>
              <KV k="昵称">{d.user.name || '—'}</KV>
              <KV k="注册">{fmtTime(d.user.created_at)}{!d.user.email_verified && <Badge tone="warning" className="ml-2">邮箱未验证</Badge>}</KV>
              <KV k="最近登录">{d.user.last_sign_in_at ? fmtTime(d.user.last_sign_in_at) : '—'}</KV>
            </dl>

            <section>
              <h3 className="mb-2 text-sm font-bold">角色</h3>
              <div className="flex flex-wrap items-center gap-2">
                {!held.length && <span className="text-sm text-muted">普通用户</span>}
                {d.roles.map(r => {
                  const block = revokeBlockReason({ role: r.role, targetId: d.user.id, meId: me.user.id, adminCount })
                  return (
                    <span key={r.role} className="inline-flex items-center gap-1">
                      <Badge tone={roleTone(r.role)} title={`${fmtTime(r.granted_at)}${r.granted_by ? ` 由 ${r.granted_by.email} 授予` : ''}`}>
                        {ROLE_LABEL[r.role]}
                        {canRoles && (block
                          ? <Tooltip content={block}><span tabIndex={0} aria-label={`不能撤销：${block}`} className="-mr-1 grid size-5 cursor-not-allowed place-items-center rounded-full opacity-45"><X className="size-3" /></span></Tooltip>
                          : <button type="button" aria-label={`撤销${ROLE_LABEL[r.role]}角色`} onClick={() => setPending({ kind: 'revoke', role: r.role })} className={cn('-mr-1 grid size-5 place-items-center rounded-full hover:bg-card/30', focusRing)}><X className="size-3" /></button>)}
                      </Badge>
                    </span>
                  )
                })}
                {canRoles && held.length < ROLES.length && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" icon={<Plus />} disabled={!d.user.email_verified} disabledReason="邮箱未验证的用户不能授予管理角色">授予角色</Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {ROLES.filter(r => !held.includes(r)).map(r => <DropdownMenuItem key={r} onSelect={() => setPending({ kind: 'grant', role: r })}>{ROLE_LABEL[r]}（{r}）</DropdownMenuItem>)}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              {!canRoles && <p className="mt-2 text-xs text-muted">角色只能由管理员授予或撤销。</p>}
            </section>

            <Wallet d={d} />

            <section>
              <h3 className="mb-2 text-sm font-bold">最近生成</h3>
              {!d.recent_generations.length ? <p className="text-sm text-muted">暂无生成记录</p> : (
                <ul className="divide-y divide-line rounded-card border border-line">
                  {d.recent_generations.map(g => (
                    <li key={g.id}>
                      <Link to={`/admin/generations?id=${g.id}&user=${encodeURIComponent(d.user.email ?? d.user.id)}`} className={cn('grid grid-cols-[1fr_auto] gap-x-3 px-3 py-2 text-sm hover:bg-subtle', focusRing)}>
                        <span className="truncate">{g.prompt}</span>
                        <span className="text-xs text-muted">{GEN_STATUS_LABEL[g.status]}</span>
                        <span className="text-xs text-muted">{g.model} · {fmtTime(g.created_at)}</span>
                        <span className="text-xs tabular-nums text-muted">{fmtPoints(g.charged_points)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

      <Confirm
        open={!!pending}
        onOpenChange={o => { if (!o) setPending(null) }}
        danger={pending?.kind === 'revoke'}
        title={pending?.kind === 'grant' ? `授予${pending && ROLE_LABEL[pending.role]}角色？` : `撤销${pending && ROLE_LABEL[pending.role]}角色？`}
        description={pending && d && (pending.kind === 'grant'
          ? `${d.user.email} 将获得「${ROLE_LABEL[pending.role]}」权限${pending.role === 'admin' ? '，包括授予和撤销其他人的角色' : pending.role === 'operator' ? '，可以编辑案例和处理生成记录' : '，可以只读查看管理中台'}。操作会写入审计日志。`
          : `${d.user.email} 将失去「${ROLE_LABEL[pending.role]}」权限，最多 30 秒内生效。操作会写入审计日志。`)}
        confirmLabel={pending?.kind === 'grant' ? '确认授予' : '确认撤销'}
        loadingText={pending?.kind === 'grant' ? '授予中' : '撤销中'}
        onConfirm={apply}
      />
    </Drawer>
  )
}

function Wallet({ d }: { d: AdminUserDetail }) {
  const u = d.usage
  return (
    <section>
      <h3 className="mb-2 text-sm font-bold">钱包与用量 <span className="font-normal text-muted">（只读）</span></h3>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <Stat k="可用点数" v={d.wallet ? fmtPoints(d.wallet.available_points) : '暂不可用'} />
        <Stat k="冻结" v={d.wallet ? fmtPoints(d.wallet.frozen_points) : '—'} />
        <Stat k="近 30 天扣点" v={fmtPoints(u.last_30d.charged_points)} />
        <Stat k="近 30 天生成" v={`${u.last_30d.generations} 次`} />
        <Stat k="成功 / 失败 / 取消" v={`${u.last_30d.succeeded} / ${u.last_30d.failed} / ${u.last_30d.cancelled}`} />
        <Stat k="素材" v={`${u.storage.assets} 个 · ${(u.storage.bytes / 1048576).toFixed(0)} MB`} />
      </div>
      {d.wallet_error && <p className="mt-2 text-xs text-warning">钱包查询失败（计费服务暂不可用），稍后重开抽屉重试。</p>}
      <p className="mt-2 text-xs text-muted">充值、退款与核销仍在旧版管理后台处理。</p>
    </section>
  )
}

const Stat = ({ k, v }: { k: string; v: string }) => (
  <div className="rounded-control bg-subtle px-3 py-2"><div className="text-[11px] text-muted">{k}</div><div className="font-semibold tabular-nums">{v}</div></div>
)
