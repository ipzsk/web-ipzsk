import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge, Button, ErrorState, Skeleton, buttonVariants } from '@/ui'
import { queryClient } from '@/shared/query'
import type { MyRoleInvitations, RoleInvitationAccepted } from '@/shared/contracts'
import { AccountError, call } from './lib'

// Administrator invitation links look like /account#invite=<token>. The fragment never reaches a server or a Referer,
// and it is moved into this tab's sessionStorage at once so it survives the login round-trip without staying in the address bar.
const KEY = 'ipzsk.role-invitation'
let captured: string | null = null
const ROLE: Record<string, string> = { bd: 'BD', developer: '插件开发者' }
const DEVELOPER: Record<string, string> = { pending: '旧版申请待处理', approved: '已开通', rejected: '已驳回', disabled: '已停用' }
const ERRORS: Record<string, string> = {
  invitation_account_mismatch: '这份邀请发给了另一个账号。请退出后用收到邀请的邮箱登录，再重新打开邀请链接。',
  invitation_already_used: '这份邀请已经接受过，不能重复使用。',
  invitation_revoked: '这份邀请已被管理员撤销，请联系管理员重新发送。',
  invitation_expired: '这份邀请已过期，请联系管理员重新发送。',
  invitation_not_found: '邀请链接无效，请确认链接完整，或联系管理员重新发送。',
  invalid_invitation_token: '邀请链接无效，请确认链接完整，或联系管理员重新发送。',
}

export function captureInvitation() {
  const match = /^#invite=([A-Za-z0-9_-]{43})$/.exec(location.hash)
  if (match) {
    // Storage blocked: keep it in memory for this page load only.
    try { sessionStorage.setItem(KEY, match[1]!) } catch { captured = match[1]! }
    history.replaceState(null, '', location.pathname + location.search)
  }
  return pendingInvitation()
}
export function pendingInvitation() {
  try { return sessionStorage.getItem(KEY) ?? captured } catch { return captured }
}
function forget() {
  captured = null
  try { sessionStorage.removeItem(KEY) } catch { /* nothing stored */ }
}

/** Signed-in identity summary plus the accept step for an invitation link opened in this tab. */
export function IdentityCard() {
  const [token, setToken] = useState(pendingInvitation)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ readonly text: string; readonly error: boolean } | null>(null)
  const mine = useQuery({ queryKey: ['account', 'role-invitations'], queryFn: () => call<MyRoleInvitations>('/api/me/role-invitations') })

  async function accept() {
    if (!token || busy) return
    setBusy(true); setNotice(null)
    try {
      const result = await call<RoleInvitationAccepted>('/api/me/role-invitations/accept', { token })
      forget(); setToken(null)
      setNotice({ text: `已接受邀请，${ROLE[result.role]}身份已开通。`, error: false })
      await Promise.all([mine.refetch(), queryClient.invalidateQueries({ queryKey: ['commissions'] }), queryClient.invalidateQueries({ queryKey: ['developer'] })])
    } catch (error) {
      const code = error instanceof AccountError ? error.code ?? '' : ''
      // Final answers from the server: the link can never succeed in this tab, so drop it.
      if (ERRORS[code]) { forget(); setToken(null) }
      setNotice({ text: ERRORS[code] ?? (error as Error).message, error: true })
    } finally { setBusy(false) }
  }

  const data = mine.data
  return (
    <section className="min-w-0 rounded-card border border-line bg-card p-6 max-sm:p-4" aria-labelledby="identity-title">
      <h2 id="identity-title" className="text-base font-bold">身份与邀请</h2>
      {token && <div className="mt-4 rounded-control border border-acid/40 bg-acid-soft p-4">
        <p className="text-sm font-semibold">你打开了一份管理员发出的身份邀请。</p>
        <p className="mt-1 text-xs leading-5 text-muted">邀请只对收到它的账号有效，只能使用一次。接受后身份立即生效，只影响之后产生的消费分佣。</p>
        <Button className="mt-3" variant="primary" size="sm" loading={busy} loadingText="正在接受" onClick={() => void accept()}>接受邀请</Button>
      </div>}
      {notice && <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'mt-3 text-sm text-danger' : 'mt-3 text-sm text-success'}>{notice.text}</p>}
      {mine.isPending ? <Skeleton className="mt-4 h-10" /> : mine.isError ? <ErrorState reason="身份信息加载失败。" action={{ label: '重试', onClick: () => void mine.refetch() }} /> : data && <>
        <dl className="mt-4 grid gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2"><dt className="text-muted">BD</dt><dd><Badge tone={data.bd_active ? 'success' : 'outline'}>{data.bd_active ? '已开通' : '未开通'}</Badge></dd></div>
          <div className="flex flex-wrap items-center gap-2"><dt className="text-muted">插件开发者</dt><dd><Badge tone={data.developer_state === 'approved' ? 'success' : 'outline'}>{data.developer_state ? DEVELOPER[data.developer_state] ?? data.developer_state : '未开通'}</Badge></dd></div>
        </dl>
        {data.pending.length > 0 && !token && <ul className="mt-3 grid gap-1 text-sm text-muted">{data.pending.map(row => <li key={row.id}>管理员已向你发出{ROLE[row.role]}邀请，{new Date(row.expires_at).toLocaleString('zh-CN')} 前有效。请打开管理员发送的邀请链接接受。</li>)}</ul>}
        {!data.bd_active && data.developer_state !== 'approved' && data.pending.length === 0 && !token && <p className="mt-3 text-xs leading-5 text-muted">BD 与插件开发者只能由平台管理员邀请开通，没有自助申请入口。</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {data.bd_active && <a href="/#wallet" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>BD 邀请链接与分佣</a>}
          {data.developer_state === 'approved' && <a href="/developer" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>开发者中心与分佣</a>}
        </div>
      </>}
    </section>
  )
}
