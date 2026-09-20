// Points balance pill in the site header ([data-points-wallet]); hidden when signed out.
const host=document.querySelector('[data-points-wallet]');
let loading=false,again=false;
async function refresh(){
  if(!host||document.hidden)return;if(loading){again=true;return;}loading=true;again=false;
  try{
    const r=await fetch('https://api.ipzsk.com/api/me/wallet',{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(r.status===401||r.status===403){host.hidden=true;host.replaceChildren();return;}
    if(!r.ok)throw Error();const d=await r.json();
    if(typeof d.available_points!=='string')throw Error();
    const link=document.createElement('a');link.href='/account?recharge=1';link.dataset.openRecharge='';
    const available=Number(d.available_points),frozen=Number(d.frozen_points);
    link.textContent=`${available.toLocaleString('zh-CN',{maximumFractionDigits:6})} 点`;
    link.title=(frozen>0?`处理中冻结 ${frozen} 点 · `:'')+'充值 / 兑换';
    if(available<=0)link.classList.add('empty');
    host.replaceChildren(link);host.hidden=false;
  }catch{host.textContent='点数暂不可用';host.hidden=false;}finally{loading=false;if(again)refresh();}
}
refresh();window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);window.addEventListener('ipzsk-wallet-changed',refresh);setInterval(refresh,15000);
