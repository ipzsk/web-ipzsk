import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, ChevronDown, Download, LoaderCircle } from 'lucide-react'
import { cn, focusRing } from '@/ui'
import { PLATFORMS, RELEASE_PAGE, detectPlatform, fetchRelease, releaseOptions, type Option } from './release'

// Designer look from commit 479bf1e (lockup, sticker hero, serif headline, rotating phrase, download menu),
// recoloured with IPZSK tokens; legacy feature cards kept below with /studio entry links.
const serif = 'font-["Songti_SC","Noto_Serif_SC","STSong","SimSun",serif]'
const PHRASES = ['帮你生图', '帮你生视频', '帮你生产内容']
const FEATURES = [
  { badge: '现已开放', title: '生图', text: '描述画面，生成图片。查看当前账号的云端图片记录。', href: '/studio?kind=image', link: '开始生图', dark: true },
  { badge: '已接入', title: '生视频', text: '登录后使用账户余额生成 AI 视频，支持清晰度、时长设置与任务进度查询。', href: '/studio?kind=video', link: '开始生成视频' },
  { badge: '现已开放', title: '内容工作台', text: '整理选题、编辑文稿、预览排版。当前草稿保存在本机。', href: '/workspace', link: '进入内容工作台' },
  { badge: '账号与服务', title: '我的', text: '查看个人资料、账户余额、充值与消费记录，管理自己的创作入口。', href: '/account', link: '打开个人中心' },
]
const STICKERS = [
  { src: '/assets/stickers/sticker-camera.png', cls: 'top-[8%] -left-[22px] w-[94px] -rotate-4 md:left-[1%] md:w-[145px]', delay: '0s' },
  { src: '/assets/stickers/sticker-video.png', cls: 'top-[9%] -right-[24px] w-[104px] rotate-5 md:right-[1%] md:w-[160px]', delay: '-.9s' },
  { src: '/assets/stickers/sticker-brush.png', cls: 'bottom-[9%] -left-[18px] w-[82px] -rotate-8 md:left-[11%] md:w-[125px]', delay: '-1.7s' },
  { src: '/assets/stickers/sticker-board.png', cls: 'bottom-[2%] left-[31%] w-[94px] rotate-3 md:bottom-[4%] md:left-[25%] md:w-[145px]', delay: '-2.5s' },
  { src: '/assets/stickers/sticker-brain.png', cls: 'bottom-[10%] -right-[6px] w-[80px] md:right-[5%] md:w-[120px]', delay: '-3.2s' },
]

function useRotatingPhrase() {
  const [i, setI] = useState(0)
  const [changing, setChanging] = useState(false)
  useEffect(() => {
    let inner: ReturnType<typeof setTimeout>
    const t = setInterval(() => {
      setChanging(true)
      inner = setTimeout(() => { setI(n => (n + 1) % PHRASES.length); setChanging(false) }, 180)
    }, 2200)
    return () => { clearInterval(t); clearTimeout(inner) }
  }, [])
  return { phrase: PHRASES[i]!, changing }
}

type ReleaseState = { status: 'loading' } | { status: 'ready'; version: string; options: Option[] } | { status: 'error'; options: Option[] }

export function useRelease() {
  const [state, setState] = useState<ReleaseState>({ status: 'loading' })
  useEffect(() => {
    const ac = new AbortController()
    fetchRelease(ac.signal)
      .then(p => setState({ status: 'ready', version: p.version, options: releaseOptions(p) }))
      .catch((e: Error & { releasePage?: string }) => { if (e.name !== 'AbortError') setState({ status: 'error', options: releaseOptions(null, e.releasePage) }) })
    return () => ac.abort()
  }, [])
  return state
}

function DownloadMenu() {
  const [open, setOpen] = useState(false)
  const release = useRelease()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const device = detectPlatform(navigator.userAgent, navigator.platform)
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) { setOpen(false); trigger.current?.focus() } }
    document.addEventListener('pointerdown', down); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key) }
  }, [open])
  useEffect(() => { if (location.hash === '#download') setOpen(true) }, [])
  const options = release.status === 'loading' ? null : release.options
  return (
    <div ref={root} id="download" className="group/dl scroll-mt-32 md:relative">
      <button
        ref={trigger} type="button" aria-haspopup="true" aria-expanded={open} aria-controls="download-menu" onClick={() => setOpen(o => !o)}
        className={cn('inline-flex h-[54px] min-w-[148px] cursor-pointer items-center justify-center gap-2 rounded-full border border-ink bg-ink px-6 text-[14px] font-extrabold text-white shadow-[0_14px_28px_rgba(21,24,21,.16)] transition-[transform,box-shadow] duration-(--duration-fast) hover:shadow-[0_18px_32px_rgba(21,24,21,.23)] motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[.98]', focusRing)}
      >
        <Download aria-hidden className="size-[18px]" />立即下载<ChevronDown aria-hidden className={cn('size-4 transition-transform duration-(--duration-fast)', open && 'rotate-180')} />
      </button>
      <div
        id="download-menu" role="menu" aria-label="选择下载版本"
        className={cn(
          'absolute left-1/2 top-[calc(100%+12px)] z-10 w-[min(352px,calc(100vw-28px))] -translate-x-1/2 rounded-[19px] border border-line bg-card p-3.5 text-left shadow-[0_24px_55px_rgba(21,24,21,.16)]',
          'transition-[opacity,translate] duration-(--duration-base) ease-(--ease-standard)',
          open ? 'visible opacity-100' : 'invisible opacity-0 motion-safe:-translate-y-[7px]',
          'md:group-hover/dl:visible md:group-hover/dl:translate-y-0 md:group-hover/dl:opacity-100',
        )}
      >
        <div className="flex items-baseline justify-between gap-3 px-2 pb-3 pt-1 text-[13px] font-black">
          <span>选择安装版本</span><small className="text-[11px] font-bold text-label">{device ? `当前设备：${PLATFORMS.find(p => p.id === device)!.label}` : '支持 Mac 与 Windows'}</small>
        </div>
        {PLATFORMS.map((p, i) => {
          const o = options?.[i]
          return (
            <a
              key={p.id} role="menuitem" data-platform={p.id} href={o?.href ?? RELEASE_PAGE} aria-busy={!o || undefined}
              title={o?.direct ? `${p.label} · ${o.meta}` : '前往 GitHub 发布页选择安装包'}
              className={cn('flex min-h-16 items-center justify-between gap-4 rounded-control border-t border-line p-2.5 transition-colors duration-(--duration-fast) hover:bg-subtle', !o && 'cursor-progress', device === p.id && 'bg-acid/25', focusRing, 'focus-visible:outline-offset-[-2px]')}
            >
              <span className="grid gap-1">
                <strong className="text-[15px] tracking-[-.025em]">{p.label}</strong>
                <small className="text-[11px] text-muted">{p.hint}{o?.meta ? ` · ${o.meta}` : ''}</small>
              </span>
              <b className="inline-flex shrink-0 items-center gap-1 text-[12px] font-black text-label">
                {!o ? <><LoaderCircle aria-hidden className="size-3.5 motion-safe:animate-spin-slow" />读取版本…</>
                  : o.direct ? <>{o.action}<Download aria-hidden className="size-3.5" /></> : <>{o.action}<ArrowUpRight aria-hidden className="size-3.5" /></>}
              </b>
            </a>
          )
        })}
        <p role="status" className={cn('mx-2 mb-0.5 mt-2 text-[11px] leading-normal', release.status === 'error' ? 'text-danger' : 'text-muted')}>
          {release.status === 'loading' ? '正在获取最新正式版…' : release.status === 'ready' ? `当前正式版 v${release.version} · 生图等插件请在客户端插件市场安装和更新。` : '暂时无法读取版本，前往 GitHub 发布页选择安装包。'}
        </p>
      </div>
    </div>
  )
}

export function Home() {
  const { phrase, changing } = useRotatingPhrase()
  return (
    <div className="min-h-dvh overflow-x-clip bg-paper text-ink antialiased">
      <main>
        <section aria-labelledby="hero-title" className="relative mx-auto flex min-h-[calc(100svh-104px)] w-[min(1340px,calc(100%-28px))] items-center justify-center pb-24 pt-14 md:min-h-[calc(100svh-64px)] md:w-[min(1340px,calc(100%-80px))] md:pb-[82px] md:pt-12">
          <div aria-hidden className="pointer-events-none absolute inset-0 z-[1] overflow-hidden">
            {STICKERS.map(s => (
              <img key={s.src} src={s.src} alt="" loading="lazy" decoding="async" style={{ animationDelay: s.delay }}
                className={cn('absolute h-auto opacity-90 mix-blend-multiply drop-shadow-[0_10px_11px_rgba(29,31,32,.08)] motion-safe:animate-[sticker-jitter_4.8s_ease-in-out_infinite]', s.cls)} />
            ))}
          </div>
          <div className="relative z-[2] w-full text-center">
            <div className={cn(serif, 'mb-4 flex min-h-[38px] items-center justify-center whitespace-nowrap text-[clamp(24px,7vw,31px)] md:mb-6 md:min-h-12 md:text-[clamp(30px,3.4vw,38px)]')} aria-live="polite">
              <img src="/assets/ipzsk-wordmark.png" alt="IPZSK" width={210} height={38} className="h-[31px] w-[150px] object-contain mix-blend-multiply md:h-[38px] md:w-[210px]" />
              <span aria-hidden> · </span>
              <span className={cn('inline-block w-[6.2em] text-left font-bold text-label transition-[opacity,translate] duration-150', changing && 'opacity-0 motion-safe:translate-y-[7px]')}>{phrase}</span>
            </div>
            <h1 id="hero-title" className={cn(serif, 'm-0 text-[clamp(66px,18vw,100px)] font-normal leading-[.98] tracking-[-.09em] md:text-[clamp(78px,10vw,156px)] md:whitespace-nowrap')}>
              把 <span className='font-["Times_New_Roman","Songti_SC",serif] font-semibold text-label'>AI</span>，装进你的电脑。
            </h1>
            <p className="mx-auto mt-7 text-[14px] leading-[1.8] text-muted md:text-[17px] md:leading-[1.85]">一个面向创作与知识工作的 AI 工作台。<br />下载客户端，或直接在线体验。</p>
            <div className="relative mt-8 flex flex-wrap items-start justify-center gap-3">
              <DownloadMenu />
              <a href="/workspace" className={cn('inline-flex h-[54px] items-center justify-center gap-2 rounded-full border border-line bg-card/50 px-6 text-[14px] font-extrabold transition-[transform,background-color] duration-(--duration-fast) hover:bg-card motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[.98]', focusRing)}>
                在线体验<ArrowUpRight aria-hidden className="size-[18px]" />
              </a>
            </div>
            <p className="mt-6 text-[11px] font-bold text-muted">Mac · Windows / 插件独立安装与更新</p>
          </div>
        </section>

        <section id="features" className="mx-auto w-[min(1180px,calc(100%-28px))] py-16 md:w-[min(1180px,calc(100%-80px))] md:py-24">
          <div className="mb-8 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
            <div>
              <span className="text-[11px] font-black tracking-[.14em] text-label">CREATE YOUR WAY</span>
              <h2 className={cn(serif, 'mt-2.5 text-[38px] font-normal leading-[1.05] tracking-[-.04em] md:text-[clamp(34px,4vw,56px)]')}>也可以，直接在网页里开始。</h2>
            </div>
            <p className="max-w-[390px] text-[13px] leading-[1.75] text-muted">创作工具和账号服务，各有清晰的入口。</p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            {FEATURES.map((f, i) => (
              <a
                key={f.title} href={f.href}
                className={cn(
                  'group flex min-h-[250px] flex-col rounded-panel border border-line p-6 shadow-[0_10px_38px_rgba(33,37,29,.055)] transition-[transform,box-shadow] duration-(--duration-base) ease-(--ease-standard) hover:shadow-[0_22px_50px_rgba(33,37,29,.10)] motion-safe:hover:-translate-y-1 motion-safe:active:scale-[.99] md:min-h-[300px]',
                  i === 0 || i === 3 ? 'md:col-span-7' : 'md:col-span-5',
                  f.dark ? 'bg-ink text-card' : 'bg-card', focusRing,
                )}
              >
                <span className={cn('self-start rounded-full px-2.5 py-1.5 text-[10px] font-black', f.dark ? 'bg-white/12 text-white' : 'bg-subtle text-muted')}>{f.badge}</span>
                <h3 className="mb-2 mt-auto pt-6 text-[28px] font-bold tracking-[-.045em]">{f.title}</h3>
                <p className={cn('max-w-[460px] text-[13px] leading-[1.75]', f.dark ? 'text-card/70' : 'text-muted')}>{f.text}</p>
                <span className={cn('mt-5 inline-flex items-center gap-2 text-[12px] font-black', f.dark ? 'text-white' : 'text-label')}>{f.link}<ArrowUpRight aria-hidden className="size-4 transition-transform duration-(--duration-fast) motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5" /></span>
              </a>
            ))}
          </div>
        </section>
      </main>
      <footer className="mx-auto flex w-[min(1340px,calc(100%-28px))] flex-col justify-between gap-2 border-t border-line py-6 text-[11px] text-muted md:w-[min(1340px,calc(100%-80px))] md:flex-row">
        <span><strong className="text-ink">IPZSK</strong> · AI 创作工作台</span><span>把想法，推进到发布。</span>
      </footer>
    </div>
  )
}
