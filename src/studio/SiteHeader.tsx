import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type MouseEvent } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Tooltip, cn, focusRing } from '@/ui'
import { formatMoney } from '@/shared/billing'
import { isMock, loginUrl, request } from '@/shared/api'
import { useCurrentUser, useWallet } from '@/shared/query'
import { RechargeHost, openRecharge } from '@/shared/recharge/RechargeDialog'

// React port of /site-nav.js + /points-wallet.js; look matches /site-nav.css.
export type StudioKind = 'image' | 'video' | 'avatar'
const links: { href: string; text: string; kind?: StudioKind; wallet?: boolean }[] = [
  { href: '/', text: '首页 · 下载' },
  { href: '/studio?kind=image', text: '图片', kind: 'image' },
  { href: '/studio?kind=video', text: '视频', kind: 'video' },
  { href: '/studio?kind=avatar', text: '数字人', kind: 'avatar' },
  { href: '/workspace', text: '内容工作台' },
  { href: '/#wallet', text: '余额与账单', wallet: true },
]
const linkClass = cn('rounded-control px-3.5 py-2 text-[13px] whitespace-nowrap hover:bg-subtle max-[720px]:px-3', focusRing)

function PointsPill() {
  const { data: wallet, isError } = useWallet()
  if (isError) return <span role="status" className="text-[13px] text-muted">余额暂不可用</span>
  if (!wallet) return null
  const available = Number(wallet.available_cny)
  const frozen = Number(wallet.frozen_cny)
  return (
    <Tooltip side="bottom" content={(frozen > 0 ? `处理中冻结 ${formatMoney(frozen)} · ` : '') + '在线充值'}>
    <button
      type="button"
      onClick={openRecharge}
      aria-haspopup="dialog"
      className={cn(linkClass, 'cursor-pointer border border-line bg-card font-bold tabular-nums')}
    >
      {formatMoney(available)}
      <span className={cn('font-normal max-[720px]:sr-only', available <= 0 ? 'text-danger' : 'text-label')}>{available <= 0 ? ' · 去充值' : ' · 充值'}</span>
    </button>
    </Tooltip>
  )
}

// 「管理中台」 entry is UX only; /api/admin/* enforces roles server-side (§9.1).
const useMyRoles = (enabled: boolean) => useQuery({
  queryKey: ['me', 'roles'],
  enabled,
  // Mock: the admin mock defaults to role admin, so show the entry (and never hit the real endpoint → 401 → 「登录已失效」).
  queryFn: async () => { if (isMock) return ['admin']; try { return (await request<{ roles: string[] }>('/api/me/roles')).roles } catch { return [] } },
  staleTime: 5 * 60_000,
})

/**
 * Inside the studio pass the composer's kind (and a switcher so the entries don't reload the page);
 * elsewhere the active entry falls back to `?kind=` on /studio.
 */
export function SiteHeader({ studioKind, onStudioKind }: { studioKind?: StudioKind; onStudioKind?: (kind: StudioKind) => void } = {}) {
  const { data: user, isPending } = useCurrentUser()
  const { data: roles } = useMyRoles(!!user)
  const [{ pathname, hash, search }, setUrl] = useState({ pathname: '/', hash: '', search: '' })
  useEffect(() => {
    const sync = () => setUrl({ pathname: location.pathname, hash: location.hash, search: location.search })
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
  const onAdmin = pathname.startsWith('/admin')
  return (
    <header className="h-16 border-b border-line bg-paper/95 backdrop-blur-md max-[720px]:h-[104px]">
      <nav aria-label="主导航" className="grid h-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-7 px-6 lg:px-8 max-[720px]:grid-cols-[minmax(0,1fr)_auto] max-[720px]:px-4 max-[720px]:grid-rows-[52px_44px] max-[720px]:gap-x-2 max-[720px]:gap-y-0">
        <a href="/" className={cn('rounded-control', focusRing)}>
          {/* Designer lockup (479bf1e); 787×644 source, fixed box → no layout shift. */}
          <img src="/assets/ipzsk-lockup-160.webp" alt="IPZSK" width={71} height={58} decoding="async" className="block h-[58px] w-[71px] max-w-none object-contain mix-blend-multiply max-[720px]:h-11 max-[720px]:w-[54px]" />
        </a>
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] max-[720px]:col-span-full max-[720px]:row-start-2">
          {links.map(l => {
            const onStudio = pathname.startsWith('/studio')
            const current = l.kind
              ? onStudio && (studioKind ?? new URLSearchParams(search).get('kind') ?? 'image') === l.kind
              : l.wallet ? pathname === '/' && hash === '#wallet'
                : l.href === '/' ? pathname === '/' && hash !== '#wallet' : pathname.startsWith(l.href)
            const onClick = l.kind && onStudioKind
              ? (e: MouseEvent) => { if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); onStudioKind(l.kind!) }
              : undefined
            return <a key={l.href} href={l.href} onClick={onClick} aria-current={current ? 'page' : undefined} className={cn(linkClass, current && 'bg-acid font-bold text-white hover:bg-acid')}>{l.text}</a>
          })}
        </div>
        <div className="flex min-w-0 items-center gap-2 max-[720px]:gap-1">
          {/* Admin entry first: the cluster is right-anchored, so it arriving late (after /api/me/roles) grows leftwards and moves nothing else. */}
          {user && !!roles?.length && (
            <Tooltip side="bottom" content="管理中台">
              <a href="/admin" aria-current={onAdmin ? 'page' : undefined} aria-label="管理中台" className={cn(linkClass, 'inline-flex items-center gap-1.5', onAdmin && 'bg-acid font-bold text-white hover:bg-acid')}>
                <ShieldCheck aria-hidden className="size-4 shrink-0" /><span className="max-[720px]:sr-only">管理中台</span>
              </a>
            </Tooltip>
          )}
          {user && <PointsPill />}
          {user && <RechargeHost />}
          {isPending ? null : user
            ? <a href="/account" className={linkClass}>我的</a>
            : <a href={loginUrl()} className={cn(linkClass, 'bg-acid font-bold text-white hover:bg-acid-deep')}>登录 / 注册</a>}
        </div>
      </nav>
    </header>
  )
}
