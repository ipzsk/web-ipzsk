import { request } from './api'

export interface PaymentPack { key: string; amount_cny: string | number }
// Backend payments.mjs: mode is the Waffo environment ('prod' | 'test'), null while online payment is disabled.
export interface PaymentOptions { enabled: boolean; mode: 'test' | 'prod' | null; packs: PaymentPack[] }
export interface PaymentOrder { id: string; amount_cny: string | number; state: string; mode?: 'test' | 'prod'; created_at: string; refunded_cny?: string | number }
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

// The backend creates Waffo checkout sessions with expiresInSeconds 1800 and never expires the order row itself.
// After that (plus a grace period for a late webhook) an unpaid checkout can no longer complete, so stop polling it.
const CHECKOUT_CLOSED_AFTER_MS = 30 * 60_000 + 10 * 60_000
const CHECKOUT_STATES = ['creating', 'checkout_ready']
const DELIVERY_STATES = ['paid', 'crediting']

/** Label and polling need of one order, as the user should see it. */
export function orderStatus(order: PaymentOrder, now = Date.now()): { label: string; pending: boolean } {
  if (CHECKOUT_STATES.includes(order.state) && now - Date.parse(order.created_at) > CHECKOUT_CLOSED_AFTER_MS)
    return { label: '未完成支付（收银台已关闭；如已付款请联系客服）', pending: false }
  const refunded = Number(order.refunded_cny ?? 0)
  if (order.state === 'credited' && refunded > 0)
    return { label: refunded >= Number(order.amount_cny) ? '已全额退款' : '已部分退款 ' + formatMoney(order.refunded_cny), pending: false }
  return { label: paymentStates[order.state] ?? '状态待确认', pending: CHECKOUT_STATES.includes(order.state) || DELIVERY_STATES.includes(order.state) }
}

export const hasPendingPayment = (orders: PaymentOrder[] = [], now = Date.now()) => orders.some(order => orderStatus(order, now).pending)
