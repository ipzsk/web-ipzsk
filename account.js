import {initAuth} from './auth-ui.js';
import {createHumanProof} from './captcha-ui.js';
const $=(s)=>document.querySelector(s);let authUi;let usagePage=1;let usageData;
const points=(v)=>v==null?'待核实':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:6})+' 点';
const errors={captcha_required:'请先完成人机验证。',captcha_invalid:'人机验证已失效，请重新验证。',captcha_unavailable:'人机验证服务暂不可用，请稍后重试。',INVALID_EMAIL_OR_PASSWORD:'邮箱或密码不正确；未注册的邮箱请先注册。',EMAIL_NOT_VERIFIED:'邮箱尚未验证，请到注册页面完成邮箱验证。',PASSWORD_TOO_SHORT:'密码至少需要 12 位。',PASSWORD_TOO_LONG:'密码最多 128 位。',USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:'该邮箱已注册，请登录或找回密码。',email_service_unavailable:'邮箱验证服务尚未开放，注册和找回密码暂不可用；已有账户可以使用密码登录。',email_delivery_failed:'邮件发送失败，请稍后重试。',customer_login_required:'请先使用邮箱和密码登录。',account_disabled:'账户已停用，请联系管理员。',invalid_email:'请检查邮箱地址。',rate_limited:'请求过于频繁，请稍后重试。',INVALID_OTP:'验证码错误或已失效，请检查后重试。',OTP_EXPIRED:'验证码已过期，请重新发送。',TOO_MANY_ATTEMPTS:'验证次数过多，请重新发送验证码。',INVALID_EMAIL:'邮箱地址格式不正确。',voucher_unavailable:'充值码不可用，请核对是否已兑换、过期或尚未启用。',invalid_voucher:'请检查充值码格式。'};
function clearSession(){
  const wasSignedIn=$('#email-login').hidden;
  $('#account-main').classList.add('auth-page');$('#customer-panel').hidden=true;$('#email-login').hidden=false;
  $('#customer-token').value='';$('#customer-token-result').hidden=true;
  for(const id of ['customer-email','customer-balance','customer-frozen','customer-name','customer-verification','customer-created'])$('#'+id).textContent='';
  for(const id of ['customer-ledger','customer-keys','customer-requests'])$('#'+id).replaceChildren();usageData=undefined;if(wasSignedIn)authUi?.restore();
}
async function request(path,body){const r=await fetch('https://api.ipzsk.com'+path,{method:body?'POST':'GET',credentials:'include',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok){if(r.status===401&&path.startsWith('/api/me/'))clearSession();throw Object.assign(new Error(errors[d.error?.code??d.code]??'操作未成功，请稍后重试。'),{code:d.error?.code??d.code});}return d;}
function handler(fn){return async(e)=>{e.preventDefault();const b=e.target.closest('button')??e.target.querySelector('button');if(b){b.disabled=true;b.dataset.busy='true';}authUi.notice();try{await fn(e);}catch(error){authUi.notice(error.message,true);}finally{if(b){delete b.dataset.busy;b.disabled=false;}}};}
async function loadAccount(){
  const profile=await request('/api/me/profile');
  const [wallet,usage,keys]=await Promise.all([request('/api/me/wallet'),request('/api/me/usage'),request('/api/me/tokens')]);
  if(!profile.user.email_verified)throw new Error('请使用已验证的邮箱账户登录。');
  $('#account-main').classList.remove('auth-page');$('#auth-step').hidden=true;$('#email-login').hidden=true;$('#customer-panel').hidden=false;document.title='个人中心 · IPZSK';$('#account-heading').textContent='个人中心';$('#account-description').textContent='管理个人资料、创作内容与账户收支。';
  usagePage=1;renderUsage(usage);
  $('#customer-email').textContent=profile.user.email;
  $('#customer-name').textContent=profile.user.name || '未设置';
  $('#customer-verification').textContent=profile.user.email_verified ? '已验证' : '未验证';
  const joined=new Date(profile.user.created_at);$('#customer-created').textContent=Number.isNaN(joined.getTime()) ? '暂无记录' : joined.toLocaleDateString('zh-CN');
  $('#customer-balance').textContent=points(wallet.available_points);$('#customer-frozen').hidden=Number(wallet.frozen_cny)===0;$('#customer-frozen').textContent=`处理中冻结 ${points(wallet.frozen_points)}`;$('#customer-usage').textContent=Number(wallet.available_points)>0?`已使用 ${usage.summary.requests} 次 · 网页与客户端共用点数`:'暂无可用点数，请先兑换充值码后使用。';
  $('#customer-token-prefix').textContent=`共 ${keys.rows.filter(r=>!r.revoked_at&&(!r.expires_at||new Date(r.expires_at)>new Date())).length} 把有效凭证，共用当前账户钱包。`;
  $('#customer-issue-token').textContent='创建独立 API 凭证';
  $('#customer-keys').replaceChildren(...keys.rows.map(r=>{
    const p=document.createElement('p'),text=document.createElement('span');
    text.textContent=`${r.name} · ${r.prefix}… · ${r.revoked_at?'已吊销':r.expires_at&&new Date(r.expires_at)<new Date()?'已到期':'有效'} · 限速 ${r.rpm??'账户上限'} · 到期 ${r.expires_at?new Date(r.expires_at).toLocaleString('zh-CN'):'永久'} `;p.append(text);
    if(!r.revoked_at){const b=document.createElement('button');b.className='text-button';b.textContent='吊销';b.addEventListener('click',handler(async()=>{if(!confirm('吊销这把凭证？使用它的应用将停止调用。'))return;await request('/api/me/tokens/'+r.id+'/revoke',{});await loadAccount();}));p.append(b);}return p;
  }));
  $('#customer-ledger').replaceChildren(...wallet.entries.map((r)=>{const p=document.createElement('p');p.className='muted';p.textContent=`${new Date(r.created_at).toLocaleString('zh-CN')} · ${r.kind==='consumption'?'消费':'充值'} ${points(r.amount_points)}`;return p;}));
}
$('#customer-issue-token').addEventListener('click',handler(async()=>{const r=await request('/api/me/tokens',{name:$('#customer-key-name').value||'默认凭证',rpm:$('#customer-key-rpm').value?Number($('#customer-key-rpm').value):null,expires_at:$('#customer-key-expiry').value?new Date($('#customer-key-expiry').value).toISOString():null});$('#customer-token').value=r.token;$('#customer-token-result').hidden=false;await loadAccount();}));
$('#customer-copy-token').addEventListener('click',handler(async()=>{await navigator.clipboard.writeText($('#customer-token').value);authUi.notice('已复制凭证。');}));
$('#customer-refresh').addEventListener('click',handler(loadAccount));
$('#customer-logout').addEventListener('click',handler(async()=>{await request('/api/auth/sign-out',{});clearSession();authUi.showLogin();authUi.notice('已安全退出登录。');}));
const humanProof=createHumanProof({request});
authUi=initAuth({request,humanProof,onSignedIn:()=>location.replace(({recharge:'https://www.ipzsk.com/account?recharge=1',developer:'https://www.ipzsk.com/developer',workspace:'https://www.ipzsk.com/workspace',video:'https://www.ipzsk.com/video'}[new URLSearchParams(location.search).get('next')]||'https://www.ipzsk.com/'))});
await Promise.all([
  request('/api/account/status').then(status=>{authUi.setStatus(status);}).catch(()=>authUi.setStatus(null)),
  loadAccount().catch(error=>{if(error.code!=='customer_login_required')authUi.notice('暂时无法加载账户，请稍后刷新重试。',true);})
]);

function renderUsage(data){
 usageData=data;const box=$('#customer-requests');box.replaceChildren();const table=document.createElement('table'),head=document.createElement('tr');
 for(const label of ['时间','模型','状态','输入 / 输出 Token','消耗点数','请求编号']){const th=document.createElement('th');th.textContent=label;head.append(th);}table.append(head);
 for(const row of data.rows){const tr=document.createElement('tr');for(const value of [new Date(row.created_at).toLocaleString('zh-CN'),row.model,{succeeded:'成功',failed:'失败',running:'处理中',queued:'排队',uncertain:'待核实'}[row.status]??row.status,`${row.input_tokens??'待核实'} / ${row.output_tokens??'待核实'}`,row.charged_points!=null?points(row.charged_points):({reserved:'处理中',pending:'待结算',released:'未扣款'}[row.billing_state]??'历史未计费'),row.id]){const td=document.createElement('td');td.textContent=value;tr.append(td);}table.append(tr);}box.append(table);
 $('#usage-page').textContent=`第 ${data.page} 页 · 共 ${data.count} 条`;$('#usage-prev').disabled=data.page<=1;$('#usage-next').disabled=data.page*data.page_size>=data.count;
}
for(const [id,delta] of [['usage-prev',-1],['usage-next',1]])$('#'+id).addEventListener('click',async()=>{try{$('#usage-prev').disabled=true;$('#usage-next').disabled=true;const target=usagePage+delta;const data=await request('/api/me/usage?page='+target);usagePage=target;usageData=data;}catch(e){authUi.notice(e.message,true);}finally{if(usageData)renderUsage(usageData);}});

async function refreshPoints(){
  if(document.hidden||$('#customer-panel').hidden)return;
  try{const [wallet,usage]=await Promise.all([request('/api/me/wallet'),request('/api/me/usage?page='+usagePage)]);
    if($('#customer-panel').hidden)return;
    $('#customer-balance').textContent=points(wallet.available_points);
    $('#customer-frozen').hidden=Number(wallet.frozen_points)===0;$('#customer-frozen').textContent=`处理中冻结 ${points(wallet.frozen_points)}`;
    renderUsage(usage);
  }catch{}
}
setInterval(refreshPoints,30000);window.addEventListener('focus',refreshPoints);

window.addEventListener('ipzsk-wallet-changed',()=>{if(!$('#customer-panel').hidden)loadAccount().catch(()=>{});});
