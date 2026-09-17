import { useEffect, useRef } from 'react'
import Lightbox, { type Slide } from 'yet-another-react-lightbox'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import Video from 'yet-another-react-lightbox/plugins/video'
import Download from 'yet-another-react-lightbox/plugins/download'
import Captions from 'yet-another-react-lightbox/plugins/captions'
import 'yet-another-react-lightbox/styles.css'
import 'yet-another-react-lightbox/plugins/captions.css'
import { MediaVideo } from './MediaVideo'
import { reducedMotion, type MediaAsset } from './types'

export type LightboxItem = { asset: MediaAsset; caption?: string; filename?: string }

type Props = {
  items: LightboxItem[]
  index: number
  open: boolean
  onIndexChange: (index: number) => void
  onClose: () => void
}

function toSlide({ asset: a, caption, filename }: LightboxItem): Slide {
  const w = a.width ?? undefined
  const h = a.height ?? undefined
  const download = { url: a.urls.orig, filename: filename ?? a.id }
  if (a.kind === 'video') {
    return { type: 'video', width: w, height: h, poster: a.urls.poster, sources: [{ src: a.urls.orig, type: 'video/mp4' }], title: caption, download }
  }
  const srcSet = w && h
    ? [
        a.urls.w480 && { src: a.urls.w480, width: 480, height: Math.round((480 * h) / w) },
        a.urls.w960 && { src: a.urls.w960, width: 960, height: Math.round((960 * h) / w) },
        { src: a.urls.orig, width: w, height: h },
      ].filter((x): x is { src: string; width: number; height: number } => !!x)
    : undefined
  return { src: a.urls.w960 ?? a.urls.orig, width: w, height: h, srcSet, alt: caption, title: caption, download }
}

export function MediaLightbox({ items, index, open, onIndexChange, onClose }: Props) {
  // Return focus to whatever opened us.
  const trigger = useRef<HTMLElement | null>(null)
  useEffect(() => { if (open) trigger.current = document.activeElement as HTMLElement | null }, [open])

  const still = reducedMotion()
  return (
    <Lightbox
      open={open}
      close={onClose}
      index={index}
      slides={items.map(toSlide)}
      plugins={[Zoom, Video, Download, Captions]}
      carousel={{ preload: 2, finite: true }}
      controller={{ closeOnBackdropClick: true }}
      animation={still ? { fade: 0, swipe: 0, zoom: 0 } : { fade: 180, swipe: 240 }}
      on={{
        view: ({ index: i }) => { if (i !== index) onIndexChange(i) },
        exited: () => { trigger.current?.focus({ preventScroll: true }); trigger.current = null },
      }}
      render={{
        slide: ({ slide, rect, offset }) => {
          if (slide.type !== 'video') return undefined
          const w = slide.width ?? 16
          const h = slide.height ?? 9
          const scale = Math.min(rect.width / w, rect.height / h)
          const label = typeof slide.title === 'string' ? slide.title : '视频'
          return (
            <div style={{ width: w * scale, height: h * scale }}>
              {offset === 0
                ? <MediaVideo mode="controls" src={slide.sources[0]?.src} poster={slide.poster} width={w} height={h} label={label} className="h-full w-full rounded-control" />
                : slide.poster && <img src={slide.poster} alt={label} className="h-full w-full rounded-control object-contain" />}
            </div>
          )
        },
      }}
      labels={{ Previous: '上一张', Next: '下一张', Close: '关闭', Download: '下载', 'Zoom in': '放大', 'Zoom out': '缩小', Lightbox: '媒体预览', Carousel: '轮播', Slide: '媒体', 'Photo gallery': '媒体预览', '{index} of {total}': '第 {index} 个，共 {total} 个' } as Record<string, string>}
      styles={{
        container: { backgroundColor: 'rgb(22 25 22 / .94)' },
        captionsTitleContainer: { background: 'linear-gradient(rgb(22 25 22 / .6), transparent)' },
      }}
    />
  )
}
