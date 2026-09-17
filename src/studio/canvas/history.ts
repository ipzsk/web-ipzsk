/**
 * Snapshot undo/redo. Callers record the state *before* a change.
 * Same `key` within COALESCE_MS merges into one step (typing, slider drags); a node drag records once at drag start.
 */
export interface History<T> { past: T[]; future: T[]; key?: string; at: number }

export const HISTORY_LIMIT = 200
export const COALESCE_MS = 1000

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [], at: 0 })

export function record<T>(h: History<T>, before: T, key?: string, now = Date.now()): History<T> {
  if (key && key === h.key && now - h.at < COALESCE_MS) return { ...h, future: [], at: now }
  return { past: [...h.past, before].slice(-HISTORY_LIMIT), future: [], key, at: now }
}

export function undo<T>(h: History<T>, current: T): [History<T>, T] | null {
  const prev = h.past.at(-1)
  if (prev === undefined) return null
  return [{ past: h.past.slice(0, -1), future: [current, ...h.future], at: 0 }, prev]
}

export function redo<T>(h: History<T>, current: T): [History<T>, T] | null {
  const next = h.future[0]
  if (next === undefined) return null
  return [{ past: [...h.past, current].slice(-HISTORY_LIMIT), future: h.future.slice(1), at: 0 }, next]
}
