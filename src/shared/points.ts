/** Display only: at most 1 decimal, no trailing `.0` (5.70197 → 「5.7 点」). Keep exact strings/numbers for any arithmetic. */
export const pointsNumber = (v: string | number) => Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 1 })
export const formatPoints = (v: string | number | null | undefined) => v == null ? '待核实' : `${pointsNumber(v)} 点`
