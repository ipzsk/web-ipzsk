// Typed port of /api.js: base URL, cookies, 401 broadcast and Chinese error messages.
export const API_BASE = import.meta.env.DEV ? '' : 'https://api.ipzsk.com' // dev goes through the Vite proxy
export const UNAUTHORIZED_EVENT = 'ipzsk:unauthorized'

const messages: Record<string, string> = {
  customer_login_required: '请先登录。',
  invalid_api_token: '登录已失效，请重新登录。',
  insufficient_balance: '点数不足，请先充值。',
  billing_unavailable: '计费服务暂不可用，请稍后重试。',
  rate_limited: '操作太频繁，请稍后再试。',
  too_many_active: '进行中的任务太多，请等其中一些完成后再提交。',
  network_error: '暂时无法连接服务，请检查网络后重试。',
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

export const errorMessage = (code: string, fallback = '操作未成功，请稍后重试。') => messages[code] ?? fallback

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
  try { return (await request<{ user?: User }>('/api/me/profile')).user ?? null }
  catch (error) { if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null; throw error }
}

export interface Wallet { available_points: string; frozen_points: string }
