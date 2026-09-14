const entry=document.querySelector('#account-entry');
async function updateAccountEntry(){
  try{
    const response=await fetch('https://api.ipzsk.com/api/me/profile',{credentials:'include',cache:'no-store'});
    if(!response.ok&&response.status!==401&&response.status!==403)return;
    const authenticated=response.ok;
    entry.textContent=authenticated?'个人中心 ↗':'登录 / 注册 ↗';
    if(authenticated){const r=await fetch('https://api.ipzsk.com/api/me/wallet',{credentials:'include',cache:'no-store'});if(r.ok){const w=await r.json();if(w.available_points!=null)entry.textContent=`${Number(w.available_points).toLocaleString('zh-CN',{maximumFractionDigits:6})} 点 · 充值 ↗`;}}
    entry.dataset.mobileLabel=authenticated?'个人中心':'登录';
    entry.href='https://www.ipzsk.com/account';
  }catch{/* Keep the existing account link usable if the API is unavailable. */}
}
window.addEventListener('pageshow',updateAccountEntry);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateAccountEntry();});
