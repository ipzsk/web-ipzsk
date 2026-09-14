import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from '../image-studio/node_modules/jsdom/lib/api.js';
const source=await readFile(new URL('../recharge.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function setup(fetch,url='https://www.ipzsk.com/'){
 const dom=new JSDOM('<a href="/account?recharge=1" data-open-recharge>充值 / 兑换</a>',{url,runScripts:'outside-only'});
 const w=dom.window;w.fetch=fetch;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};w.eval(source);return dom;
}
const reply=(status,data)=>({status,ok:status<400,json:async()=>data});
test('anonymous visitor gets login return link and cannot submit a voucher',async()=>{
 const dom=setup(async()=>reply(401,{}),'https://www.ipzsk.com/account?recharge=1');try{await tick();const d=dom.window.document;assert.equal(d.querySelector('dialog').open,true);assert.equal(d.querySelector('input').disabled,true);assert.equal(d.querySelector('.recharge-login').hidden,false);assert.equal(d.querySelector('.recharge-login a').getAttribute('href'),'/account?next=recharge');assert.equal(d.querySelector('.recharge-buy a').target,'_blank');}finally{dom.window.close();}
});
test('successful redemption sends one request, updates balance, and notifies other views',async()=>{
 let calls=0,redeemed=false,events=0;const dom=setup(async(url,options)=>{if(url.endsWith('/redeem')){calls++;assert.equal(options.credentials,'include');assert.deepEqual(JSON.parse(options.body),{code:'IPZ-test'});await tick();redeemed=true;return reply(200,{amount_points:'5000'});}return reply(200,{available_points:redeemed?'5025':'25',frozen_points:'0'});});
 try{const w=dom.window,d=w.document;w.addEventListener('ipzsk-wallet-changed',()=>events++);d.querySelector('a').click();await tick();d.querySelector('input').value=' IPZ-test ';const f=d.querySelector('form');f.dispatchEvent(new w.Event('submit',{cancelable:true}));f.dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();await tick();assert.equal(calls,1);assert.equal(events,1);assert.match(d.querySelector('.recharge-notice').textContent,/5,000/);assert.match(d.querySelector('[data-recharge-balance]').textContent,/5,025/);assert.equal(d.querySelector('input').value,'');}finally{dom.window.close();}
});
test('invalid voucher does not announce a credit and keeps code for correction',async()=>{
 const dom=setup(async url=>url.endsWith('/redeem')?reply(400,{error:{code:'voucher_unavailable'}}):reply(200,{available_points:'0',frozen_points:'0'}));try{const w=dom.window,d=w.document;d.querySelector('a').click();await tick();d.querySelector('input').value='IPZ-test';d.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();assert.match(d.querySelector('.recharge-notice').textContent,/尚未启用/);assert.equal(d.querySelector('input').value,'IPZ-test');assert.equal(d.querySelector('form button').disabled,false);}finally{dom.window.close();}
});
