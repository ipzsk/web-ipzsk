const host=document.querySelector('[data-points-wallet]');
let loading=false;
async function refresh(){
  if(!host||loading||document.hidden)return;loading=true;
  try{
    const r=await fetch('https://api.ipzsk.com/api/me/wallet',{credentials:'include',cache:'no-store'});
    const link=document.createElement('a');link.href='/account?recharge=1';link.dataset.openRecharge='';
    if(r.status===401||r.status===403){link.textContent='充值 / 兑换 · 登录后使用';host.replaceChildren(link);return;}
    if(!r.ok)throw Error();const d=await r.json();
    if(typeof d.available_points!=='string')throw Error();
    link.textContent=`${Number(d.available_points).toLocaleString('zh-CN',{maximumFractionDigits:6})} 点 · 充值 / 兑换`;
    const note=document.createElement('span');note.textContent=Number(d.frozen_points)>0?` · 处理中冻结 ${Number(d.frozen_points)} 点`:Number(d.available_points)<=0?' · 请先充值后使用':'';
    host.replaceChildren(link,note);
  }catch{host.textContent='点数暂时无法读取，请稍后刷新。';}finally{loading=false;}
}
refresh();window.addEventListener('focus',refresh);window.addEventListener('ipzsk-wallet-changed',refresh);setInterval(refresh,15000);
