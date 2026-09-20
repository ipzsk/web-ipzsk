import { request } from './api'

export interface PaymentPack { key: string; amount_cny: string | number }
export interface PaymentOptions { enabled: boolean; mode: 'test' | 'live'; packs: PaymentPack[] }
export interface PaymentOrder { id: string; amount_cny: string | number; state: string; mode?: 'test' | 'live'; created_at: string }
export interface PaymentOrders { rows: PaymentOrder[] }

export const paymentStates: Record<string, string> = {
  creating: '正在准备收银台',
  checkout_ready: '待支付或等待支付确认',
  checkout_failed: '收银台创建失败',
  paid: '支付已确认，额度到账中',
  crediting: '额度到账中',
  credited: '充值已到账',
  test_completed: '测试支付已完成（不增加正式额度）',
  refund_review: '退款处理中，请联系客服',
  review_required: '正在核对到账情况，请联系客服',
}

export function formatMoney(value: unknown, detailed = false) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return '—'
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '—'
  const precision = detailed || (amount !== 0 && Math.abs(amount) < 0.01) ? 8 : 2
  return (amount < 0 ? '-¥' : '¥') + Math.abs(amount).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: precision,
    useGrouping: false,
  })
}

export async function createCheckout(pack: string) {
  const result = await request<{ checkout_url: string }>('/api/me/payments/checkout', {
    body: { pack },
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  })
  const url = new URL(result.checkout_url)
  if (url.protocol !== 'https:' || url.hostname !== 'pancake.waffo.ai' || url.username || url.password) {
    throw new Error('收银台地址校验失败，请联系客服。')
  }
  return url.href
}

export const hasPendingPayment = (orders: PaymentOrder[] = []) =>
  orders.some(order => ['creating', 'checkout_ready', 'paid', 'crediting'].includes(order.state))
