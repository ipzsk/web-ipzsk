import { useRef, useState, type KeyboardEvent } from 'react'
import { Play } from 'lucide-react'
import {
  MediaController, MediaControlBar, MediaPlayButton, MediaTimeRange, MediaTimeDisplay, MediaMuteButton, MediaFullscreenButton,
} from 'media-chrome/react'
import { cn } from './cn'
import { reducedMotion, type MediaAsset } from './types'
import { useFreshUrls } from './fresh'

// Page-wide: only one video plays at a time.
let current: HTMLVideoElement | null = null
export function claimPlayback(v: HTMLVideoElement) {
  if (current && current !== v && !current.paused) current.pause()
  current = v
}

type Props = {
  asset?: MediaAsset
  src?: string
  /** With `src` (no asset): the asset id, so an expired signed URL can be refreshed (§7.2). */
  assetId?: string
  poster?: string
  width?: number | null
  height?: number | null
  mode?: 'hoverPlay' | 'controls'
  label: string
  className?: string
  /** hoverPlay: set false when a parent (e.g. MediaCard) owns focus and keyboard. */
  focusable?: boolean
}

const fmt = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

export function MediaVideo({ asset, src, assetId, poster, width, height, mode = 'hoverPlay', label, className, focusable = true }: Props) {
  const fresh = useFreshUrls(asset?.id ?? assetId, asset ? asset.urls : { orig: src ?? '', ...(poster && { poster }) })
  const url = fresh.urls.orig
  const cover = fresh.urls.poster
  const w = asset?.width ?? width ?? null
  const h = asset?.height ?? height ?? null
  const ref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const box = { aspectRatio: w && h ? `${w} / ${h}` : '16 / 9' }

  if (mode === 'controls') {
    return (
      <MediaController className={cn('block overflow-hidden bg-ink', className)} style={box}>
        <video
          slot="media" ref={ref} src={url} poster={cover} preload="metadata" playsInline aria-label={label} onError={() => fresh.onError(url)}
          onPlay={(e) => claimPlayback(e.currentTarget)}
          className="h-full w-full object-contain"
        />
        <MediaControlBar>
          <MediaPlayButton /><MediaTimeRange /><MediaTimeDisplay showDuration /><MediaMuteButton /><MediaFullscreenButton />
        </MediaControlBar>
      </MediaController>
    )
  }

  const play = () => { const v = ref.current; if (!v) return; claimPlayback(v); v.play().catch(() => {}) }
  const stop = () => { const v = ref.current; if (!v) return; v.pause(); v.currentTime = 0 }
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== ' ' || e.target !== e.currentTarget) return
    e.preventDefault()
    const v = ref.current
    if (v?.paused) play(); else v?.pause()
  }

  return (
    <div
      tabIndex={focusable ? 0 : undefined}
      aria-label={focusable ? `${label}，按空格播放或暂停` : undefined}
      className={cn('group/video relative overflow-hidden bg-subtle', className)}
      style={box}
      onMouseEnter={() => !reducedMotion() && play()}
      onMouseLeave={stop}
      onFocus={(e) => e.target === e.currentTarget && !reducedMotion() && play()}
      onBlur={stop}
      onKeyDown={onKey}
    >
      <video
        ref={ref} src={url} poster={cover} preload="none" muted playsInline loop onError={() => fresh.onError(url)}
        onPlay={(e) => { claimPlayback(e.currentTarget); setPlaying(true) }}
        onPause={() => setPlaying(false)}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <span
        className={cn(
          'pointer-events-none absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-ink/75 px-2 py-0.5 text-[11px] text-card transition-opacity duration-fast',
          playing && 'opacity-0',
        )}
      >
        <Play size={10} aria-hidden fill="currentColor" />
        {asset?.duration_ms ? fmt(asset.duration_ms) : '视频'}
      </span>
    </div>
  )
}
