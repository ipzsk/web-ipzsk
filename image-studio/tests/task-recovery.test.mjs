import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
const bundle=await build({entryPoints:['web/api.ts'],bundle:true,write:false,format:'iife',globalName:'StudioApi'});
const storage=await build({entryPoints:['web/storage.ts'],bundle:true,write:false,format:'iife',globalName:'Storage'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const response=(data,status=200)=>({ok:status<400,status,json:async()=>data});
function environment(indexedDB=new IDBFactory()){
 const dom=new JSDOM('',{url:'https://www.ipzsk.com/image.html',runScripts:'outside-only'}),w=dom.window;
 w.indexedDB=indexedDB;w.structuredClone=structuredClone;
 const timer=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>timer(fn,Math.min(ms,5),...args);
 w.eval(bundle.outputFiles[0].text);w.eval(storage.outputFiles[0].text);
 const instances=[];return {w,store:w.Storage.createStorage('a'),api(user='a'){const api=new w.StudioApi.WebImageApi(user);instances.push(api);return api;},close(){instances.forEach(api=>api.dispose());w.close();}};
}
async function until(check){for(let i=0;i<300;i++){const value=await check();if(value)return value;await pause(5);}throw Error('condition did not complete');}
async function status(api,value){return until(async()=>{const rows=await api.taskList();return rows.find(task=>task.status===value);});}
const finished=()=>response({data:{status:'completed',result:{images:[{url:['https://example.com/image.png']}]}}});
const request={prompt:'恢复测试',model:'gpt-image-2',n:1,size:'1:1'};
function download(w){return {ok:true,status:200,blob:async()=>new w.Blob(['picture'],{type:'image/png'})};}

test('reload resumes an accepted task without another POST; stored tasks do not copy images or history',async()=>{
 const env=environment();try{let posts=0,polling=false;
 env.w.fetch=async(url,options)=>{if(options?.method==='POST'){posts++;assert.ok(options.headers['Idempotency-Key']);assert.equal(options.headers['X-IPZSK-User-Id'],'a');return response({data:[{task_id:'server-a'}]});}if(url.endsWith('/image/0'))return download(env.w);return polling?finished():response({data:{status:'running'}});};
 const first=env.api();await first.taskSubmit(request);await until(async()=> (await env.store.read('tasks',[]))[0]?.submissions[0].taskId);first.dispose();polling=true;
 const second=env.api();const task=await status(second,'completed');assert.equal(posts,1);assert.equal(task.result.images.length,1);assert.equal((await second.historyList()).length,1);
 const stored=(await env.store.read('tasks',[]))[0];assert.equal(stored.result,undefined);assert.equal(stored.submissions[0].image,undefined);assert.equal(stored.historyId,task.id);
 }finally{env.close();}
});
test('lost POST response recovers by the original key and never resubmits accepted work',async()=>{
 const env=environment();try{let posts=0,key;
 env.w.fetch=async(url,options)=>{if(options?.method==='POST'){posts++;key=options.headers['Idempotency-Key'];throw new TypeError('Failed to fetch');}if(url.includes('/image-requests/')){assert.ok(url.endsWith(key));return response({request_id:'server-b',task_id:'server-b',status:'running'});}if(url.endsWith('/image/0'))return download(env.w);return finished();};
 const api=env.api();await api.taskSubmit(request);const failed=await status(api,'failed');await api.taskRetry(failed.id);await status(api,'completed');assert.equal(posts,1);
 }finally{env.close();}
});
test('a missing server record retries with the same key; uncertainty never creates a new request',async()=>{
 const env=environment();try{const keys=[];let uncertain=false;
 env.w.fetch=async(url,options)=>{if(options?.method==='POST'){keys.push(options.headers['Idempotency-Key']);throw new TypeError('lost response');}assert.match(url,/image-requests/);return uncertain?response({status:'uncertain',request_id:'unknown',not_executed:false}):response({error:{code:'request_not_found'}},404);};
 const api=env.api();await api.taskSubmit(request);let failed=await status(api,'failed');await api.taskRetry(failed.id);failed=await status(api,'failed');assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);uncertain=true;
 await api.taskRetry(failed.id);failed=await status(api,'failed');assert.match(failed.error,/待核对/);assert.equal(keys.length,2);
 }finally{env.close();}
});
test('retry downloads an existing result and skips completed images in a partial batch',async()=>{
 const env=environment();try{let posts=0,allowDownload=false;const downloaded=[];
 env.w.fetch=async(url,options)=>{if(options?.method==='POST'){posts++;return response({data:[{task_id:'batch-'+posts}]});}if(url.endsWith('/image/0')){downloaded.push(url);if(url.includes('batch-2')&&!allowDownload)return {ok:false,status:502};return download(env.w);}return finished();};
 const api=env.api();await api.taskSubmit({...request,n:2});const failed=await status(api,'failed');assert.equal(posts,2);assert.ok((await env.store.read('tasks',[]))[0].submissions[0].image);allowDownload=true;
 await api.taskRetry(failed.id);const completed=await status(api,'completed');assert.equal(completed.result.images.length,2);assert.equal(posts,2);assert.equal(downloaded.filter(url=>url.includes('batch-1')).length,1);
 }finally{env.close();}
});
test('a confirmed failed image retries only that image with a fresh key',async()=>{
 const env=environment();try{const keys=[];let fail=true;
 env.w.fetch=async(url,options)=>{if(options?.method==='POST'){keys.push(options.headers['Idempotency-Key']);return response({data:[{task_id:'paid-'+keys.length}]});}if(url.endsWith('/image/0'))return download(env.w);return fail?response({data:{status:'failed',error:{message:'failed'}}}):finished();};
 const api=env.api();await api.taskSubmit(request);const failed=await status(api,'failed');fail=false;await api.taskRetry(failed.id);await status(api,'completed');assert.equal(keys.length,2);assert.notEqual(keys[0],keys[1]);
 }finally{env.close();}
});
test('account mismatch disposes the engine and preserves the original account checkpoint',async()=>{
 const env=environment();try{let changes=0;env.w.addEventListener('ipzsk-account-changed',()=>changes++);env.w.fetch=async()=>response({error:{code:'account_changed'}},409);
 const api=env.api();await api.taskSubmit(request);await until(()=>changes);assert.equal(changes,1);assert.equal((await env.w.Storage.createStorage('b').read('tasks',[])).length,0);assert.equal((await env.store.read('tasks',[])).length,1);await assert.rejects(()=>api.taskSubmit(request),/会话已结束/);
 }finally{env.close();}
});
test('cancel before execution does not submit paid work',async()=>{
 const env=environment();try{let posts=0;env.w.fetch=async()=>{posts++;throw Error('must not submit');};const api=env.api();const task=await api.taskSubmit(request);await api.taskCancel(task.id);await pause(30);assert.equal(posts,0);assert.equal((await api.taskList())[0].status,'cancelled');
 }finally{env.close();}
});
function sharedLocks(){const held=new Set();return {async request(name,_options,callback){if(held.has(name))return callback(null);held.add(name);try{return await callback({name});}finally{held.delete(name);}}};}
test('another open tab takes over after the polling tab closes without a second submission',async()=>{
 const indexedDB=new IDBFactory(),a=environment(indexedDB),b=environment(indexedDB),locks=sharedLocks();
 for(const env of [a,b])Object.defineProperty(env.w.navigator,'locks',{value:locks});
 try{let posts=0,complete=false;
 const fetcher=w=>async(url,options)=>{if(options?.method==='POST'){posts++;return response({data:[{task_id:'shared'}]});}if(url.endsWith('/image/0'))return download(w);return complete?finished():response({data:{status:'processing'}});};
 a.w.fetch=fetcher(a.w);b.w.fetch=fetcher(b.w);const first=a.api();await first.taskSubmit(request);await until(async()=> (await a.store.read('tasks',[]))[0]?.submissions[0].taskId);
 const second=b.api();await second.ready;await pause(15);first.dispose();complete=true;await status(second,'completed');assert.equal(posts,1);assert.equal((await second.historyList()).length,1);
 }finally{a.close();b.close();}
});
test('simultaneous explicit retries share one new attempt key across tabs',async()=>{
 const indexedDB=new IDBFactory(),a=environment(indexedDB),b=environment(indexedDB),locks=sharedLocks();
 for(const env of [a,b])Object.defineProperty(env.w.navigator,'locks',{value:locks});
 try{const keys=[];let fail=true;
 const fetcher=w=>async(url,options)=>{if(options?.method==='POST'){keys.push(options.headers['Idempotency-Key']);return response({data:[{task_id:'shared-'+keys.length}]});}if(url.endsWith('/image/0'))return download(w);return fail?response({data:{status:'failed'}}):finished();};
 a.w.fetch=fetcher(a.w);b.w.fetch=fetcher(b.w);const first=a.api();await first.taskSubmit(request);const failed=await status(first,'failed');const second=b.api();await second.ready;fail=false;
 await Promise.all([first.taskRetry(failed.id),second.taskRetry(failed.id)]);await status(second,'completed');assert.equal(keys.length,2);assert.notEqual(keys[0],keys[1]);assert.equal((await second.historyList()).length,1);
 }finally{a.close();b.close();}
});
test('a missing recovery endpoint does not treat an unknown 404 as an unsubmitted request',async()=>{
 const env=environment();try{let posts=0;
 env.w.fetch=async(_url,options)=>{if(options?.method==='POST'){posts++;throw new TypeError('lost response');}return response({error:'Not Found'},404);};
 const api=env.api();await api.taskSubmit(request);const failed=await status(api,'failed');await api.taskRetry(failed.id);await status(api,'failed');assert.equal(posts,1);
 }finally{env.close();}
});
