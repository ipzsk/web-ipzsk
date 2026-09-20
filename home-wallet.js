'use strict';

(() => {
  if (IPZSKBilling.useCanonicalOrigin()) return;
  const { call, money, checkout, renderUsage, paymentStates } = IPZSKBilling;
  const el = id => document.getElementById(id);
  let loading = false, checkoutPending = false, timer, polls = 0;
  const returned = new URLSearchParams(location.search).get('payment') === 'return';
  const message = (id, text, error = false) => {
    el(id).textContent = text; el(id).setAttribute('data-error', String(error));
  };
  function syncView() {
    const walletOpen = location.hash === '#wallet';
    el('wallet').hidden = !walletOpen;
    el('home').hidden = walletOpen;
    for (const [id, active] of [['homeTab', !walletOpen], ['walletTab', walletOpen]]) {
      el(id).classList.toggle('active', active);
      el(id).setAttribute('aria-current', active ? 'page' : 'false');
    }
    clearTimeout(timer);
    hideAccount();
    el('walletGuest').hidden = true;
    if (walletOpen) { polls = 0; loadDashboard(); }
  }
  function hideAccount() {
    el('walletDashboard').hidden = true;
    el('homeBalance').textContent = '—'; el('homeEmail').textContent = '';
    for (const id of ['homeUsage', 'homePaymentPacks', 'homePaymentOrders']) el(id).replaceChildren();
  }
  async function beginCheckout(pack) {
    if (checkoutPending) return;
    checkoutPending = true;
    el('homePaymentPacks').querySelectorAll('button').forEach(button => { button.disabled = true; });
    message('homePaymentNotice', '正在前往 Waffo 收银台…');
    try { location.assign(await checkout(pack)); }
    catch (error) {
      const code = error.payload?.error?.code;
      const messages = {
        payment_email_unavailable: '账户邮箱不可用，请重新登录或联系客服。',
        payment_checkout_already_requested: '充值请求已提交，请先查看充值记录。',
        online_payment_unavailable: '在线充值暂不可用，请稍后再试。',
        rate_limited: '操作太频繁，请稍后再试。',
      };
      message('homePaymentNotice', error.status === 401 ? '登录已过期，请重新登录后充值。'
        : messages[code] || '暂时无法打开收银台，请先刷新并检查充值记录后重试。', true);
    } finally {
      checkoutPending = false;
      el('homePaymentPacks').querySelectorAll('button').forEach(button => { button.disabled = false; });
    }
  }
  async function loadDashboard() {
    if (loading || el('wallet').hidden) return;
    loading = true; clearTimeout(timer); el('walletRefresh').disabled = true;
    message('walletStatus', '正在刷新账户…');
    try {
      const profile = await call('/api/me/profile');
      el('walletGuest').hidden = true; el('walletDashboard').hidden = false;
      el('homeEmail').textContent = profile.user.email;
      const results = await Promise.allSettled([
        call('/api/me/wallet'), call('/api/me/usage'), call('/api/me/payments/options'), call('/api/me/payments/orders'),
      ]);
      const expired = results.find(result => result.status === 'rejected' && result.reason.status === 401);
      if (expired) throw expired.reason;
      const [wallet, usage, options, orders] = results.map(result => result.status === 'fulfilled' ? result.value : null);
      el('homeBalance').textContent = wallet ? money(wallet.available_cny) : '—';
      renderUsage(el('homeUsage'), (usage?.rows ?? []).slice(0, 5));
      message('homeUsageStatus', !usage ? '消费记录加载失败，请刷新重试。' : usage.rows.length ? '' : '还没有消费记录。', !usage);
      el('homePaymentPacks').replaceChildren(...(options?.enabled ? options.packs : []).map(pack => {
        const button = document.createElement('button'); button.type = 'button'; button.disabled = checkoutPending;
        const price = document.createElement('strong'); price.textContent = money(pack.amount_cny);
        const amount = document.createElement('small'); amount.textContent = `充值 · 到账 ${money(pack.amount_cny)}`;
        button.append(price, amount); button.addEventListener('click', () => beginCheckout(pack.key)); return button;
      }));
      message('homePaymentMode', !options ? '充值选项加载失败，请刷新重试。' : !options.enabled ? '在线充值暂未开放。'
        : options.mode === 'test' ? '管理员测试环境：测试付款不会增加正式可消费额度。' : '选择金额，付款核实后自动到账。', !options);
      el('homePaymentOrders').replaceChildren(...(orders?.rows ?? []).slice(0, 3).map(order => {
        const item = document.createElement('div'); item.className = 'wallet-order';
        item.textContent = `${money(order.amount_cny)} · ${paymentStates[order.state] ?? '状态待确认'}${order.mode === 'test' ? ' · 测试' : ''}`;
        const time = document.createElement('small'); time.textContent = new Date(order.created_at).toLocaleString('zh-CN');
        item.append(time); return item;
      }));
      message('homeOrderStatus', !orders ? '充值记录加载失败，请刷新重试。' : orders.rows.length ? '' : '还没有充值记录。', !orders);
      const incomplete = results.some(result => result.status === 'rejected') || money(wallet?.available_cny) === '—';
      message('walletStatus', incomplete ? '部分账户信息暂时无法读取，请刷新重试。' : '账户已同步 · 金额均为人民币', incomplete);
      if (returned) {
        message('homePaymentNotice', '已返回网站，请以下方充值记录为准。只有支付核实后才会增加余额。');
        el('homePaymentOrders').closest('details').open = true;
        const pending = orders?.rows.some(order => ['creating', 'checkout_ready', 'paid', 'crediting'].includes(order.state));
        if (pending && !el('wallet').hidden && polls++ < 20) timer = setTimeout(loadDashboard, 5000);
      }
    } catch (error) {
      hideAccount();
      el('walletGuest').hidden = false;
      message('walletStatus', error.status === 401 ? '登录后即可查看本人余额、充值与消费记录。' : '账户信息暂时无法读取，请刷新重试。', error.status !== 401);
    } finally { loading = false; el('walletRefresh').disabled = false; }
  }
  el('walletRefresh').addEventListener('click', () => { polls = 0; loadDashboard(); });
  window.addEventListener('hashchange', syncView);
  // Browser back/forward restoration must not leave a cached account snapshot on screen.
  window.addEventListener('pageshow', event => { if (event.persisted) syncView(); });
  syncView();
})();
