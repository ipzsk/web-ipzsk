import { describe, expect, it } from 'vitest'
import { formatPoints } from './points'

describe('formatPoints', () => {
  it('rounds to at most 1 decimal and drops .0', () => {
    expect(formatPoints('5.70197000')).toBe('5.7 点')
    expect(formatPoints(6)).toBe('6 点')
    expect(formatPoints('28.96')).toBe('29 点')
    expect(formatPoints(1234.56)).toBe('1,234.6 点')
    expect(formatPoints(null)).toBe('待核实')
  })
})
