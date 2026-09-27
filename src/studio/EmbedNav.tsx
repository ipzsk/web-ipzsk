// IPZSK Desktop nav pane: the studio sidebar laid over the desktop sidebar. It runs on a memory router that
// mirrors the main pane; any navigation here is forwarded to the main pane (see embed.ts).
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Wallet } from 'lucide-react'
import { cn, focusRing } from '@/ui'
import { formatMoney } from '@/shared/billing'
import { queryClient, useCurrentUser, useWallet } from '@/shared/query'
import { recordKeys } from './api/records'
import { NavItem, views } from './App'
import { ThreadList } from './create/ThreadList'
import type { StudioKind } from './SiteHeader'
import { postEmbed, useEmbedMessages } from './embed'

const kinds: { kind: StudioKind; label: string }[] = [
  { kind: 'image', label: '图片' },
  { kind: 'video', label: '视频' },
  { kind: 'avatar', label: '数字人' },
]

/** Balance as a nav row; recharge opens in the main pane, the nav pane is too narrow for the dialog. */
function WalletRow() {
  const { data: wallet, isError } = useWallet()
  if (isError || !wallet) return null
  const available = Number(wallet.available_cny)
  return (
    <button
      type="button"
      onClick={() => postEmbed({ type: 'recharge' })}
      aria-haspopup="dialog"
      className={cn('flex h-8 cursor-pointer items-center gap-2 rounded-control px-2 text-sm text-ink/80 hover:bg-subtle', focusRing)}
    >
      <Wallet className="size-[18px]" />余额
      <span className="ml-auto tabular-nums text-ink">{formatMoney(available)}</span>
      <span className={cn('text-xs', available <= 0 ? 'text-danger' : 'text-acid')}>{available <= 0 ? '去充值' : '充值'}</span>
    </button>
  )
}

export function EmbedNav() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const { data: user } = useCurrentUser()
  const [kind, setKind] = useState<StudioKind>('image')
  const mainPath = useRef<string | null>(null)

  useEmbedMessages(m => {
    if (m.type !== 'state') return
    setKind(m.kind)
    // The main pane may have created, renamed or opened a thread.
    if (m.path !== mainPath.current) void queryClient.invalidateQueries({ queryKey: recordKeys.threads })
    mainPath.current = m.path
    if (m.path !== pathname + search) navigate(m.path, { replace: true })
  })
  useEffect(() => { postEmbed({ type: 'hello' }) }, [])
  useEffect(() => {
    const here = pathname + search
    if (mainPath.current === null || here === mainPath.current) return
    mainPath.current = here
    postEmbed({ type: 'route', to: here })
  }, [pathname, search])

  return (
    // pl-1 / pr-3 undo the desktop region area's own overhang, so edges line up with the tabs above.
    <div className="flex h-dvh flex-col gap-0.5 pb-2 pl-1 pr-3 pt-1.5">
      {/* Same look as the desktop's 新会话 / 生图 tabs (imagegen panel.module.css .sessionTabs). */}
      <div role="tablist" aria-label="创作类型" className="mb-2 grid grid-cols-3 gap-0.5 rounded-[9px] border border-black/[0.04] bg-white p-[3px]">
        {kinds.map(k => (
          <button
            key={k.kind}
            type="button"
            role="tab"
            aria-selected={kind === k.kind}
            onClick={() => { setKind(k.kind); postEmbed({ type: 'kind', kind: k.kind }) }}
            className={cn('h-[30px] cursor-pointer rounded-[7px] text-xs', kind === k.kind ? 'bg-acid-soft text-ink' : 'text-[rgb(97,102,107)] hover:bg-acid-soft hover:text-ink', focusRing)}
          >{k.label}</button>
        ))}
      </div>
      {views.map(v => <NavItem key={v.id} {...v} variant="side" />)}
      {user && <WalletRow />}
      <div className="mx-2 my-2 h-px bg-line" />
      <ThreadList />
    </div>
  )
}
