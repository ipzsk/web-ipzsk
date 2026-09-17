// Pure subject-library rules (§2.9). Tested in subjects.test.ts.
import type { MediaAsset } from '@/media'
import type { Subject } from '../api/subjects'

export const NAME_MAX = 30
export const NOTE_MAX = 500
export const ASSETS_MAX = 8

export interface SubjectDraft { name: string; note: string; assets: MediaAsset[] }
export type DraftErrors = Partial<Record<'name' | 'note' | 'assets', string>>

/** Client-side check; `others` = cached subjects (server 409 subject_name_taken stays the source of truth). */
export function validateSubject(d: SubjectDraft, others: Pick<Subject, 'id' | 'name'>[] = [], selfId?: string): DraftErrors {
  const e: DraftErrors = {}
  const name = d.name.trim()
  if (!name) e.name = '请填写名称'
  else if ([...name].length > NAME_MAX) e.name = `名称最多 ${NAME_MAX} 个字`
  else if (others.some(s => s.id !== selfId && s.name.trim().toLowerCase() === name.toLowerCase())) e.name = '名称已存在'
  if ([...d.note].length > NOTE_MAX) e.note = `备注最多 ${NOTE_MAX} 个字`
  if (!d.assets.length) e.assets = '至少添加 1 张参考图'
  else if (d.assets.length > ASSETS_MAX) e.assets = `最多 ${ASSETS_MAX} 张参考图`
  return e
}
export const firstError = (e: DraftErrors) => e.name ?? e.assets ?? e.note ?? null

export function moveAsset(assets: MediaAsset[], fromId: string, toId: string): MediaAsset[] {
  const from = assets.findIndex(a => a.id === fromId)
  const to = assets.findIndex(a => a.id === toId)
  if (from < 0 || to < 0 || from === to) return assets
  const next = [...assets]
  next.splice(to, 0, next.splice(from, 1)[0]!)
  return next
}

/** Cover must be one of the assets; otherwise the first one (or none). */
export const coverOf = (assets: MediaAsset[], coverId: string | null | undefined) =>
  assets.some(a => a.id === coverId) ? coverId! : assets[0]?.id ?? null

/** Append with dedupe by id, capped at 8; `dropped` = how many didn't fit. */
export function addAssets(assets: MediaAsset[], incoming: MediaAsset[]): { assets: MediaAsset[]; dropped: number } {
  const fresh = incoming.filter((a, i) => a.kind === 'image' && !assets.some(x => x.id === a.id) && incoming.findIndex(x => x.id === a.id) === i)
  const room = Math.max(0, ASSETS_MAX - assets.length)
  return { assets: [...assets, ...fresh.slice(0, room)], dropped: Math.max(0, fresh.length - room) }
}

/** 「名称 副本」, 「名称 副本2」… first free, trimmed to 30 chars. */
export function copyName(name: string, others: Pick<Subject, 'name'>[]): string {
  const taken = new Set(others.map(s => s.name.trim().toLowerCase()))
  for (let i = 1; ; i++) {
    const suffix = i === 1 ? ' 副本' : ` 副本${i}`
    const n = [...name].slice(0, NAME_MAX - suffix.length).join('') + suffix
    if (!taken.has(n.toLowerCase())) return n
  }
}

/**
 * §6 optimistic delete: `apply` now, `commit` after `delay` unless undone; commit failure → `revert` + `onError`.
 * Returns `undo()` (false once committed).
 */
export function undoable({ apply, revert, commit, onError, delay = 5000 }: {
  apply: () => void; revert: () => void; commit: () => Promise<unknown>; onError?: (e: unknown) => void; delay?: number
}) {
  let state: 'pending' | 'undone' | 'committed' = 'pending'
  apply()
  const timer = setTimeout(() => {
    if (state !== 'pending') return
    state = 'committed'
    commit().catch(e => { revert(); onError?.(e) })
  }, delay)
  return {
    undo() {
      if (state !== 'pending') return false
      state = 'undone'
      clearTimeout(timer)
      revert()
      return true
    },
  }
}
