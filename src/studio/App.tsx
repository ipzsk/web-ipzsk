import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { NavLink, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router'
import { ArrowUp, Clapperboard, FolderOpen, Image, LayoutDashboard, MessagesSquare, Sparkles, type LucideIcon } from 'lucide-react'
import { Button, OfflineBanner, SessionExpiredBanner, SegmentedControl, cn, focusRing } from '@/ui'
import { StatesPage } from '@/ui/states-page'
import { MediaDndProvider } from '@/media'
import { useOnline, useUnauthorizedBroadcast } from '@/shared/query'
import { loginUrl } from '@/shared/api'
import { SiteHeader, type StudioKind } from './SiteHeader'
import { useComposer } from './store'
import { Composer } from './composer/Composer'
import { InspirationView } from './inspiration/InspirationView'
import { CreateView } from './create/CreateView'
import { AssetsView } from './assets/AssetsView'
import { CanvasView } from './canvas/CanvasView'
import { useCanvasAddListener } from './canvas/CanvasAddReceiver'
import { ThreadList } from './create/ThreadList'
import { SubjectsPanel } from './subjects/SubjectsPanel'
import { SubjectEditorHost } from './subjects/SubjectEditor'
import { TemplateDialogsHost } from './templates/TemplateDialogs'

const views: { id: string; to: string; label: string; icon: LucideIcon }[] = [
  { id: 'inspiration', to: '/studio', label: '灵感', icon: Sparkles },
  { id: 'create', to: '/studio/create', label: '创作', icon: MessagesSquare },
  { id: 'assets', to: '/studio/assets', label: '素材', icon: FolderOpen },
  { id: 'canvas', to: '/studio/canvas', label: '画布', icon: LayoutDashboard },
]
const viewKeyOf = (pathname: string) => pathname.split('/')[2] || 'inspiration'

// §4.4: each view remembers its own scroll position.
const scrollByView = new Map<string, number>()
function useScrollMemory(viewKey: string) {
  const current = useRef(viewKey)
  useLayoutEffect(() => {
    current.current = viewKey
    window.scrollTo(0, scrollByView.get(viewKey) ?? 0)
  }, [viewKey])
  useEffect(() => {
    const save = () => scrollByView.set(current.current, window.scrollY)
    window.addEventListener('scroll', save, { passive: true })
    return () => window.removeEventListener('scroll', save)
  }, [])
}

function NavItem({ to, label, icon: Icon, variant }: (typeof views)[number] & { variant: 'side' | 'tab' }) {
  return (
    <NavLink
      to={to}
      end={to === '/studio'}
      className={({ isActive }) => cn(
        'flex items-center rounded-control font-semibold transition-colors duration-(--duration-fast)',
        variant === 'side' ? 'h-10 gap-2.5 px-3 text-sm hover:bg-subtle' : 'h-14 flex-1 flex-col justify-center gap-0.5 text-[11px]',
        isActive ? (variant === 'side' ? 'bg-acid-soft text-label hover:bg-acid-soft' : 'text-ink') : 'text-ink/80',
        focusRing,
      )}
    >
      {({ isActive }) => <><Icon className={cn('size-[18px]', variant === 'tab' && isActive && 'text-acid-deep')} />{label}</>}
    </NavLink>
  )
}

function Layout() {
  const { pathname, search, hash } = useLocation()
  const viewKey = viewKeyOf(pathname)
  const online = useOnline()
  const sessionExpired = useUnauthorizedBroadcast()
  useScrollMemory(viewKey)
  const canvasAdd = useCanvasAddListener()
  const navigate = useNavigate()
  const studioKind: StudioKind = useComposer(s => s.mode === 'avatar' ? 'avatar' : s.kind)
  // Header 图片/视频/数字人: switch the composer in place; elsewhere also go to the (kind-aware) inspiration feed.
  const onStudioKind = (k: StudioKind) => {
    if (k === 'avatar') useComposer.setState({ kind: 'video', mode: 'avatar' })
    else useComposer.getState().setKind(k)
    if (pathname !== '/studio') navigate(`/studio?kind=${k}`)
  }
  // The composer is the single source of truth for ?kind= on the feed: every switch (header, composer toggle,
  // empty-state links) lands here and replaces the URL in place, keeping q/cat/case. Entry is read by readKindOnce.
  useEffect(() => {
    if (pathname !== '/studio') return
    const params = new URLSearchParams(search)
    if ((params.get('kind') ?? 'image') === studioKind) return
    params.set('kind', studioKind)
    navigate({ search: `?${params}`, hash }, { replace: true })
  }, [pathname, search, hash, studioKind, navigate])
  return (
    <MediaDndProvider>
    <div className="min-h-dvh">
      <div className="sticky top-0 z-40">
        {!online && <OfflineBanner />}
        {sessionExpired && <SessionExpiredBanner loginHref={loginUrl()} />}
        <SiteHeader studioKind={studioKind} onStudioKind={onStudioKind} />
      </div>
      <div className="md:grid md:grid-cols-[208px_1fr]">
        <aside aria-label="工作台" className="sticky top-16 hidden h-[calc(100dvh-64px)] flex-col gap-1 border-r border-line p-3 md:flex">
          {views.map(v => <NavItem key={v.id} {...v} variant="side" />)}
          <div className="my-2 h-px bg-line" />
          <ThreadList />
        </aside>
        <main className="min-w-0 px-4 pb-[calc(var(--composer-inset,0px)+32px)] pt-6 md:px-8 max-md:pb-[calc(var(--composer-inset,56px)+32px)]">
          <div key={viewKey} className="motion-safe:animate-fade-in"><Outlet /></div>
        </main>
      </div>
      <Composer hidden={viewKey === 'canvas' || viewKey === '_states'} />
      <nav aria-label="工作台" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        {views.map(v => <NavItem key={v.id} {...v} variant="tab" />)}
      </nav>
      <SubjectEditorHost />
      <TemplateDialogsHost />
      {canvasAdd}
    </div>
    </MediaDndProvider>
  )
}

function Placeholder({ title, children }: { title: string; children?: ReactNode }) {
  const params = useParams()
  return (
    <section>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-muted">占位视图{Object.keys(params).length ? ` · ${JSON.stringify(params)}` : ''}</p>
      {children}
    </section>
  )
}

export function App() {
  return (
    <Routes>
      <Route path="/studio" element={<Layout />}>
        <Route index element={<InspirationView />} />
        <Route path="create" element={<CreateView />} />
        <Route path="create/:threadId" element={<CreateView />} />
        <Route path="assets" element={<AssetsView />} />
        <Route path="assets/:folderId" element={<AssetsView />} />
        <Route path="subjects" element={<SubjectsPanel />} />
        <Route path="canvas" element={<CanvasView />} />
        <Route path="canvas/:projectId" element={<CanvasView />} />
        <Route path="_states" element={<StatesPage />} />
        <Route path="*" element={<Placeholder title="页面不存在" />} />
      </Route>
    </Routes>
  )
}
