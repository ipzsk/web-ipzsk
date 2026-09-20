/** Display only: at most 1 decimal, no trailing `.0` (5.70197 → 「5.7 点」); below 1 point keep 2 decimals so small charges don't read 「0 点」. Keep exact values for arithmetic. */
export const pointsNumber = (v: string | number) => { const n = Number(v); return n.toLocaleString('zh-CN', { maximumFractionDigits: n !== 0 && Math.abs(n) < 1 ? 2 : 1 }) }
export const formatPoints = (v: string | number | null | undefined) => v == null ? '待核实' : `${pointsNumber(v)} 点`
