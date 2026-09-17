// Shared browser client for api.ipzsk.com: one place for base URL, cookies, 401 handling and Chinese errors.
export const API_BASE = 'https://api.ipzsk.com';

const messages = {
  customer_login_required: '请先登录。',
  invalid_api_token: '登录已失效，请重新登录。',
  insufficient_balance: '点数不足，请先充值。',
  billing_unavailable: '计费服务暂不可用，请稍后重试。',
  rate_limited: '操作太频繁，请稍后再试。',
};

export class ApiError extends Error {
  constructor(message, {status, code} = {}) { super(message); this.status = status; this.code = code; }
}

export function errorMessage(code, fallback = '操作未成功，请稍后重试。') {
  return messages[code] ?? fallback;
}

// Same-site path to return to after login, e.g. /account?next=%2Fvideo
export function loginUrl(next = location.pathname + location.search) {
  return '/account?next=' + encodeURIComponent(next);
}

export async function request(path, {method, body, headers, signal} = {}) {
  let response;
  try {
    response = await fetch(API_BASE + path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      credentials: 'include',
      cache: 'no-store',
      headers: {...(body === undefined ? {} : {'Content-Type': 'application/json'}), ...headers},
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('暂时无法连接服务，请检查网络后重试。', {status: 0, code: 'network_error'});
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = data?.error?.code ?? data?.code ?? `http_${response.status}`;
    throw new ApiError(errorMessage(code), {status: response.status, code});
  }
  return data;
}

// Resolves to the profile when signed in, null otherwise. Never redirects.
export async function currentUser() {
  try { return (await request('/api/me/profile')).user ?? null; }
  catch (error) { if (error.status === 401 || error.status === 403) return null; throw error; }
}

// Call right before a paid action. Returns the user, or saves nothing and navigates to login (returns null).
// Callers keep their own drafts (e.g. sessionStorage) before calling.
export async function requireLogin(next) {
  const user = await currentUser();
  if (!user) location.assign(loginUrl(next));
  return user;
}
