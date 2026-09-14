import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from '../image-studio/node_modules/jsdom/lib/api.js';
const source=await readFile(new URL('../points-wallet.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const reply=points=>({ok:true,status:200,json:async()=>({available_points:points,frozen_points:'0'})});
function setup(fetch){
 const dom=new JSDOM('<div data-points-wallet></div>',{url:'https://www.ipzsk.com/image.html',runScripts:'outside-only',pretendToBeVisual:true});
 dom.window.fetch=fetch;dom.window.AbortSignal=AbortSignal;dom.window.eval(source);return dom;
}
test('billing notification during a wallet read fetches again instead of leaving the old balance',async()=>{
 let resolveFirst,calls=0;
 const dom=setup(async(url,options)=>{assert.equal(options.cache,'no-store');assert.equal(options.credentials,'include');assert.ok(options.signal);if(++calls===1)return new Promise(resolve=>resolveFirst=resolve);return reply('962.5');});
 try{dom.window.dispatchEvent(new dom.window.Event('ipzsk-wallet-changed'));resolveFirst(reply('1000'));await tick();await tick();assert.equal(calls,2);assert.match(dom.window.document.body.textContent,/962.5 点/);}finally{dom.window.close();}
});
test('returning to a visible tab refreshes a balance changed elsewhere',async()=>{
 let balance='1000',calls=0;const dom=setup(async()=>{calls++;return reply(balance);});
 try{await tick();balance='950';dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));await tick();assert.equal(calls,2);assert.match(dom.window.document.body.textContent,/950 点/);}finally{dom.window.close();}
});
