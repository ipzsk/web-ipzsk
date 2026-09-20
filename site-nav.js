// Site-wide top nav: renders into every [data-site-nav]; account link and points pill update once the session is known.
import {currentUser,loginUrl} from '/api.js';
const clean=p=>p.replace(/(\/index)?\.html$/,'').replace(/(.)\/$/,'$1')||'/';
const here=clean(location.pathname);
const links=[['/','首页 · 下载'],['/image','生图'],['/video','生视频'],['/workspace','内容工作台']];
const accounts=[];
for(const host of document.querySelectorAll('[data-site-nav]')){
  const nav=document.createElement('nav'),brand=document.createElement('a'),row=document.createElement('div'),side=document.createElement('div'),points=document.createElement('span');
  nav.className='site-nav';nav.setAttribute('aria-label','主导航');brand.className='site-brand';brand.href='/';brand.textContent='IPZSK';row.className='site-links';side.className='site-account';
  for(const [href,text] of links){const a=document.createElement('a');a.href=href;a.textContent=text;if(clean(href)===here)a.setAttribute('aria-current','page');row.append(a);}
  points.className='site-points';points.hidden=true;points.setAttribute('role','status');if(!document.querySelector('[data-points-wallet]'))points.dataset.pointsWallet='';
  const account=document.createElement('a');account.className='site-account-link';account.href='/account';account.textContent='我的';if(here==='/account')account.setAttribute('aria-current','page');
  side.append(points,account);accounts.push(account);nav.append(brand,row,side);host.replaceChildren(nav);
}
import('/points-wallet.js');
currentUser().then(user=>{if(!user)for(const a of accounts){a.textContent='登录 / 注册';a.classList.add('primary');if(here!=='/account')a.href=loginUrl();}}).catch(()=>{});
