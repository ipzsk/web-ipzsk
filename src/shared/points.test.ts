import { describe, expect, it } from 'vitest'
import { POINTS_PER_CNY, cnyOf, formatCharge, pointsNumber } from './points'

describe('formatCharge', () => {
  it('把网关的点数按 100:1 显示成人民币', () => {
    expect(POINTS_PER_CNY).toBe(100) // 跟网关 src/billing.mjs 对齐，那边改了这里要改
    expect(cnyOf('570.197')).toBeCloseTo(5.70197, 5)
    expect(formatCharge('570.197')).toBe('¥5.70')
    expect(formatCharge(600)).toBe('¥6.00')
    expect(formatCharge(null)).toBe('待核实')
  })

  it('小额不显示成 ¥0.00', () => {
    expect(formatCharge('0.03')).toBe('¥0.0003')
    expect(formatCharge(0)).toBe('¥0.00')
  })

  it('pointsNumber 仍按点数格式化', () => {
    expect(pointsNumber('5.70197000')).toBe('5.7')
    expect(pointsNumber(1234.56)).toBe('1,234.6')
  })
})
