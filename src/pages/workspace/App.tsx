import { useEffect, type ComponentType } from 'react'
import {
  Archive as ArchiveIcon, ArrowUpRight, CalendarDays, Check, CloudOff, HardDrive, Images as ImagesIcon, LayoutDashboard,
  LayoutTemplate, Lightbulb, LoaderCircle, Menu, PenLine, Plus, SlidersHorizontal, Sparkles, Trash2, TriangleAlert, X,
} from 'lucide-react'
import { Button, IconButton, OfflineBanner, cn, focusRing } from '@/ui'
import { SiteHeader } from '@/studio/SiteHeader'
import { useOnline } from '@/shared/query'
import { VIEWS, activeProject, activeSpace, type View, type WorkspaceState } from './model'
import { openDialog, show, switchSpace, useNav } from './actions'
import {
  connectCloud, loadCloudReplacingLocal, loadImages, onForeignWrite, setOwner, statusText, useWorkspace,
} from './store'
import { resolveOwner } from './api'
import { AiDialog, CreateDialog, VersionsDialog } from './dialogs'
import { Overview } from './views/Overview'
import { Archive, Calendar, Settings, Topics, TrashView } from './views/Lists'
import { Editor } from './views/Editor'
import { Images } from './views/Images'
import { Layout } from './views/Layout'

const NAV: { view: View; icon: ComponentType<{ className?: string }> }[] = [
  { view: 'overview', icon: LayoutDashboard }, { view: 'topics', icon: Lightbulb }, { view: 'editor', icon: PenLine },
  { view: 'images', icon: ImagesIcon }, { view: 'layout', icon: LayoutTemplate }, { view: 'archive', icon: ArchiveIcon },
  { view: 'calendar', icon: CalendarDays }, { view: 'trash', icon: Trash2 }, { view: 'settings', icon: SlidersHorizontal },
]
const PANELS: Record<View, ComponentType<{ data: WorkspaceState }>> = {
  overview: Overview, topics: Topics, editor: Editor, images: Images, layout: Layout, archive: Archive, calendar: Calendar, trash: TrashView, settings: Settings,
}

let authRun = 0
/** Legacy auth(): re-run on focus / visibility; switches drafts when the verified account changes. */
export async function auth() {
  const run = ++authRun
  const id = await resolveOwner()
  if (run !== authRun) return
  // ponytail: legacy treated a network failure as "signed out" and swapped to guest drafts; we keep the current owner instead.
  if (id === undefined) { useWorkspace.setState({ authKnown: true }); return }
  if (setOwner(id)) openDialog(null)
  const d = useWorkspace.getState().data
  if (location.hash === '#images' || activeProject(d)?.cover) void loadImages()
}

function useLegacyEvents() {
  useEffect(() => {
    void auth()
    const onHash = () => show(location.hash.slice(1))
    const onVisible = () => { if (!document.hidden) void auth() }
    const onFocus = () => void auth()
    const onBeforeUnload = (e: BeforeUnloadEvent) => { const s = useWorkspace.getState(); if (s.owner && s.dirty) { e.preventDefault(); e.returnValue = '' } }
    const onOnline = () => { if (useWorkspace.getState().owner) void connectCloud() }
    const onStorage = (e: StorageEvent) => onForeignWrite(e.key)
    window.addEventListener('hashchange', onHash)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('online', onOnline)
    window.addEventListener('storage', onStorage)
    if (location.hash.slice(1) === 'images') show('images')
    return () => {
      window.removeEventListener('hashchange', onHash)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
}

function SaveIndicator() {
  const s = useWorkspace()
  const text = statusText(s)
  const Icon = !s.authKnown || s.cloudBusy ? LoaderCircle : s.saveFailed ? TriangleAlert : !s.owner ? HardDrive : !s.cloudReady ? CloudOff : s.dirty ? HardDrive : Check
  return (
    <span role="status" data-testid="save-status" className={cn('inline-flex min-w-0 items-center gap-1.5 text-[12px]', s.saveFailed || (s.owner && !s.cloudReady && s.authKnown) ? 'text-warning' : 'text-label')}>
      <Icon className={cn('size-4 shrink-0', (Icon === LoaderCircle) && 'motion-safe:animate-spin-slow')} />
      <span className="truncate">{text}</span>
    </span>
  )
}

function SyncNotice() {
  const { notice, owner } = useWorkspace()
  if (!notice) return null
  return (
    <div role="alert" className="mb-6 rounded-card border border-warning/40 bg-warning/8 p-4 text-sm">
      <p className="mb-3 flex gap-2"><TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />{notice}</p>
      <div className="flex flex-wrap gap-2.5">
        <Button size="sm" disabled={!owner} disabledReason="请先登录账号。" onClick={() => void connectCloud()}>重试云端同步</Button>
        <Button size="sm" variant="primary" disabled={!owner} disabledReason="请先登录账号。" onClick={() => void loadCloudReplacingLocal()}>备份本机并载入云端</Button>
      </div>
    </div>
  )
}

function Sidebar({ data }: { data: WorkspaceState }) {
  const { view, sidebarOpen } = useNav()
  const owner = useWorkspace(s => s.owner)
  const space = activeSpace(data)
  return (
    <>
      {sidebarOpen && <div className="fixed inset-0 z-30 bg-ink/30 md:hidden print:hidden" onClick={() => useNav.setState({ sidebarOpen: false })} />}
      <aside
        id="sidebar"
        className={cn(
          'flex w-[244px] shrink-0 flex-col overflow-auto border-r border-line bg-card px-4 py-6 print:hidden',
          'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:shadow-2xl max-md:transition-transform max-md:duration-(--duration-base)',
          'md:sticky md:top-0 md:h-dvh',
          sidebarOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full max-md:invisible',
        )}
      >
        <div className="mb-2 flex justify-end md:hidden"><IconButton label="收起导航" onClick={() => useNav.setState({ sidebarOpen: false })}><X className="size-[18px]" /></IconButton></div>
        <div className="rounded-card border border-line bg-subtle p-3.5">
          <label htmlFor="space-select" className="text-[10px] tracking-[1px] text-muted">当前内容空间</label>
          <select id="space-select" aria-label="切换内容空间" value={space?.id} onChange={e => switchSpace(e.target.value)} className={cn('mt-1 w-full cursor-pointer rounded-[6px] bg-transparent py-1 text-[13px] font-bold hover:bg-card', focusRing)}>
            {data.spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Button variant="ghost" size="sm" className="-ml-2 mt-1 h-7 px-2 text-xs" icon={<Plus aria-hidden className="size-4" />} onClick={() => openDialog('space')}>新建空间</Button>
        </div>
        <p className="mx-2 mb-3 mt-7 text-[9px] tracking-[1.7px] text-muted">YOUR CREATIVE WORKFLOW</p>
        <nav aria-label="创作流程" className="grid gap-1">
          {NAV.map(({ view: v, icon: Icon }, i) => (
            <button
              key={v} type="button" aria-current={view === v ? 'page' : undefined} onClick={() => show(v)}
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-3 text-left text-[13px] font-semibold transition-colors duration-(--duration-fast) hover:bg-subtle motion-safe:active:scale-[.98]',
                'aria-[current=page]:bg-acid-soft aria-[current=page]:text-label aria-[current=page]:hover:bg-acid-soft', focusRing,
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1">{VIEWS[v]}</span>
              <small className="text-[9px] font-normal tracking-[1px] text-muted">{i ? String(i).padStart(2, '0') : 'HOME'}</small>
            </button>
          ))}
        </nav>
        <div className="mt-auto px-2.5 pb-6 pt-8">
          <Sparkles aria-hidden className="size-6 text-acid-deep" />
          <strong className="mt-2.5 block text-xs">你的方向，你的节奏。</strong>
          <p className="mt-2 text-[11px] leading-[1.9] text-muted">每个空间有独立的关注方向。<br />从一个选题开始，慢慢积累。</p>
        </div>
        <div className="grid gap-1 border-t border-line pt-3 text-[12px] text-muted">
          <a href="/workstation#download" className={cn('inline-flex items-center gap-1 rounded-[6px] px-2 py-1 hover:bg-subtle hover:text-ink', focusRing)}>下载桌面端<ArrowUpRight aria-hidden className="size-3.5" /></a>
          <a href={owner ? '/account' : '/account?next=workspace'} className={cn('inline-flex items-center gap-1 rounded-[6px] px-2 py-1 hover:bg-subtle hover:text-ink', focusRing)}>{owner ? '个人中心' : '登录 / 注册'}<ArrowUpRight aria-hidden className="size-3.5" /></a>
        </div>
      </aside>
    </>
  )
}

export function App() {
  useLegacyEvents()
  const data = useWorkspace(s => s.data)
  const owner = useWorkspace(s => s.owner)
  const { view, sidebarOpen } = useNav()
  const online = useOnline()
  const Panel = PANELS[view]
  if (!activeSpace(data)) return null
  return (
    <div className="min-h-dvh overflow-x-clip">
      <div className="print:hidden"><SiteHeader /></div>
      {!online && <div className="print:hidden"><OfflineBanner /></div>}
      <div className="flex">
        <Sidebar data={data} />
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-[60px] items-center justify-between gap-3 border-b border-line bg-paper/95 px-4 backdrop-blur-md sm:px-6 lg:h-[76px] lg:px-10 print:hidden">
            <div className="flex min-w-0 items-center gap-3 whitespace-nowrap text-[12px]">
              <IconButton label="展开导航" className="md:hidden" aria-expanded={sidebarOpen} aria-controls="sidebar" onClick={() => useNav.setState({ sidebarOpen: true })}><Menu className="size-[18px]" /></IconButton>
              <span className="text-muted max-md:hidden">我的工作空间</span><span className="text-muted/50 max-md:hidden">/</span>
              <strong>{VIEWS[view]}</strong>
            </div>
            <SaveIndicator />
          </header>
          <main id="main" tabIndex={-1} className="mx-auto min-h-[calc(100dvh-140px)] max-w-[1400px] px-4 pt-7 outline-none sm:px-6 lg:px-10 lg:pt-11 print:p-0">
            <div className="print:hidden"><SyncNotice /></div>
            <section key={view} className="motion-safe:animate-fade-in"><Panel data={data} /></section>
            <footer className="mt-9 flex flex-col justify-between gap-1 border-t border-line py-5 text-[11px] text-muted sm:flex-row print:hidden">
              <span>IPZSK · 让内容成为可积累的资产</span><span>自动保存 · 图片云端归档</span>
            </footer>
          </main>
        </div>
      </div>
      <CreateDialog />
      <VersionsDialog data={data} />
      <AiDialog key={owner ?? 'guest'} data={data} />
    </div>
  )
}
