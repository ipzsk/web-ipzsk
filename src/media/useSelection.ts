import { useCallback, useRef, useState } from 'react'

type Mods = { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }

/**
 * Shift → add the range from the last anchor to `id` (in `orderedIds` order).
 * Cmd/Ctrl or plain (checkbox) → toggle `id` and make it the anchor.
 */
export function useSelection(orderedIds: readonly string[]) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const anchor = useRef<string | null>(null)
  const ids = useRef(orderedIds)
  ids.current = orderedIds

  const select = useCallback((id: string, mods: Mods = {}) => {
    setSelected((prev) => {
      const next = new Set(prev)
      const a = anchor.current ? ids.current.indexOf(anchor.current) : -1
      const b = ids.current.indexOf(id)
      if (mods.shiftKey && a >= 0 && b >= 0) {
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(ids.current[i]!)
      } else {
        if (next.has(id)) next.delete(id); else next.add(id)
        anchor.current = id
      }
      return next
    })
  }, [])

  const clear = useCallback(() => { anchor.current = null; setSelected(new Set()) }, [])
  const selectAll = useCallback(() => setSelected(new Set(ids.current)), [])

  return { selected, isSelected: (id: string) => selected.has(id), select, clear, selectAll, setSelected }
}
