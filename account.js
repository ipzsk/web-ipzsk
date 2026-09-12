'use strict';
// 账户页：注册 / 登录 / 邮箱验证 / 余额 / 兑换码。
//
// 所有请求直接打网关（api.ipzsk.com），带 cookie。www 与 api 同属 ipzsk.com，
// 算同站，SameSite=Lax 的会话 cookie 会被带上——所以这里不需要再拿一层代理转发，
// 也就不需要在网站这侧持有任何密钥。**网站不再有服务端密钥**，这是这次改造的重点：
// 原先生图走的是同源 Function + 一把共享的上游 Key，谁用都记不到人头上。
const API = 'https://api.ipzsk.com';
const byId = (id) => document.getElementById(id);
const show = (id, visible) => byId(id).classList.toggle('hidden', !visible);
const notice = (id, text, ok = false) => { const el = byId(id); el.textContent = text; el.className = 'notice' + (text ? (ok ? ' ok' : ' error') : ''); };

const MESSAGES = {
  captcha_required: '请先完成图形验证',
  captcha_invalid: '验证码不正确，换一张再试',
  rate_limited: '操作太频繁，请稍后再试',
  invalid_email: '邮箱格式不正确',
  email_verification_required: '请先完成邮箱验证',
  account_disabled: '账户已停用，请联系客服',
  voucher_unavailable: '兑换码无效或已被使用',
  email_service_unavailable: '邮件服务暂不可用，稍后再试',
};
const explain = (payload, fallback) => {
  const code = payload?.error?.code ?? payload?.code ?? payload?.message;
  if (MESSAGES[code]) return MESSAGES[code];
  return typeof payload?.message === 'string' && payload.message ? payload.message : fallback;
};

async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(API + path, {
    method, credentials: 'include',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) { const error = new Error('request_failed'); error.status = response.status; error.payload = payload; throw error; }
  return payload;
}

// ── 图形验证码：注册、发码、以及连续失败后的登录都要它 ────────────────────
let challenge = null;
async function refreshCaptcha() {
  challenge = await call('/api/account/captcha', { method: 'POST', body: {} });
  byId('captchaImage').src = challenge.image;
  byId('captchaAnswer').value = '';
}
async function captchaProof() {
  if (!challenge) await refreshCaptcha();
  const answer = byId('captchaAnswer').value.trim();
  if (!answer) throw new Error('captcha_answer_required');
  const solved = await call('/api/account/captcha/verify', { method: 'POST', body: { id: challenge.id, answer } });
  challenge = null;                       // 一张挑战只能换一次凭证
  return { token: solved.token };
}
async function withCaptcha(body) { return { ...body, captcha: await captchaProof() }; }

// ── 注册 / 登录 ───────────────────────────────────────────────────────────
let mode = 'login', pendingEmail = '';
function setMode(next) {
  mode = next;
  byId('tabLogin').setAttribute('aria-pressed', String(next === 'login'));
  byId('tabRegister').setAttribute('aria-pressed', String(next === 'register'));
  byId('submitAuth').textContent = next === 'login' ? '登录' : '注册并发送验证码';
  byId('password').autocomplete = next === 'login' ? 'current-password' : 'new-password';
  show('passwordHint', next === 'register');
  notice('authNotice', '');
  // 注册必须过验证码；登录先不显示，服务端要求时再亮出来。
  show('captchaBox', next === 'register');
  if (next === 'register') refreshCaptcha().catch(() => notice('authNotice', '验证码加载失败，刷新页面再试'));
}

async function submitAuth() {
  const email = byId('email').value.trim().toLowerCase(), password = byId('password').value;
  if (!email || !password) return notice('authNotice', '请填写邮箱和密码');
  const button = byId('submitAuth'); button.disabled = true;
  try {
    if (mode === 'register') {
      if (password.length < 12) return notice('authNotice', '密码至少 12 位');
      await call('/api/auth/sign-up/email', { method: 'POST', body: await withCaptcha({ email, password, name: email.split('@')[0] }) });
      pendingEmail = email;
      notice('authNotice', '');
      byId('verifyLead').textContent = `验证码已发送到 ${email}，请查收邮件（可能在垃圾箱）。`;
      show('authCard', false); show('verifyCard', true);
      return;
    }
    await call('/api/auth/sign-in/email', { method: 'POST', body: { email, password } });
    await loadAccount();
  } catch (error) {
    const code = error.payload?.error?.code ?? error.payload?.code;
    if (code === 'captcha_required' || code === 'captcha_invalid') {
      // 连续失败之后服务端开始要验证码：亮出来，让用户补上重试。
      show('captchaBox', true);
      await refreshCaptcha().catch(() => {});
      return notice('authNotice', MESSAGES[code]);
    }
    if (error.message === 'captcha_answer_required') return notice('authNotice', '请输入图中字符');
    if (error.status === 401) return notice('authNotice', '邮箱或密码不正确');
    if (error.status === 403 && code === 'email_verification_required') {
      pendingEmail = email; show('authCard', false); show('verifyCard', true);
      byId('verifyLead').textContent = '这个邮箱还没验证，点「重新发送」拿一个新的验证码。';
      return;
    }
    notice('authNotice', explain(error.payload, '登录失败，请稍后再试'));
  } finally { button.disabled = false; }
}

async function submitOtp() {
  const otp = byId('otp').value.trim();
  if (!/^\d{6}$/.test(otp)) return notice('verifyNotice', '请输入 6 位数字验证码');
  const button = byId('submitOtp'); button.disabled = true;
  try {
    await call('/api/auth/email-otp/verify-email', { method: 'POST', body: { email: pendingEmail, otp } });
    // 验证接口不发会话 cookie，还要再登录一次；密码还在输入框里就直接用。
    const password = byId('password').value;
    if (password) await call('/api/auth/sign-in/email', { method: 'POST', body: { email: pendingEmail, password } });
    notice('verifyNotice', '');
    await loadAccount();
  } catch (error) {
    notice('verifyNotice', error.status === 401 ? '验证码不正确或已过期' : explain(error.payload, '验证失败，请重试'));
  } finally { button.disabled = false; }
}

async function resendOtp() {
  const button = byId('resendOtp'); button.disabled = true;
  try {
    show('captchaBox', true);
    if (!challenge) await refreshCaptcha();
    if (!byId('captchaAnswer').value.trim()) { show('authCard', true); return notice('authNotice', '请先完成图形验证，再点重新发送'); }
    await call('/api/auth/email-otp/send-verification-otp',
      { method: 'POST', body: await withCaptcha({ email: pendingEmail, type: 'email-verification' }) });
    notice('verifyNotice', '验证码已重新发送', true);
  } catch (error) {
    notice('verifyNotice', explain(error.payload, '发送失败，请稍后再试'));
  } finally { button.disabled = false; }
}

// ── 已登录：余额、流水、兑换码 ─────────────────────────────────────────────
const money = (value) => '¥' + Number(value ?? 0).toFixed(2);
async function loadAccount() {
  const profile = await call('/api/me/profile').catch(() => null);
  if (!profile) { show('authCard', true); show('verifyCard', false); return signedOut(); }
  show('authCard', false); show('verifyCard', false);
  for (const id of ['accountCard', 'voucherCard', 'sessionCard']) show(id, true);
  byId('who').textContent = `${profile.user.email}`;
  const wallet = await call('/api/me/wallet').catch(() => null);
  byId('balance').textContent = wallet ? money(wallet.available_cny) : '—';
  byId('balanceSource').textContent = wallet?.source === 'lanehub' ? '可用额度' : '可用余额';
  byId('entries').innerHTML = (wallet?.entries ?? []).slice(0, 10).map((entry) =>
    `<tr><td>${entry.kind === 'recharge' ? '充值' : '消费'} · ${new Date(entry.created_at).toLocaleDateString('zh-CN')}</td><td>${money(entry.amount_cny)}</td></tr>`).join('');
}
function signedOut() {
  for (const id of ['accountCard', 'voucherCard', 'sessionCard']) show(id, false);
  show('authCard', true);
}

async function redeem() {
  const code = byId('voucherCode').value.trim();
  if (!code) return notice('voucherNotice', '请输入兑换码');
  const button = byId('redeem'); button.disabled = true;
  try {
    const result = await call('/api/me/vouchers/redeem', { method: 'POST', body: { code } });
    notice('voucherNotice', result.replayed ? '这张兑换码之前已经兑换过了' : `已入账 ${money(result.amount_cny)}`, true);
    byId('voucherCode').value = '';
    await loadAccount();
  } catch (error) {
    notice('voucherNotice', explain(error.payload, '兑换失败，请检查兑换码'));
  } finally { button.disabled = false; }
}

byId('tabLogin').addEventListener('click', () => setMode('login'));
byId('tabRegister').addEventListener('click', () => setMode('register'));
byId('submitAuth').addEventListener('click', submitAuth);
byId('password').addEventListener('keydown', (event) => { if (event.key === 'Enter') submitAuth(); });
byId('captchaImage').addEventListener('click', () => refreshCaptcha().catch(() => {}));
byId('submitOtp').addEventListener('click', submitOtp);
byId('resendOtp').addEventListener('click', resendOtp);
byId('redeem').addEventListener('click', redeem);
byId('signOut').addEventListener('click', async () => {
  await call('/api/auth/sign-out', { method: 'POST', body: {} }).catch(() => {});
  signedOut();
});
setMode('login');
loadAccount().catch(() => signedOut());
