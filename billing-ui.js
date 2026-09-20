'use strict';

// Shared by the homepage and account page. No credentials or balances are stored locally.
const IPZSKBilling = (() => {
  const API = 'https://api.ipzsk.com';
  function useCanonicalOrigin() {
    // Authenticated API access is restricted to www; keep the existing CORS boundary intact.
    if (location.hostname !== 'ipzsk.com') return false;
    const url = new URL('https://www.ipzsk.com');
    url.pathname = location.pathname; url.search = location.search; url.hash = location.hash;
    location.replace(url.href); return true;
  }
  function money(value, detailed = false) {
    if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return '—';
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '—';
    const precision = detailed || (amount !== 0 && Math.abs(amount) < 0.01) ? 8 : 2;
    return (amount < 0 ? '-¥' : '¥') + Math.abs(amount).toLocaleString('zh-CN', {
      minimumFractionDigits: 2, maximumFractionDigits: precision, useGrouping: false,
    });
  }
  async function call(path, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(API + path, {
      method, credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(20000),
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      const error = new Error('request_failed'); error.status = response.status; error.payload = payload; throw error;
    }
    return payload;
  }
  async function checkout(pack) {
    const result = await call('/api/me/payments/checkout', { method: 'POST', body: { pack },
      headers: { 'Idempotency-Key': crypto.randomUUID() } });
    const url = new URL(result.checkout_url);
    if (url.protocol !== 'https:' || url.hostname !== 'pancake.waffo.ai' || url.username || url.password)
      throw new Error('invalid_checkout_url');
    return url.href;
  }
  const paymentStates = {
    creating: '正在准备收银台', checkout_ready: '待支付或等待支付确认', checkout_failed: '收银台创建失败',
    paid: '支付已确认，额度到账中', crediting: '额度到账中', credited: '充值已到账',
    test_completed: '测试支付已完成（不增加正式额度）', refund_review: '退款处理中，请联系客服',
    review_required: '正在核对到账情况，请联系客服',
  };
  function renderUsage(container, rows) {
    container.replaceChildren(...rows.map(row => {
      const tr = document.createElement('tr');
      const model = document.createElement('td'); model.textContent = row.model || '模型调用';
      const date = document.createElement('td'); date.textContent = new Date(row.created_at).toLocaleString('zh-CN');
      const charge = document.createElement('td');
      // Only settled customer charges are money. Provider costs and estimates are never used here.
      const settled = ['settled', 'released'].includes(row.billing_state);
      charge.textContent = settled && money(row.charged_cny) !== '—' ? money(row.charged_cny, true) : '待结算';
      tr.append(model, date, charge); return tr;
    }));
  }
  return { money, call, checkout, paymentStates, renderUsage, useCanonicalOrigin };
})();
