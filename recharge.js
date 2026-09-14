const API='https://api.ipzsk.com';
const formatPoints=value=>Number(value).toLocaleString('zh-CN',{maximumFractionDigits:6});
const dialog=document.createElement('dialog');
dialog.className='recharge-dialog';dialog.setAttribute('aria-labelledby','recharge-title');
dialog.innerHTML=`<div class="recharge-head"><div><p class="recharge-eyebrow">IPZSK · 账户点数</p><h2 id="recharge-title">充值 / 兑换</h2></div><button type="button" class="recharge-close" aria-label="关闭充值面板">×</button></div>
<div class="recharge-balance"><span>剩余可用点数</span><strong data-recharge-balance>正在读取…</strong><small data-recharge-frozen></small></div>
<section class="recharge-buy"><div><h3>购买充值码</h3><p>前往商城购买，付款获得兑换码后，返回这里兑换。</p></div><a class="recharge-button" href="https://store.wayneinsightspring.com/" target="_blank" rel="noopener noreferrer">购买充值码 ↗</a></section>
<form class="recharge-form"><h3>已有兑换码</h3><label for="recharge-code">兑换码</label><div class="recharge-input-row"><input id="recharge-code" name="code" placeholder="输入或粘贴兑换码" required maxlength="100" autocomplete="off" spellcheck="false"><button class="recharge-button" type="submit">确认兑换</button></div><p class="recharge-login" hidden>请先登录，兑换的点数会存入你的账户。<a href="/account?next=recharge">登录后兑换 →</a></p></form>
<p class="recharge-notice" role="status" aria-live="polite"></p><p class="recharge-rate">10 元 = 1,000 点 · 50 元 = 5,000 点<br>网页与客户端共用点数，购买后需使用兑换码到账。</p>`;
document.body.append(dialog);
const balance=dialog.querySelector('[data-recharge-balance]'),frozen=dialog.querySelector('[data-recharge-frozen]');
const form=dialog.querySelector('form'),input=form.elements.code,submit=form.querySelector('button');
const notice=dialog.querySelector('.recharge-notice'),login=dialog.querySelector('.recharge-login');
let busy=false,refreshing=false;
function showNotice(message,error=false){notice.textContent=message;notice.classList.toggle('is-error',error);}
function signedOut(){balance.textContent='登录后查看';frozen.textContent='';login.hidden=false;input.disabled=true;submit.disabled=true;input.value='';}
async function refresh(){
 if(refreshing)return;refreshing=true;
 try{const r=await fetch(API+'/api/me/wallet',{credentials:'include',cache:'no-store'});
  if(r.status===401||r.status===403){signedOut();return;}
  if(!r.ok)throw Error();const wallet=await r.json();
  if(wallet.available_points==null)throw Error();
  balance.textContent=formatPoints(wallet.available_points)+' 点';
  frozen.textContent=Number(wallet.frozen_points)>0?'处理中冻结 '+formatPoints(wallet.frozen_points)+' 点':Number(wallet.available_points)<=0?'兑换充值码后即可使用':'网页与客户端实时共用';
  login.hidden=true;input.disabled=false;submit.disabled=busy;
 }catch{balance.textContent='暂时无法读取';frozen.textContent='可稍后重新打开面板刷新';}finally{refreshing=false;}
}
function openRecharge(){if(!dialog.open){showNotice('');dialog.showModal();}refresh();}
document.addEventListener('click',event=>{const entry=event.target.closest('[data-open-recharge]');if(entry){event.preventDefault();openRecharge();}});
window.addEventListener('ipzsk-open-recharge',openRecharge);
dialog.querySelector('.recharge-close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',()=>{input.value='';});
form.addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;busy=true;submit.disabled=true;input.readOnly=true;showNotice('正在兑换…');
 const code=input.value.trim();
 try{
  const r=await fetch(API+'/api/me/vouchers/redeem',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
  const data=await r.json();
  if(r.status===401){signedOut();showNotice('登录已失效，请登录后再兑换。',true);return;}
  if(!r.ok){const messages={voucher_unavailable:'兑换码不可用，请核对是否已兑换、过期或尚未启用。',invalid_voucher:'请检查兑换码格式。',rate_limited:'操作太频繁，请稍后再试。',account_disabled:'账户已停用，请联系管理员。'};showNotice(messages[data.error?.code]||'兑换未成功，请稍后重试。',true);return;}
  input.value='';showNotice(data.replayed?'这枚码已兑换到你的账户，未重复入账。':'兑换成功，已到账 '+formatPoints(data.amount_points)+' 点。');
  window.dispatchEvent(new Event('ipzsk-wallet-changed'));await refresh();
 }catch{showNotice('网络异常，暂未确认兑换结果。可使用同一码重试，不会重复入账。',true);}
 finally{busy=false;input.readOnly=false;submit.disabled=!login.hidden;}
});
window.addEventListener('focus',()=>{if(dialog.open)refresh();});
window.addEventListener('ipzsk-wallet-changed',()=>{if(dialog.open)refresh();});
if(new URLSearchParams(location.search).get('recharge')==='1')openRecharge();
