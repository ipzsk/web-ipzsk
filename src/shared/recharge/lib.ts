// Shared by the account page and the studio's in-app recharge dialog.

// Ported verbatim from legacy recharge.js (its wording differs from the account map on purpose).
export const VOUCHER_ERRORS: Record<string, string> = {
  voucher_unavailable: '兑换码不可用，请核对是否已兑换、过期或尚未启用。',
  invalid_voucher: '请检查兑换码格式。',
  rate_limited: '操作太频繁，请稍后再试。',
  account_disabled: '账户已停用，请联系管理员。',
}

export const formatPoints = (v: string | number | null | undefined) =>
  v == null ? '待核实' : Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 6 }) + ' 点'
