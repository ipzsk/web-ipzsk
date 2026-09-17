import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Skeleton, cn, focusRing } from '@/ui'
import { queryClient } from '@/shared/query'
import { AuthFlow, type Notice } from './AuthFlow'
import { AccountPanel, type Profile } from './AccountPanel'
import { RechargeDialog } from './Recharge'
import { AccountError, PROFILE_KEY, call, resolveNext } from './lib'

/** Signed-in profile, or null when signed out / unverified (legacy loadAccount). */
async function loadProfile(): Promise<Profile | null> {
  try {
    const profile = await call<Profile>('/api/me/profile')
    if (!profile.user.email_verified) throw new AccountError('请使用已验证的邮箱账户登录。')
    return profile
  } catch (e) {
    if (e instanceof AccountError && (e.status === 401 || e.code === 'customer_login_required')) return null
    throw e
  }
}

export function AccountPage() {
  const profile = useQuery({ queryKey: PROFILE_KEY, queryFn: loadProfile, retry: false, refetchOnWindowFocus: false })
  const status = useQuery({
    queryKey: ['account', 'status'],
    queryFn: () => call<{ registration_ready?: boolean }>('/api/account/status').then(s => !!s?.registration_ready).catch(() => false),
    staleTime: Infinity, refetchOnWindowFocus: false,
  })
  const [notice, setNotice] = useState<Notice | null>(null)
  const [recharge, setRecharge] = useState(() => new URLSearchParams(location.search).get('recharge') === '1')
  const signedIn = !!profile.data

  useEffect(() => { if (signedIn) document.title = '个人中心 · IPZSK' }, [signedIn])
  useEffect(() => { if (profile.isError) setNotice({ text: '暂时无法加载账户，请稍后刷新重试。', error: true }) }, [profile.isError])

  const onSignedIn = () => location.replace(resolveNext(new URLSearchParams(location.search).get('next')))
  const onSignedOut = () => {
    queryClient.removeQueries({ queryKey: ['account'], predicate: q => q.queryKey[1] !== 'status' })
    queryClient.setQueryData(PROFILE_KEY, null)
    setNotice({ text: '已安全退出登录。' })
  }

  return (
    <main className={cn('mx-auto w-full px-6 pb-16 pt-10 max-sm:px-4 max-sm:pt-6', signedIn ? 'max-w-[1000px]' : 'max-w-[480px]')}>
      <a href="/" aria-label="返回 IPZSK 首页" className={cn('mb-6 inline-flex items-center gap-3 rounded-control', focusRing)}>
        <span className="grid size-10 place-items-center rounded-control bg-ink text-[15px] font-black text-white">iP</span>
        <span className="leading-tight"><strong className="block text-lg font-black">IPZSK</strong><small className="text-xs text-muted">知识库工作台</small></span>
      </a>
      {profile.isPending ? (
        <div className="grid gap-4 rounded-panel border border-line bg-card p-8"><Skeleton className="h-8 w-40" /><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-12" /></div>
      ) : signedIn ? (
        <AccountPanel profile={profile.data!} onRecharge={() => setRecharge(true)} onSignedOut={onSignedOut} />
      ) : (
        <AuthFlow ready={status.isPending ? null : status.data!} onSignedIn={onSignedIn} notice={notice} setNotice={setNotice} />
      )}
      <footer className="mt-8 flex justify-center gap-5 text-[13px] text-muted">
        <a href="/" className={cn('inline-flex items-center gap-1 rounded-[6px] hover:text-ink', focusRing)}><ArrowLeft aria-hidden className="size-3.5" />返回首页</a>
        {signedIn && <a href="/developer" className={cn('rounded-[6px] hover:text-ink', focusRing)}>开发者中心</a>}
      </footer>
      <RechargeDialog open={recharge} onOpenChange={setRecharge} />
    </main>
  )
}
