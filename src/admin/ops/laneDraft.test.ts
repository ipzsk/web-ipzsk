import { describe, expect, it } from 'vitest'
import { applyPatch, applyReorder, canRemoveFromLane, cellIds, changeCount, diffRows, effectiveChannels, rebase, reorderPriorities, toChanges, type Draft } from './laneDraft'
import { createMockLaneApi } from './laneApi'
import type { LaneChannel, LaneMatrix } from './types'
import { ApiError } from '@/shared/api'

const ch = (id: number, priority: number, lanes: string[], status: 1 | 2 | 3 = 1): LaneChannel =>
  ({ id, name: `c${id}`, type: 1, status, priority, weight: 1, lanes, vendor: 'v', balance_cny: null, balance_checked_at: null, balance_raw: null, balance_unit: 'CNY', balance_supported: true })

const matrix = (): LaneMatrix => ({
  lanes: [{ symbol: 'a', name: 'A', ratio: 1 }, { symbol: 'b', name: 'B', ratio: 0.8 }],
  scenario: { resolution: '1080p', duration: 5 },
  rows: [
    { model: 'm1', vendors: ['v'], modalities: ['image'], cells: { a: { channel_ids: [1, 2, 3] }, b: { channel_ids: [1] } }, channel_ids: [1, 2, 3, 4], prices: {} },
    { model: 'm2', vendors: ['v'], modalities: ['image'], cells: { a: { channel_ids: [2] }, b: { channel_ids: [] } }, channel_ids: [2], prices: {} },
  ],
  channels: { 1: ch(1, 30, ['a', 'b']), 2: ch(2, 20, ['a']), 3: ch(3, 10, ['a']), 4: ch(4, 0, []) },
  vendor_icons: {},
})

describe('reorder rule', () => {
  it('reuses the lane\'s distinct priorities in the new order', () => {
    expect(reorderPriorities([ch(3, 10, []), ch(1, 30, []), ch(2, 20, [])])).toEqual([{ id: 3, priority: 30 }, { id: 1, priority: 20 }, { id: 2, priority: 10 }])
  })
  it('spaces integers from the lowest priority when there are ties', () => {
    expect(reorderPriorities([ch(1, 5, []), ch(2, 5, []), ch(3, 0, [])])).toEqual([{ id: 1, priority: 20 }, { id: 2, priority: 10 }])
  })
  it('no-op order changes nothing', () => expect(reorderPriorities([ch(1, 30, []), ch(2, 20, [])])).toEqual([]))
})

describe('draft', () => {
  it('priority change shows up in every lane the channel is in', () => {
    const m = matrix()
    const d = applyReorder({}, m, [3, 2, 1]) // move c1 to last in lane a
    const chans = effectiveChannels(m, d)
    expect(cellIds(m.rows[0]!, 'a', chans)).toEqual([3, 2, 1])
    expect(chans[1]!.priority).toBe(10)
    expect(d[2]).toBeUndefined() // c2 kept 20
    expect(toChanges(d)).toEqual([
      { channel_id: 1, priority: 10, expected: { priority: 30, status: 1, lanes: ['a', 'b'] } },
      { channel_id: 3, priority: 30, expected: { priority: 10, status: 1, lanes: ['a'] } },
    ])
  })
  it('merges per channel, drops fields back to server value', () => {
    const m = matrix()
    let d: Draft = applyPatch({}, m.channels[4]!, { lanes: ['b'] })
    d = applyPatch(d, m.channels[4]!, { status: 2 })
    expect(changeCount(d)).toBe(2)
    expect(cellIds(m.rows[0]!, 'b', effectiveChannels(m, d))).toEqual([1, 4])
    d = applyPatch(d, m.channels[4]!, { lanes: [], status: 1 })
    expect(d).toEqual({})
    expect(applyPatch({}, m.channels[1]!, { lanes: ['b', 'a'] })).toEqual({})
  })
  it('expected is captured when a channel is first edited and survives a refetch', () => {
    const m = matrix()
    let d: Draft = applyPatch({}, m.channels[2]!, { priority: 25 })
    // Someone else moves channel 2 to priority 40; the page refetches and the operator keeps editing.
    const refetched = { ...m, channels: { ...m.channels, 2: ch(2, 40, ['a']) } }
    d = applyPatch(d, refetched.channels[2]!, { status: 2 })
    expect(toChanges(d)).toEqual([{ channel_id: 2, priority: 25, status: 2, expected: { priority: 20, status: 1, lanes: ['a'] } }])
    expect(changeCount(d)).toBe(2)
  })
  it('a drafted channel missing after refetch still renders in the compare dialog', () => {
    const m = matrix()
    const d = applyPatch({}, m.channels[3]!, { priority: 99 })
    const { 3: _gone, ...rest } = m.channels
    const rows = diffRows({ ...m, channels: rest }, d)
    expect(rows).toEqual([{ id: 3, name: '渠道 #3（已不在线路矩阵中）', missing: true, before: { priority: 10, status: 1, lanes: ['a'] },
      after: { priority: 99, status: 1, lanes: ['a'] }, patch: { priority: 99 } }])
  })
  it('a conflict re-bases the edit on the saved values and drops channels that left the matrix', () => {
    const m = matrix()
    let d: Draft = applyPatch({}, m.channels[2]!, { priority: 25 })
    d = applyPatch(d, m.channels[3]!, { status: 2 })
    const next = rebase(d, [{ channel_id: 2, reason: 'changed', current: { priority: 40, status: 1, lanes: ['a'] } }, { channel_id: 3, reason: 'channel_missing' }])
    expect(toChanges(next)).toEqual([{ channel_id: 2, priority: 25, expected: { priority: 40, status: 1, lanes: ['a'] } }])
  })
  it('only multi-lane channels can be removed', () => {
    const m = matrix()
    expect(canRemoveFromLane(m.channels[1]!)).toBe(true)
    expect(canRemoveFromLane(m.channels[2]!)).toBe(false)
  })
})

describe('mock lane api', () => {
  const noDelay = async () => {}
  it('serves a matrix, saves changes, rejects viewers and last-group removals', async () => {
    const api = createMockLaneApi('operator', noDelay)
    const m = await api.matrix({ resolution: '1080p', duration: 5 })
    expect(m.lanes).toHaveLength(3)
    const multi = Object.values(m.channels).find(c => c.lanes.length > 1)!
    const expected = { priority: multi.priority, status: multi.status, lanes: [...multi.lanes] }
    const res = await api.save([{ channel_id: multi.id, lanes: [multi.lanes[0]!], priority: 99, expected }])
    expect(res.results[0]!.after.priority).toBe(99)
    expect((await api.matrix({})).channels[multi.id]!.lanes).toEqual([multi.lanes[0]])
    await expect(api.save([{ channel_id: multi.id, lanes: [], expected }])).rejects.toBeInstanceOf(ApiError)
    // The same stale draft again: the channel no longer holds the values it was based on.
    await expect(api.save([{ channel_id: multi.id, priority: 50, expected }])).rejects.toMatchObject({ code: 'lane_matrix_conflict' })
    await expect(createMockLaneApi('viewer', noDelay).save([])).rejects.toMatchObject({ code: 'forbidden_role' })
  })
})
