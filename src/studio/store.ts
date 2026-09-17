import { create } from 'zustand'
import type { JSONContent } from '@tiptap/core'
import type { GenerationParams, MediaKind } from '@/shared/contracts'
import type { QueueEntry, RefSlot } from './api/queue'

interface KindMemory { model?: string; params: GenerationParams }
const MEMORY_KEY = 'ipzsk.composer.memory'
const emptyMemory = (): Record<MediaKind, KindMemory> => ({ image: { params: {} }, video: { params: {} } })
const loadMemory = () => {
  try { return { ...emptyMemory(), ...JSON.parse(localStorage.getItem(MEMORY_KEY) ?? '{}') } as Record<MediaKind, KindMemory> } catch { return emptyMemory() }
}

export interface ComposerState {
  kind: MediaKind
  setKind: (kind: MediaKind) => void
  /** Last model + params per kind (§2.2-3), persisted in localStorage. */
  memory: Record<MediaKind, KindMemory>
  remember: (kind: MediaKind, m: KindMemory) => void
  /** Tiptap JSON. `docVersion` bumps when the doc is replaced from outside the editor (edit item, restore draft). */
  doc: JSONContent | null
  docVersion: number
  slots: RefSlot[]
  /** Queue item currently loaded into the composer via 「编辑」. */
  editingId: string | null
  queue: QueueEntry[]
  /** Set by the create view (F5); sent as thread_id. */
  threadId: string | null
}

export const useComposer = create<ComposerState>(set => ({
  kind: 'image',
  setKind: kind => set({ kind }),
  memory: loadMemory(),
  remember: (kind, m) => set(s => {
    const memory = { ...s.memory, [kind]: m }
    try { localStorage.setItem(MEMORY_KEY, JSON.stringify(memory)) } catch { /* private mode */ }
    return { memory }
  }),
  doc: null,
  docVersion: 0,
  slots: [],
  editingId: null,
  queue: [],
  threadId: null,
}))

/** Replace the whole draft from outside the editor. */
export function loadDraft(d: { kind: MediaKind; model?: string; params: GenerationParams; doc: JSONContent | null; slots: RefSlot[]; editingId?: string | null }) {
  const s = useComposer.getState()
  s.remember(d.kind, { model: d.model, params: d.params })
  useComposer.setState({ kind: d.kind, doc: d.doc, docVersion: s.docVersion + 1, slots: d.slots, editingId: d.editingId ?? null })
}

export const clearDraft = () => useComposer.setState(s => ({ doc: null, docVersion: s.docVersion + 1, slots: [], editingId: null }))

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
}
/** Test hook only. */
export const __resetKindRead = () => { kindRead = false }
