import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('.');
const catalog=JSON.parse(await fs.readFile('assets/catalog.json','utf8'));
const options={bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'empty'},alias:{'@deepseek-ai/dsh-client-ui-primitives':path.join(root,'web/primitives.tsx')},plugins:[{name:'settings',setup(b){b.onResolve({filter:/settings-scope\.ts$/},()=>({path:path.join(root,'web/settings.ts')}));}}],define:{'process.env.NODE_ENV':'"production"'}};
const ui=await build({...options,outfile:'/tmp/ipzsk-test-bundle.js',entryPoints:['web/main.tsx']});
const api=await build({...options,entryPoints:['web/api.ts'],globalName:'StudioApi'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function openAdvanced(w){
 const button=[...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()==='更多工具');
 assert.ok(button,'advanced tools remain accessible from the beginner workspace');button.click();await pause(100);
}
test('all 561 cases retain images and Chinese-only prompt versions',()=>{
 assert.equal(catalog.length,561);
 assert.equal(new Set(catalog.map(c=>c.id)).size,561);
 for(const item of catalog){
  assert.ok(item.image,`missing image ${item.id}`);
  assert.match(item.thumbnail,/^\/image-studio\/assets\/thumbs\/\d+\.webp$/);
  assert.match(item.category,/^[\u3400-\u9fff]+$/);
  assert.match(item.prompt,/[\u3400-\u9fff]/);
  assert.ok(!/\[(English|英文)\]/i.test(item.prompt),`bilingual original ${item.id}`);
  assert.ok(!/[a-zA-Z][a-zA-Z ,.;:'’\n-]{180}/.test(item.prompt),`untranslated paragraph ${item.id}`);
  assert.equal(item.originalPrompt,undefined);
  assert.equal(item.promptPreview,item.prompt.slice(0,160));
 }
});
function environment(){
 const dom=new JSDOM('<div data-dsh-imagegen-history-host></div><div id="studio"></div>',{url:'https://www.ipzsk.com/image.html',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;w.indexedDB=new IDBFactory();w.structuredClone=structuredClone;w.ResizeObserver=class{observe(){}disconnect(){}};w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 const NativeObserver=w.MutationObserver;const observers=[];w.MutationObserver=class extends NativeObserver{constructor(callback){super(callback);observers.push(this)}};const close=w.close.bind(w);w.close=()=>{observers.forEach(o=>o.disconnect());close()};
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.fetch=async url=>({ok:true,json:async()=>String(url).includes('/api/me/profile')?{user:{id:'test-user'}}:String(url).includes('catalog')?catalog:{translations:{544:'中文测试提示词'}}});
 return dom;
}
test('upstream studio exposes ecommerce, canvas, categorized templates and template selection',async()=>{
 const dom=environment();const w=dom.window;w.eval(ui.outputFiles[0].text);await pause(100);await openAdvanced(w);
 const click=text=>{const b=[...w.document.querySelectorAll('button')].find(b=>(b.textContent||'').trim()===text);assert.ok(b,`missing button ${text}`);b.click();};
 assert.ok(w.document.body.textContent.includes('无限画布'));
 const ecommerce=[...w.document.querySelectorAll('button')].find(b=>b.textContent.includes('电商模式'));assert.ok(ecommerce);ecommerce.click();await pause(80);
 assert.match(w.document.body.textContent,/主图/);assert.match(w.document.body.textContent,/卖点图/);assert.match(w.document.body.textContent,/场景图/);
 click('无限画布');await pause(100);assert.ok(w.document.querySelector('[data-canvas-workspace]'));
 const add=[...w.document.querySelectorAll('button')].find(b=>(b.title||b.getAttribute('aria-label')||'').includes('添加文本'));if(add){add.click();await pause(50);assert.ok(w.document.querySelector('[data-node-id]'));}
 click('普通生图');await pause(50);
 assert.match(w.document.body.textContent,/共 561 个/);
 assert.match(w.document.body.textContent,/已展示 24 \/ 561/);
 assert.equal(w.document.querySelector('a[href*="github.com"]'),null);
 assert.match(w.document.querySelector('img[src*="/thumbs/"]').closest('button').textContent,/作者：adrianpunk/);
 click('加载更多案例');await pause(60);assert.match(w.document.body.textContent,/已展示 48 \/ 561/);
 click('素材库 · 全部案例');await pause(100);
 assert.match(w.document.body.textContent,/封面与海报/);assert.match(w.document.body.textContent,/电商与产品/);
 const library=w.document.querySelector('[role="dialog"]');assert.equal(library.querySelectorAll('img').length,48);
 assert.equal(library.querySelector('[role="tablist"]'),null,'No source tabs above the category tags');
 const categoryButton=[...library.querySelectorAll('button')].find(b=>b.textContent.startsWith('电商与产品 '));assert.ok(categoryButton);categoryButton.click();await pause(30);
 assert.equal(library.querySelectorAll('img').length,catalog.filter(c=>c.category==='电商与产品').length);
 [...library.querySelectorAll('button')].find(b=>b.textContent.trim()==='全部 561').click();await pause(30);
 assert.ok([...library.querySelectorAll('img')].every(img=>img.src.includes('/thumbs/')));
 while(library.querySelectorAll('img').length<561){const more=[...library.querySelectorAll('button')].find(b=>b.textContent==='加载更多案例');assert.ok(more);more.click();await pause(20);}
 assert.equal(library.querySelectorAll('img').length,561);
 assert.equal(library.querySelector('a'),null,'Case library must not navigate to source sites');
 assert.ok([...library.querySelectorAll('img')].every(img=>img.closest('button').textContent.includes('作者：')));
 library.querySelector('img').closest('button').click();await pause(30);
 assert.equal(library.querySelector('a'),null,'Case detail author must be plain text');
 assert.match(library.textContent,/作者：adrianpunk/);
 assert.ok(!w.document.body.textContent.includes('查看原文'));
 dom.window.close();
});
test('case selection opens a spacious editor; edits save or cancel without generating',async()=>{
 const dom=environment();try{const w=dom.window;w.eval(ui.outputFiles[0].text);await pause(100);await openAdvanced(w);
 const sample=w.document.querySelector('img[src*="/thumbs/"]');assert.ok(sample);sample.closest('button').click();await pause(50);
 const dialog=w.document.querySelector('dialog[open]');assert.ok(dialog);const editor=dialog.querySelector('textarea');assert.equal(editor.value,catalog[0].prompt);
 const setValue=Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype,'value').set;
 setValue.call(editor,'一张蓝色产品海报');editor.dispatchEvent(new w.Event('input',{bubbles:true}));await pause(20);
 [...dialog.querySelectorAll('button')].find(b=>b.textContent==='保存提示词').click();await pause(30);
 assert.equal(w.document.querySelector('textarea[aria-label="提示词"]').value,'一张蓝色产品海报');assert.equal(w.document.querySelector('dialog'),null);
 [...w.document.querySelectorAll('button')].find(b=>b.textContent==='展开编辑').click();await pause(20);
 const draft=w.document.querySelector('dialog textarea');setValue.call(draft,'不要保存的修改');draft.dispatchEvent(new w.Event('input',{bubbles:true}));await pause(20);
 w.document.querySelector('dialog button[aria-label="取消编辑"]').click();await pause(20);assert.equal(w.document.querySelector('textarea[aria-label="提示词"]').value,'一张蓝色产品海报');
 }finally{dom.window.close();}
});
test('oversized references fail before submission and plain-text 413 errors are visible',async()=>{
 const dom=environment();try {const w=dom.window;w.eval(api.outputFiles[0].text);const service=new w.StudioApi.WebImageApi('test-user');await service.ready;
 let calls=0;w.fetch=async()=>{calls++;return {ok:false,status:413,json:async()=>{throw new SyntaxError('not JSON');}}};
 await assert.rejects(()=>service.taskSubmit({prompt:'测试',image:'data:image/png;base64,'+'A'.repeat(4*1024*1024+4)}),/不能超过 3MB/);
 assert.equal(calls,0);assert.equal((await service.taskList()).length,0);
 await assert.rejects(()=>service.taskSubmit({prompt:'测试',images:['data:image/png;base64,'+'A'.repeat(3*1024*1024),'data:image/png;base64,'+'A'.repeat(3*1024*1024)]}),/不能超过 3MB/);
 await service.taskSubmit({prompt:'测试',image:'data:image/png;base64,aA==',n:1,size:'1:1'});
 for(let i=0;i<100&&(await service.taskList())[0].status!=='failed';i++)await pause(10);
 assert.match((await service.taskList())[0].error,/图片过大.*不能超过 3MB/);
 w.fetch=async url=>({ok:true,json:async()=>String(url).includes('/api/me/profile')?{user:{id:'test-user'}}:catalog});w.eval(ui.outputFiles[0].text);await pause(150);await openAdvanced(w);
 const alerts=[...w.document.querySelectorAll('[role="alert"]')];assert.ok(alerts.some(el=>/图片过大.*不能超过 3MB/.test(el.textContent)));
 const failedRow=w.document.querySelector('[data-status="failed"]');assert.match(failedRow.textContent,/不能超过 3MB/);
 assert.ok(w.document.querySelector('[aria-label="生成任务"][data-open="true"]'));
 const edit=[...w.document.querySelectorAll('.web-pill')].find(el=>el.textContent.trim()==='图生图');assert.ok(edit);edit.click();await pause(50);
 const upload=[...w.document.querySelectorAll('button')].find(el=>el.textContent.includes('参考图不超过 3MB'));assert.ok(upload);
 const drop=new w.Event('drop',{bubbles:true});Object.defineProperty(drop,'dataTransfer',{value:{files:[new w.File(['x'.repeat(4*1024*1024)],'large.jpg',{type:'image/jpeg'})]}});upload.dispatchEvent(drop);await pause(30);
 assert.ok([...w.document.querySelectorAll('[role="alert"]')].some(el=>el.textContent.includes('不能超过 3MB（当前 4.00MB）')));
 } finally {dom.window.close();}
});
test('canvas and gallery persist, revision conflicts fail, tasks map references and create history',async()=>{
 const dom=environment();const w=dom.window;w.eval(api.outputFiles[0].text);const service=new w.StudioApi.WebImageApi('test-user');
 const doc=await service.canvasCreate('测试画布');doc.nodes.push({id:'n',type:'text',title:'文本',x:0,y:0,width:200,height:100,metadata:{text:'商品图'}});
 const saved=await service.canvasSave(doc,0);assert.equal(saved.revision,1);assert.equal((await service.canvasRead(doc.id)).nodes.length,1);
 await assert.rejects(()=>service.canvasSave(doc,0));
 const image={mime:'image/png',b64:'aGVsbG8='};await service.galleryAppend({prompt:'商品图',images:[image]});assert.equal((await service.galleryList()).length,1);
 const requests=[];const urls=[];w.fetch=async(url,options)=>{
   urls.push(url);
   if(url==='https://api.ipzsk.com/api/me/images/generations'){requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({data:[{task_id:'task_test'}]})};}
   if(url==='https://api.ipzsk.com/api/me/tasks/task_test')return {ok:true,json:async()=>({data:{status:'completed',result:{images:[{url:['https://getapib.org/result.png']}]}}})};
   return {ok:true,blob:async()=>new w.Blob(['image'],{type:'image/png'})};
 };
 await service.taskSubmit({mode:'edit',model:'gpt-image-2',prompt:'电商主图',n:1,size:'3:4',quality:'2k',image:'data:image/png;base64,aA==',workflow:'ecommerce',projectId:'p',slotKey:'main-1'});
 for(let i=0;i<180&&!(await service.taskList()).some(t=>t.status==='completed');i++)await pause(20);
 const task=(await service.taskList())[0];assert.equal(task.status,'completed',task.error);assert.equal(requests[0].model,'gpt-image-2');assert.equal(requests[0].quality,undefined);assert.equal(task.request.model,'gpt-image-2');assert.equal(requests[0].resolution,'2k');assert.equal(requests[0].image_urls.length,1);
 assert.ok(urls.includes('https://api.ipzsk.com/api/me/tasks/task_test/image/0'));assert.ok(!urls.some(url=>url.startsWith('https://getapib.org')));
 const history=await service.historyList();assert.equal(history[0].workflow,'ecommerce');assert.equal(history[0].projectId,'p');assert.match(history[0].images[0].url,/^data:image\/png/);
 const fresh=new w.StudioApi.WebImageApi('test-user');await fresh.ready;assert.equal((await fresh.canvasList())[0].title,'测试画布');assert.equal((await fresh.historyList()).length,1);
 w.fetch=async url=>({ok:true,json:async()=>String(url).includes('/api/me/profile')?{user:{id:'test-user'}}:catalog});w.eval(ui.outputFiles[0].text);await pause(100);await openAdvanced(w);
 const newImage=[...w.document.querySelectorAll('button')].find(b=>b.textContent==='开始新图');assert.ok(newImage);newImage.click();await pause(40);
 assert.equal(w.document.querySelector('textarea[aria-label="提示词"]').value,'');assert.ok(![...w.document.querySelectorAll('button')].some(b=>b.textContent==='开始新图'));assert.equal((await fresh.historyList()).length,1);
 dom.window.close();
});
test('all three selectable image models reach the backend without forced substitution',async()=>{
 const dom=environment(),w=dom.window;w.eval(api.outputFiles[0].text);const service=new w.StudioApi.WebImageApi('test-user');const requests=[];
 w.fetch=async(url,options)=>{
  if(url.endsWith('/images/generations')){requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({data:[{task_id:'test-'+requests.length}]})};}
  if(/\/tasks\/test-\d+$/.test(url))return {ok:true,json:async()=>({data:{status:'completed',result:{images:[{url:['https://example.com/x.png']}]}}})};
  return {ok:true,blob:async()=>new w.Blob(['image'],{type:'image/png'})};
 };
 for(const model of ['gpt-image-2.5-flare','gpt-image-2','gemini-3.1-flash-image-preview'])await service.taskSubmit({model,prompt:'test',n:1,size:'1:1',quality:'1k'});
 for(let i=0;i<300&&(await service.taskList()).some(t=>['queued','running'].includes(t.status));i++)await pause(20);
 assert.deepEqual(requests.map(r=>r.model),['gpt-image-2.5-flare','gpt-image-2','gemini-3.1-flash-image-preview']);
 assert.deepEqual(requests.map(r=>r.quality),['medium',undefined,undefined]);
 assert.ok((await service.taskList()).every(t=>t.status==='completed'));
 await assert.rejects(()=>service.taskSubmit({model:'unknown',prompt:'test'}));dom.window.close();
});
