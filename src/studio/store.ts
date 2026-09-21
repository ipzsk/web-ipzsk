import { create } from 'zustand'
import type { JSONContent } from '@tiptap/core'
import type { GenerationParams, MediaKind } from '@/shared/contracts'
import type { QueueEntry, RefSlot } from './api/queue'
import { hydrateAvatarDraft } from './avatar/draft'
import { isAvatarParams } from './avatar/logic'

interface KindMemory { model?: string; params: GenerationParams }
/** 数字人（kind video + mode avatar）有自己的型号/参数记忆，不覆盖普通视频的。 */
export type MemoryKey = MediaKind | 'avatar'
const MEMORY_KEY = 'ipzsk.composer.memory'
const emptyMemory = (): Record<MemoryKey, KindMemory> => ({ image: { params: {} }, video: { params: {} }, avatar: { params: {} } })
const loadMemory = () => {
  try { return { ...emptyMemory(), ...JSON.parse(localStorage.getItem(MEMORY_KEY) ?? '{}') } as Record<MemoryKey, KindMemory> } catch { return emptyMemory() }
}

export interface ComposerState {
  kind: MediaKind
  setKind: (kind: MediaKind) => void
  /** 'avatar' = 数字人模式（kind 固定 video）；null = 普通图片/视频。 */
  mode: 'avatar' | null
  /** Last model + params per kind (§2.2-3), persisted in localStorage. */
  memory: Record<MemoryKey, KindMemory>
  remember: (kind: MemoryKey, m: KindMemory) => void
  /** Tiptap JSON. `docVersion` bumps when the doc is replaced from outside the editor (edit item, restore draft). */
  doc: JSONContent | null
  docVersion: number
  slots: RefSlot[]
  /** {{填空}} → 用户填的值。值存在这里而不是直接写进 doc，格子才能反复改；发送前由 applyVars 替换。 */
  vars: Record<string, string>
  setVar: (token: string, value: string) => void
  /** 「照着这张做」：案例的效果图，只作参照，不随请求发送。 */
  sourceCase: { url: string; title?: string } | null
  /** Queue item currently loaded into the composer via 「编辑」. */
  editingId: string | null
  queue: QueueEntry[]
  /** Set by the create view (F5); sent as thread_id. */
  threadId: string | null
}

export const useComposer = create<ComposerState>(set => ({
  kind: 'image',
  setKind: kind => set({ kind, mode: null }),
  mode: null,
  memory: loadMemory(),
  remember: (kind, m) => set(s => {
    const memory = { ...s.memory, [kind]: m }
    try { localStorage.setItem(MEMORY_KEY, JSON.stringify(memory)) } catch { /* private mode */ }
    return { memory }
  }),
  doc: null,
  docVersion: 0,
  slots: [],
  vars: {},
  sourceCase: null,
  setVar: (token, value) => set(s => ({ vars: { ...s.vars, [token]: value } })),
  editingId: null,
  queue: [],
  threadId: null,
}))

/** Replace the whole draft from outside the editor. */
export function loadDraft(d: { kind: MediaKind; model?: string; params: GenerationParams; doc: JSONContent | null; slots: RefSlot[]; editingId?: string | null }) {
  const s = useComposer.getState()
  const avatar = isAvatarParams(d.params)
  if (avatar) hydrateAvatarDraft(d.model ?? '', d.params, '', d.editingId) // queue items keep the script in params
  s.remember(avatar ? 'avatar' : d.kind, { model: d.model, params: d.params })
  useComposer.setState({ kind: d.kind, mode: avatar ? 'avatar' : null, doc: d.doc, docVersion: s.docVersion + 1, slots: d.slots, vars: {}, sourceCase: null, editingId: d.editingId ?? null })
}

export const clearDraft = () => useComposer.setState(s => ({ doc: null, docVersion: s.docVersion + 1, slots: [], vars: {}, sourceCase: null, editingId: null }))

/** Apply a submit outcome to the queue: remove, or upsert with a state (items sent straight from the composer get appended so the draft isn't lost). */
export function applyToQueue(item: QueueEntry, patch: 'remove' | Pick<QueueEntry, 'state' | 'error'>) {
  useComposer.setState(s => {
    if (patch === 'remove') return { queue: s.queue.filter(i => i.item_id !== item.item_id) }
    const exists = s.queue.some(i => i.item_id === item.item_id)
    return { queue: exists ? s.queue.map(i => i.item_id === item.item_id ? { ...i, ...patch } : i) : [...s.queue, { ...item, ...patch }] }
  })
}

let kindRead = false
/** §2.1: `?kind=image|video` is read once on entry; afterwards the user's own switch wins. */
export function readKindOnce(search: string) {
  if (kindRead) return
  kindRead = true
  const kind = new URLSearchParams(search).get('kind')
  if (kind === 'image' || kind === 'video') useComposer.getState().setKind(kind)
  if (kind === 'avatar') useComposer.setState({ kind: 'video', mode: 'avatar' })
}
/** Test hook only. */
export const __resetKindRead = () => { kindRead = false }

// QA hook (dev only): lets browser tests read the composer state.
if (import.meta.env.DEV && typeof window !== 'undefined') (window as { __ipzskComposer?: typeof useComposer }).__ipzskComposer = useComposer
