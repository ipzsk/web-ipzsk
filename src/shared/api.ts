// Typed port of /api.js: base URL, cookies, 401 broadcast and Chinese error messages.
export const API_BASE = import.meta.env.DEV ? '' : 'https://api.ipzsk.com' // dev goes through the Vite proxy
export const UNAUTHORIZED_EVENT = 'ipzsk:unauthorized'

const messages: Record<string, string> = {
  customer_login_required: '请先登录。',
  invalid_api_token: '登录已失效，请重新登录。',
  insufficient_balance: '余额不足，请先充值。',
  billing_unavailable: '计费服务暂不可用，请稍后重试。',
  rate_limited: '操作太频繁，请稍后再试。',
  too_many_active: '进行中的任务太多，请等其中一些完成后再提交。',
  idempotency_conflict: '这条请求与之前提交的内容不同，请先查看原任务，再编辑后重新发送。',
  anchor_not_succeeded: '参考任务还未完成，请等待结果就绪后再发送。',
  network_error: '暂时无法连接服务，请检查网络后重试。',
  invalid_param_value: '参数取值不被当前型号支持，请修改后重试。',
  unsupported_parameter: '当前型号不支持这个参数，请修改后重试。',
  unsupported_parameter_for_model: '当前型号不支持这个参数，请修改后重试。',
  reference_asset_not_found: '参考素材已删除或不可用，请移除后重试。',
  queue_conflict: '队列已在其他设备更新。',
  payment_email_unavailable: '账户邮箱不可用，请重新登录或联系客服。',
  payment_checkout_already_requested: '充值请求已提交，请先查看充值记录。',
  online_payment_unavailable: '在线充值暂不可用，请稍后再试。',
  payment_checkout_failed: '收银台暂时无法打开，请稍后重试。',
  // Generation submit (gateway.mjs): whether to resend is decided by studio/api/generation.ts classify().
  upstream_result_uncertain: '生成服务没有返回结果，这次生成与扣费正在核对，请勿重复提交。',
  upstream_connect_failed: '暂时连不上生成服务，请稍后重试。',
  request_cancelled: '请求已中断，请重试。',
  invalid_batch_position: '一次最多发送 12 项，请分批发送。',
  billing_requires_priced_media: '这个型号暂时无法计价，请换一个型号或稍后再试。',
}

/** upstream_http_{status} carries the upstream status; see studio/create/lib.ts upstreamHttpText for the same split. */
function upstreamHttpMessage(code: string): string | undefined {
  const m = /^upstream_http_(\d{3})$/.exec(code)
  if (!m) return undefined
  const status = Number(m[1])
  if ([401, 402, 403, 429].includes(status)) return '生成服务暂时繁忙或不可用，请稍后重试。'
  if (status < 500) return '生成服务拒绝了这次请求（参数或内容不被接受），请修改后重试。'
  return '生成服务出错，这次生成与扣费正在核对，请勿重复提交。'
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  /** Parsed JSON body of the error response (e.g. `error.field`, 409 `queue` / `project` payloads). */
  readonly body: unknown
  constructor(message: string, { status, code, body }: { status: number; code: string; body?: unknown }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.body = body
  }
}

export const errorMessage = (code: string, fallback = '操作未成功，请稍后重试。') => messages[code] ?? upstreamHttpMessage(code) ?? fallback

/** Same-site path to return to after login, e.g. /account?next=%2Fstudio */
export const loginUrl = (next = location.pathname + location.search) => '/account?next=' + encodeURIComponent(next)

export interface RequestOptions { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal }

export async function request<T = unknown>(path: string, { method, body, headers, signal }: RequestOptions = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(API_BASE + path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      credentials: 'include',
      cache: 'no-store',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error
    throw new ApiError(messages.network_error!, { status: 0, code: 'network_error' })
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const code: string = data?.error?.code ?? data?.code ?? `http_${response.status}`
    if (response.status === 401) window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
    throw new ApiError(errorMessage(code), { status: response.status, code, body: data })
  }
  return data as T
}

export interface User { id: string; email?: string; [k: string]: unknown }

/** Resolves to the profile when signed in, null otherwise. Never redirects. */
export async function currentUser(): Promise<User | null> {
  try {
    const session = await request<{ user?: User } | null>('/api/auth/get-session')
    if (!session?.user) return null
    return (await request<{ user?: User }>('/api/me/profile')).user ?? null
  }
  catch (error) { if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null; throw error }
}

export interface Wallet {
  available_cny: string
  frozen_cny: string
  available_points?: string
  frozen_points?: string
  entries?: { created_at: string; kind: string; amount_cny: string }[]
}

/**
 * Mock adapters, DEV builds only: `?mock=1` on entry or localStorage['ipzsk.mock']==='1'. Read once per page load.
 * Production builds must never honour `?mock=1` (anyone could otherwise see fake balances and fake results).
 */
export const isMock = import.meta.env.DEV && (() => {
  try {
    return new URLSearchParams(location.search).get('mock') === '1' || localStorage.getItem('ipzsk.mock') === '1'
  } catch { return false }
})()
