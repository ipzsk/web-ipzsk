import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ImageOff, RotateCw } from 'lucide-react'
import { cn } from './cn'
import { pickUrl, type MediaAsset, type MediaSize } from './types'

type Props = {
  /** Either a full asset, or urls + intrinsic size. */
  asset?: MediaAsset
  urls?: MediaAsset['urls']
  width?: number | null
  height?: number | null
  sizes?: MediaSize
  alt: string
  priority?: boolean
  /** Called once when the thumbnail keeps failing (signed URL probably expired) — refetch metadata. */
  onExpired?: () => void
  fit?: 'cover' | 'contain'
  className?: string
  /** Hide the 「处理中」 badge (e.g. when the parent card shows its own status). */
  hideBadge?: boolean
}

/** Placeholder for a referenced asset the server reports as `missing` (deleted / failed). */
export function MissingMedia({ className, label = '素材已删除' }: { className?: string; label?: string }) {
  return (
    <div role="img" aria-label={label} className={cn('flex aspect-square flex-col items-center justify-center gap-1 bg-subtle p-1 text-center text-[11px] leading-tight text-muted', className)}>
      <ImageOff size={16} aria-hidden />{label}
    </div>
  )
}

const RETRIES = 2
type Phase = { src: 'primary' | 'orig'; attempt: number; failed: boolean }
const INITIAL: Phase = { src: 'primary', attempt: 0, failed: false }

export function MediaImage({ asset, urls: urlsProp, width, height, sizes = 'thumb', alt, priority, onExpired, fit = 'cover', className, hideBadge }: Props) {
  const urls = asset?.urls ?? urlsProp ?? { orig: '' }
  const w = asset?.width ?? width ?? null
  const h = asset?.height ?? height ?? null
  const primary = pickUrl(urls, sizes)

  const [phase, setPhase] = useState<Phase>(INITIAL)
  const [loaded, setLoaded] = useState(false)
  const [instant, setInstant] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // New URLs (e.g. refreshed signatures) reset the retry ladder.
  const [prevKey, setPrevKey] = useState(primary + urls.orig)
  if (prevKey !== primary + urls.orig) {
    setPrevKey(primary + urls.orig)
    setPhase(INITIAL)
    setLoaded(false)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  const src = phase.src === 'orig' ? urls.orig : primary

  // Cache hit: already complete on mount → show without fade.
  useLayoutEffect(() => {
    const img = imgRef.current
    if (img?.complete && img.naturalWidth > 0) { setInstant(true); setLoaded(true) }
  }, [src, phase.attempt])

  const onError = () => {
    if (phase.src === 'primary' && phase.attempt < RETRIES) {
      const next = phase.attempt + 1
      timer.current = setTimeout(() => setPhase({ src: 'primary', attempt: next, failed: false }), 400 * 2 ** phase.attempt)
    } else if (phase.src === 'primary' && primary !== urls.orig) {
      onExpired?.()
      setPhase({ src: 'orig', attempt: 0, failed: false })
    } else {
      if (primary === urls.orig) onExpired?.()
      setPhase({ ...phase, failed: true })
    }
  }

  const processing = !hideBadge && (asset?.status === 'pending' || (asset?.thumb_state
    ? asset.thumb_state === 'queued' || asset.thumb_state === 'running'
    : !urls.w480 && !urls.w960 && !!urls.orig && !urls.orig.startsWith('blob:')))

  return (
    <div
      className={cn('relative overflow-hidden bg-subtle', className)}
      style={{ aspectRatio: w && h ? `${w} / ${h}` : '1 / 1' }}
    >
      {phase.failed || !src ? (
        <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center text-muted">
          <ImageOff size={24} aria-hidden />
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-xs text-ink hover:bg-line active:scale-[.98] motion-reduce:active:scale-100 transition-[background-color,transform] duration-fast"
            onClick={(e) => { e.stopPropagation(); setPhase(INITIAL); setLoaded(false) }}
          >
            <RotateCw size={12} aria-hidden />图片加载失败 · 重试
          </button>
        </div>
      ) : (
        <img
          ref={imgRef}
          // key forces a fresh request on retry (same signed URL can't take a cache-buster)
          key={`${phase.src}-${phase.attempt}`}
          src={src}
          alt={alt}
          width={w ?? undefined}
          height={h ?? undefined}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : 'auto'}
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={onError}
          className={cn(
            'absolute inset-0 h-full w-full',
            fit === 'cover' ? 'object-cover' : 'object-contain',
            !instant && 'transition-opacity duration-base ease-standard',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
      {processing && (
        <span className="absolute bottom-2 left-2 rounded-full bg-ink/75 px-2 py-0.5 text-[11px] text-card">处理中</span>
      )}
    </div>
  )
}
