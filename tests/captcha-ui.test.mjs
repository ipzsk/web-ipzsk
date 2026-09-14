import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('../captcha-ui.js',import.meta.url),'utf8')).replace('export function','function');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const token='t'.repeat(43),challenge={id:'i'.repeat(43),image:'data:image/png;base64,dGVzdA==',expires_in:120};
function setup(request){
 class Element extends EventTarget{disabled=false;hidden=false;open=false;value='';classList={toggle(){}};setAttribute(){}removeAttribute(name){if(name==='src')this.src='';}showModal(){this.open=true;}close(){this.open=false;}focus(){}click(){if(!this.disabled)this.dispatchEvent(new Event('click',{cancelable:true}));}}
 const nodes=new Map(),document={getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);}};
 const context=vm.createContext({document});vm.runInContext(source,context);
 return {get:id=>document.getElementById('captcha-'+id),human:context.createHumanProof({request})};
}
const submit=f=>f.get('form').dispatchEvent(new Event('submit',{cancelable:true}));
const cancel=async(f,p)=>{f.get('cancel').click();await assert.rejects(p,/已取消/);};
test('loading the image never passes verification; only successful server verification releases proof',async()=>{
 const calls=[];const f=setup(async(path,body)=>{calls.push({path,body});return path.endsWith('/verify')?{token}:challenge;});let resolved=false;
 const p=f.human('register','fixture@example.com');p.then(()=>resolved=true);await tick();
 assert.equal(resolved,false);assert.equal(calls.length,1);assert.equal(f.get('dialog').open,true);
 f.get('answer').value='abcde';submit(f);assert.equal((await p).token,token);assert.equal(calls[1].body.answer,'ABCDE');assert.equal(calls[1].body.email,'fixture@example.com');assert.equal(f.get('dialog').open,false);
});
test('empty input never reaches verification; wrong answer stays open and permits retry',async()=>{
 let calls=0;const f=setup(async path=>{if(path.endsWith('/verify')){calls++;throw Object.assign(new Error('wrong'),{code:'captcha_invalid'});}return challenge;});
 const p=f.human('reset','fixture@example.com');await tick();submit(f);assert.equal(calls,0);
 f.get('answer').value='ZZZZZ';submit(f);await tick();assert.equal(calls,1);assert.equal(f.get('dialog').open,true);assert.match(f.get('status').textContent,/错误/);assert.equal(f.get('answer').value,'');await cancel(f,p);
});
test('refresh replaces the image ID and clears the entered answer',async()=>{
 let calls=0,verified;const f=setup(async(path,body)=>{if(path.endsWith('/verify')){verified=body;return {token};}return {...challenge,id:String(++calls).repeat(43)};});
 const p=f.human('resend','fixture@example.com');await tick();f.get('answer').value='ABCDE';f.get('retry').click();await tick();assert.equal(f.get('answer').value,'');
 f.get('answer').value='FGHJK';submit(f);await p;assert.equal(verified.id,'2'.repeat(43));
});
test('network failure keeps dialog open; retry loads a new image',async()=>{
 let n=0;const f=setup(async()=>{if(!n++)throw new Error('network failed');return challenge;});const p=f.human('reset','fixture@example.com');await tick();
 assert.equal(f.get('dialog').open,true);assert.equal(f.get('continue').disabled,true);assert.equal(f.get('retry').disabled,false);
 f.get('retry').click();await tick();assert.equal(f.get('continue').disabled,false);await cancel(f,p);
});
test('cancelling during image load ignores the delayed response',async()=>{
 let complete;const f=setup(()=>new Promise(resolve=>complete=resolve));const p=f.human('reset','fixture@example.com');await cancel(f,p);complete(challenge);await tick();assert.equal(f.get('dialog').open,false);assert.equal(f.get('image').hidden,true);
});
test('cancelling during verification never submits the later proof',async()=>{
 let complete;const f=setup(path=>path.endsWith('/verify')?new Promise(resolve=>complete=resolve):Promise.resolve(challenge));const p=f.human('reset','fixture@example.com');await tick();f.get('answer').value='ABCDE';submit(f);await cancel(f,p);complete({token});await tick();assert.equal(f.get('dialog').open,false);
});
