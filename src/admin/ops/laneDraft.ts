/** Pure draft logic for the lane matrix (docs/admin-ops.md). Tested in laneDraft.test.ts. */
import type { LaneChange, LaneChannel, LaneMatrix } from './types'

type Row = LaneMatrix['rows'][number]
export type Expected = LaneChange['expected']
export type Patch = Omit<LaneChange, 'channel_id' | 'expected'>
/**
 * channel_id → the fields that differ from the server, plus `expected`: the server values when this channel was first
 * edited. The gateway compares them on save (409 lane_matrix_conflict) so a refetch never turns a stale draft into a
 * silent overwrite of another operator's change.
 */
export type Entry = Patch & { expected: Expected }
export type Draft = Record<number, Entry>

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x))
const fields = (e?: Entry): Patch => { if (!e) return {}; const { expected: _expected, ...p } = e; return p }
const snapshot = (c: Pick<LaneChannel, 'priority' | 'status' | 'lanes'>): Expected => ({ priority: c.priority, status: c.status, lanes: [...c.lanes] })

/** Server channel with the draft applied. */
export function effective(base: LaneChannel, entry?: Entry): LaneChannel {
  return entry ? { ...base, ...fields(entry) } : base
}

export function effectiveChannels(m: LaneMatrix, d: Draft): Record<string, LaneChannel> {
  const out: Record<string, LaneChannel> = {}
  for (const [id, c] of Object.entries(m.channels)) out[id] = effective(c, d[c.id])
  return out
}

/** Merge `patch` into the draft for channel `id`, dropping fields that end up equal to the server value. */
export function applyPatch(d: Draft, base: LaneChannel, patch: Patch): Draft {
  const merged: Patch = { ...fields(d[base.id]), ...patch }
  if (merged.lanes && sameSet(merged.lanes, base.lanes)) delete merged.lanes
  if (merged.priority === base.priority) delete merged.priority
  if (merged.status === base.status) delete merged.status
  const next = { ...d }
  if (Object.keys(merged).length) next[base.id] = { ...merged, expected: d[base.id]?.expected ?? snapshot(base) }
  else delete next[base.id]
  return next
}

export interface LaneConflict { channel_id: number; reason: 'changed' | 'channel_missing'; current?: Expected }
/**
 * After a 409: re-base each conflicting channel on the values someone else saved (the edit is kept, so the compare dialog
 * shows exactly what this save would now change); a channel that left the matrix is dropped from the draft.
 */
export function rebase(d: Draft, conflicts: LaneConflict[]): Draft {
  const next = { ...d }
  for (const c of conflicts) {
    if (!next[c.channel_id]) continue
    if (c.reason === 'channel_missing' || !c.current) delete next[c.channel_id]
    else next[c.channel_id] = { ...next[c.channel_id]!, expected: snapshot(c.current) }
  }
  return next
}

/** Every channel that can serve the row (cells are included in case the server's channel_ids lags). */
export function rowChannelIds(row: Row): number[] {
  return [...new Set([...row.channel_ids, ...Object.values(row.cells).flatMap(c => c.channel_ids)])]
}

/** Channels of `row` in `lane` after the draft, ordered like the server: priority desc, id asc. */
export function cellIds(row: Row, lane: string, chans: Record<string, LaneChannel>): number[] {
  return rowChannelIds(row)
    .map(id => chans[id])
    .filter((c): c is LaneChannel => !!c && c.lanes.includes(lane))
    .sort((a, b) => b.priority - a.priority || a.id - b.id)
    .map(c => c.id)
}

/**
 * Reorder rule. Priority is channel-wide, so a lane's order is expressed by writing priorities.
 * `ordered` is the lane's channels in the new order (first = tried first).
 * 1. If the lane's current priorities are all distinct, reuse exactly that set of numbers, handed out
 *    in descending order → other lanes only see these channels swap numbers among themselves.
 * 2. Otherwise (ties can't express an order) assign spaced integers: min + 10·(n-1-i), so the last
 *    keeps the lane's lowest priority and there is room to slot things in later.
 * Returns only the channels whose priority actually changes.
 */
export function reorderPriorities(ordered: LaneChannel[]): { id: number; priority: number }[] {
  const nums = ordered.map(c => c.priority).sort((a, b) => b - a)
  const distinct = new Set(nums).size === nums.length
  const min = nums.at(-1) ?? 0
  return ordered
    .map((c, i) => ({ id: c.id, priority: distinct ? nums[i]! : min + 10 * (ordered.length - 1 - i) }))
    .filter((x, i) => x.priority !== ordered[i]!.priority)
}

export function applyReorder(d: Draft, m: LaneMatrix, ordered: number[]): Draft {
  const chans = effectiveChannels(m, d)
  let next = d
  for (const { id, priority } of reorderPriorities(ordered.map(id => chans[id]!))) next = applyPatch(next, m.channels[id]!, { priority })
  return next
}

export const toChanges = (d: Draft): LaneChange[] => Object.entries(d).map(([id, e]) => ({ channel_id: Number(id), ...fields(e), expected: e.expected }))

/** Number of changed fields (the 「N 处改动」 count). */
export const changeCount = (d: Draft) => Object.values(d).reduce((n, e) => n + Object.keys(fields(e)).length, 0)

/** Only a channel in more than one lane may leave a lane: the server refuses removing the last group (we can't see non-lane groups). */
export const canRemoveFromLane = (c: LaneChannel) => c.lanes.length > 1

/** Compare rows. A drafted channel missing from a refetched matrix still renders from its `expected` snapshot. */
export function diffRows(m: LaneMatrix, d: Draft) {
  return Object.entries(d).map(([id, e]) => {
    const server = m.channels[id]
    const before: Pick<LaneChannel, 'priority' | 'status' | 'lanes'> = server ?? e.expected
    const patch = fields(e)
    return { id: Number(id), name: server?.name ?? `渠道 #${id}（已不在线路矩阵中）`, missing: !server, before, after: { ...before, ...patch }, patch }
  })
}
