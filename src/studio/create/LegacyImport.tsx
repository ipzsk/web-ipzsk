import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { History, ImageOff, X } from 'lucide-react'
import { Badge, Button, EmptyState, IconButton, Skeleton, cn } from '@/ui'
import { queryClient, useCurrentUser } from '@/shared/query'
import { LEGACY_THREAD_TITLE, legacyMarker, loadLegacy, mayBeExpired, type LegacyItem } from './legacy'

/** Legacy records + this user's import marker (both local to this browser). */
export function useLegacy() {
  const uid = useCurrentUser().data?.id
  const key = uid == null ? null : String(uid)
  const items = useQuery({ queryKey: ['legacy', 'items', key], queryFn: () => loadLegacy(key!), enabled: key != null, staleTime: Infinity })
  const marker = useQuery({ queryKey: ['legacy', 'marker', key], queryFn: () => legacyMarker.read(key!), enabled: key != null, staleTime: Infinity })
  const mark = (state: 'imported' | 'dismissed') => {
    if (key == null) return
    legacyMarker.write(key, state)
    queryClient.setQueryData(['legacy', 'marker', key], legacyMarker.read(key))
  }
  return { items: items.data ?? [], marker: marker.data ?? null, ready: items.isSuccess && marker.isSuccess, mark }
}

/** One-time banner in the create view: import (local thread) or never ask again. Originals are never touched. */
export function LegacyBanner({ onImport }: { onImport: () => void }) {
  const legacy = useLegacy()
  if (!legacy.ready || legacy.marker || !legacy.items.length) return null
  return (
    <div role="region" aria-label="旧版记录" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-line bg-card px-3 py-2.5 shadow-sm">
      <History className="size-5 shrink-0 text-muted" aria-hidden />
      <p className="min-w-0 flex-1 basis-48 text-sm">发现旧版生图/生视频的本地记录 <b className="tabular-nums">{legacy.items.length}</b> 条</p>
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="primary" onClick={() => { legacy.mark('imported'); onImport() }}>导入到创作记录</Button>
        <Button size="sm" variant="ghost" onClick={() => legacy.mark('dismissed')}>不再提示</Button>
      </div>
    </div>
  )
}

function Media({ item, url, index }: { item: LegacyItem; url: string; index: number }) {
  const [broken, setBroken] = useState(false)
  if (broken) return <div role="img" aria-label="链接已失效" className="grid aspect-square place-items-center rounded-[10px] bg-subtle text-xs text-muted"><span className="grid justify-items-center gap-1"><ImageOff className="size-5" />链接已失效</span></div>
  return item.kind === 'video'
    ? <video src={url} controls preload="metadata" onError={() => setBroken(true)} className="aspect-video w-full rounded-[10px] bg-ink object-contain" aria-label={`旧版视频 ${index + 1}`} />
    : <img src={url} alt={`旧版作品 ${index + 1}`} loading="lazy" onError={() => setBroken(true)} className="aspect-square w-full rounded-[10px] bg-subtle object-cover" />
}

const SOURCE_LABEL = { history: '旧版生图', gallery: '旧版作品集', video: '旧版生视频' } as const

/** Read-only local thread 「旧版记录导入」: original URLs, no regenerate / edit (no generation endpoints). */
export function LegacyStream({ onDismiss }: { onDismiss: () => void }) {
  const legacy = useLegacy()
  if (!legacy.ready) return <div aria-busy className="grid gap-3"><Skeleton className="h-40 rounded-panel" /><Skeleton className="h-40 rounded-panel" /></div>
  if (!legacy.items.length) return <EmptyState icon={History} text="这台设备上没有旧版生图/生视频记录了" />
  return (
    <div className="grid gap-4 pb-24 md:pb-40">
      <div className="flex items-start gap-2 rounded-card bg-subtle px-3 py-2 text-xs text-muted">
        <p className="min-w-0 flex-1">{LEGACY_THREAD_TITLE} · {legacy.items.length} 条 · 只读，仅保存在这台设备的浏览器里；原记录未改动。</p>
        <IconButton size="icon-sm" label="从会话列表移除（不删除原记录）" onClick={() => { legacy.mark('dismissed'); onDismiss() }}><X className="size-3.5" /></IconButton>
      </div>
      {legacy.items.map(item => (
        <article key={item.id} aria-label="旧版记录" className="grid gap-2 rounded-panel border border-line bg-card p-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <Badge tone="outline" className="h-5">{SOURCE_LABEL[item.source]}</Badge>
            {item.model && <span className="font-semibold text-ink">{item.model}</span>}
            {item.meta.map(m => <span key={m}>· {m}</span>)}
            {item.createdAt > 0 && <span>· {new Date(item.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
            {mayBeExpired(item) && <Badge tone="warning" className="ml-auto h-5">旧链接可能已失效</Badge>}
          </div>
          <p className="whitespace-pre-wrap break-words text-sm leading-6">{item.prompt || <span className="text-muted">（无提示词）</span>}</p>
          <div className={cn('grid gap-2', item.kind === 'video' ? 'max-w-xl' : 'grid-cols-[repeat(auto-fill,minmax(140px,1fr))]')}>
            {item.urls.map((u, i) => <Media key={i} item={item} url={u} index={i} />)}
          </div>
        </article>
      ))}
    </div>
  )
}
