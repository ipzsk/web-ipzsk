import { formatMoney } from './billing'

/**
 * 点数只是网关内部的计价单位，对用户一律显示人民币（网关 src/billing.mjs 的 POINTS_PER_CNY，
 * 钱包接口也按这个比例回 available_cny / available_points；改了那边这里要跟着改，有测试盯着）。
 */
export const POINTS_PER_CNY = 100

export const cnyOf = (points: string | number) => Number(points) / POINTS_PER_CNY

/** 「¥0.06」；报价还没回来时是「待核实」。小额自动保留更多位，不会显示成 ¥0.00。 */
export const formatCharge = (points: string | number | null | undefined) =>
  points == null ? '待核实' : formatMoney(cnyOf(points))

/** Display only: at most 1 decimal, no trailing `.0`. 仅用于还按点数标注的内部位置。 */
export const pointsNumber = (v: string | number) => { const n = Number(v); return n.toLocaleString('zh-CN', { maximumFractionDigits: n !== 0 && Math.abs(n) < 1 ? 2 : 1 }) }
