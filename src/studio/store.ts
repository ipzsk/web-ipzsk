import { create } from 'zustand'
import type { MediaKind } from '@/shared/contracts'

interface ComposerState { kind: MediaKind; setKind: (kind: MediaKind) => void }

export const useComposer = create<ComposerState>(set => ({ kind: 'image', setKind: kind => set({ kind }) }))

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
