import {IMAGE_MODELS} from './settings';
import {createStorage} from './storage';
import {REFERENCE_MAX_BYTES, REQUEST_MAX_BYTES, IMAGE_TOO_LARGE} from './upload-limits';
const API='https://api.ipzsk.com';
const uuid=()=>crypto.randomUUID();
const clone=<T,>(v:T):T=>structuredClone(v);
const imageRef=(image:any)=>({url:`data:${image.mime};base64,${image.b64}`,mime:image.mime});
class ApiError extends Error {
  constructor(message:string,public status:number,public code?:string){super(message);}
}
async function json(url:string,options?:RequestInit){
  const r=await fetch(url,{...options,credentials:url.startsWith(API)?'include':'same-origin'});
  if(r.status===413)throw new ApiError(IMAGE_TOO_LARGE,413);
  let data:any;try{data=await r.json();}catch{throw new ApiError(`服务响应异常（${r.status}），请稍后重试。`,r.status);}
  if(!r.ok){
    const code=data.error?.code;
    const message=r.status===401?'请先登录账户，再兑换充值码使用。':r.status===402?'点数不足，请到个人中心兑换充值码。':code==='account_changed'?'登录账户已变化，请在当前账户重新操作。':code==='billing_requires_priced_text_and_output_limit'?'此服务暂未开放计费，请选择已定价的模型。':typeof data.error==='string'?data.error:data.error?.message||`请求失败 (${r.status})`;
    throw new ApiError(message,r.status,code);
  }
  return data;
}
function delay(ms:number,signal:AbortSignal){return new Promise<void>((resolve,reject)=>{
  if(signal.aborted){reject(new DOMException('已停止等待','AbortError'));return;}
  const abort=()=>{clearTimeout(timer);reject(new DOMException('已停止等待','AbortError'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
  signal.addEventListener('abort',abort,{once:true});
});}
export class WebImageApi {
  catalog?:Promise<any[]>;
  tasks:any[]=[]; controllers=new Map<string,AbortController>(); active=0;
  private disposed=false;
  private workers=new Set<string>();
  private store:ReturnType<typeof createStorage>;
  ready:Promise<void>;
  constructor(private userId:string|null=null){this.store=createStorage(userId);this.ready=this.restore();}
  dispose(){this.disposed=true;for(const controller of this.controllers.values())controller.abort();}
  private requireAccount(){if(this.disposed)throw new Error('账户会话已结束，请刷新页面。');if(!this.userId)throw new Error('请先登录账户，再生成或保存作品。');}
  private async request(url:string,options:RequestInit={}){
    this.requireAccount();
    try{return await json(url,{...options,headers:{...options.headers,'X-IPZSK-User-Id':this.userId!}});}
    catch(error){if(error instanceof ApiError&&(error.status===401||error.code==='account_changed')){this.dispose();window.dispatchEvent(new Event('ipzsk-account-changed'));}throw error;}
  }
  private post(url:string,body:any,signal?:AbortSignal,key?:string){
    const serialized=JSON.stringify(body);
    if(new Blob([serialized]).size>REQUEST_MAX_BYTES)throw new Error('提交内容过大，请将参考图合计压缩至 3MB 以内，并缩短提示词后重试。');
    return this.request(url,{method:'POST',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:serialized,signal});
  }
  private async generated(url:string,signal:AbortSignal){
    this.requireAccount();
    const ownApi=url.startsWith(API+'/');
    const r=await fetch(url,{signal,credentials:ownApi?'include':'same-origin',...(ownApi?{headers:{'X-IPZSK-User-Id':this.userId!}}:{})});
    if(!r.ok){if(ownApi&&(r.status===401||r.status===409)){this.dispose();window.dispatchEvent(new Event('ipzsk-account-changed'));}throw new Error('图片暂时无法下载，可继续查询原任务。');}
    const blob=await r.blob();const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
    return {mime:blob.type||'image/png',b64:data.slice(data.indexOf(',')+1)};
  }
  private save(task:any){
    const saved=clone(task);delete saved.result;
    return this.store.change<any[]>('tasks',[],rows=>{
      const previous=rows.find(row=>row.id===saved.id);
      // A second tab cannot replace an already completed checkpoint with stale progress.
      if(previous?.status==='completed'&&saved.status!=='completed')return rows;
      if(previous?.status==='cancelled'&&!['queued','cancelled'].includes(saved.status)){task.status='cancelled';this.controllers.get(task.id)?.abort();return rows;}
      return [saved,...rows.filter(row=>row.id!==saved.id)].sort((a,b)=>b.createdAt-a.createdAt);
    });
  }
  async restore(){
    this.tasks=await this.store.read<any[]>('tasks',[]);
    for(const task of this.tasks){delete task.result;if(task.status==='running')task.status='queued';}
    if(!this.disposed)this.pump();
  }
  async taskSubmit(request:any){
    await this.ready;this.requireAccount();
    const model=request.model||IMAGE_MODELS[0];
    if(!IMAGE_MODELS.includes(model))throw new Error('请选择已支持的生图模型');
    request={...request,model};
    if(!request.prompt?.trim())throw new Error('请输入提示词');
    const references=[request.image,...(request.images||[])].filter(Boolean);
    if(model==='gemini-3.1-flash-image-preview'&&references.length>14)throw new Error('Gemini 最多支持 14 张参考图');
    const bytes=references.reduce((total:number,ref:string)=>{if(!ref.startsWith('data:'))return total;const b64=ref.slice(ref.indexOf(',')+1);return total+Math.floor(b64.length*3/4)-(b64.endsWith('==')?2:b64.endsWith('=')?1:0);},0);
    if(bytes>REFERENCE_MAX_BYTES)throw new Error(IMAGE_TOO_LARGE);
    const count=Math.min(4,Math.max(1,Math.floor(Number(request.n)||1)));
    const {image,images,...metadata}=clone(request);
    const task={...metadata,id:uuid(),request:clone(request),status:'queued',createdAt:Date.now(),submissions:Array.from({length:count},()=>({key:uuid(),state:'new'}))};
    await this.save(task);this.tasks.unshift(task);this.pump();return clone(task);
  }
  pump(){
    if(this.disposed||!this.userId)return;
    while(this.active<2){
      const task=this.tasks.find(t=>t.status==='queued'&&!this.workers.has(t.id));if(!task)break;
      task.status='running';this.active++;this.workers.add(task.id);
      const controller=new AbortController();this.controllers.set(task.id,controller);
      const execute=async()=>{
        const persisted=(await this.store.read<any[]>('tasks',[])).find(row=>row.id===task.id);
        if(controller.signal.aborted||this.disposed)return;
        if(persisted){Object.assign(task,persisted);if(['completed','failed','cancelled'].includes(task.status))return;}
        task.status='running';if(!this.disposed)await this.run(task,controller);
      };
      const work=navigator.locks?navigator.locks.request(`ipzsk:image:${this.userId}:${task.id}`,{ifAvailable:true},async lock=>{if(lock)await execute();}):execute();
      void work.catch(error=>{task.status='failed';task.error=String(error);}).finally(()=>{this.controllers.delete(task.id);this.workers.delete(task.id);this.active--;this.pump();});
    }
  }
  private async resolveSubmission(task:any,submission:any,signal:AbortSignal){
    if(submission.state==='submitting'){
      // A lost POST response is reconciled by its durable key, never by a new paid request.
      while(!submission.taskId&&!submission.url){
        let state:any;
        try{state=await this.request(API+'/api/me/image-requests/'+encodeURIComponent(submission.key),{signal});}
        catch(error){if(error instanceof ApiError&&error.status===404&&error.code==='request_not_found'){submission.state='new';break;}throw error;}
        if(state.request_id)task.requestIds=[...new Set([...(task.requestIds||[]),state.request_id])];
        if(state.task_id){submission.taskId=state.task_id;submission.state='accepted';await this.save(task);break;}
        if(state.not_executed){submission.state='failed';await this.save(task);throw new Error('上次请求未执行，可以重试。');}
        if(['failed','succeeded','uncertain'].includes(state.status))throw new Error('提交结果待核对，请到个人中心确认记录后处理；继续查询不会重复提交。');
        await delay(2000,signal);
      }
    }
    if(submission.state==='new'){
      const request=task.request;const references=[request.image,...(request.images||[])].filter(Boolean);
      submission.state='submitting';await this.save(task);
      let result:any;
      try{result=await this.post(API+'/api/me/images/generations',{model:request.model,...(request.model==='gpt-image-2.5-flare'?{quality:'medium'}:{}),prompt:request.prompt,n:1,size:request.size==='auto'?'1:1':request.size,resolution:['1k','2k','4k'].includes(request.quality)?request.quality:'1k',...(references.length?{image_urls:references}:{})},signal,submission.key);}
      catch(error){
        if(error instanceof ApiError&&error.code==='request_already_received')return this.resolveSubmission(task,submission,signal);
        // Validation/payment rejection cannot have started upstream work. Uncertain outcomes keep the original key.
        if(error instanceof ApiError&&[400,402,413,422].includes(error.status))submission.state='failed';
        throw error;
      }
      submission.taskId=result.data?.[0]?.task_id;
      submission.url=result.data?.[0]?.url||result.url;
      if(!submission.taskId&&!submission.url)throw new Error('未收到任务编号，可继续查询原请求。');
      submission.state='accepted';
      if(submission.taskId)task.requestIds=[...new Set([...(task.requestIds||[]),submission.taskId])];
      await this.save(task);
    }
  }
  private async run(task:any,controller:AbortController){
    task.startedAt??=Date.now();delete task.error;
    try{
      await this.save(task);
      for(const submission of task.submissions){
        if(submission.image)continue;
        if(controller.signal.aborted)throw new DOMException('已停止等待','AbortError');
        await this.resolveSubmission(task,submission,controller.signal);
        while(!submission.url){
          await delay(2000,controller.signal);
          const status=await this.request(API+'/api/me/tasks/'+encodeURIComponent(submission.taskId),{signal:controller.signal});
          if(status.billing){task.billings={...task.billings,[submission.taskId]:status.billing};const bills=Object.values(task.billings) as any[];task.billing={...status.billing,charged_points:bills.every(b=>b.charged_points!=null)?String(bills.reduce((sum,b)=>sum+Number(b.charged_points),0)):null};window.dispatchEvent(new Event('ipzsk-wallet-changed'));}
          if(['failed','cancelled'].includes(status.data?.status)){submission.state='failed';throw new Error(status.data?.error?.message||'图片生成失败');}
          if(status.data?.status==='completed'){const value=status.data.result?.images?.[0]?.url;submission.url=Array.isArray(value)?value[0]:value;if(!submission.url)throw new Error('任务已完成，图片结果暂不可用，可继续查询原任务。');}
          await this.save(task);
        }
        submission.image=await this.generated(submission.taskId?API+'/api/me/tasks/'+encodeURIComponent(submission.taskId)+'/image/0':submission.url,controller.signal);
        await this.save(task);
      }
      if(controller.signal.aborted)return;
      const {image,images:refs,...metadata}=task.request;
      const entry={...metadata,id:task.id,createdAt:task.createdAt,requestIds:task.requestIds,billing:task.billing,images:task.submissions.map((s:any)=>imageRef(s.image))};
      await this.store.change<any[]>('history',[],entries=>[entry,...entries.filter(e=>e.id!==task.id)]);
      task.status='completed';task.historyId=task.id;
      for(const submission of task.submissions){delete submission.image;delete submission.url;}
    }catch(error){
      if(this.disposed)return;
      if(task.status!=='cancelled'){task.status='failed';task.error=error instanceof Error?error.message:String(error);}
    }finally{
      this.controllers.delete(task.id);
      if(!this.disposed){task.finishedAt=Date.now();await this.save(task);window.dispatchEvent(new Event('ipzsk-wallet-changed'));}
    }
  }
  async taskList(){
    await this.ready;
    const stored=await this.store.read<any[]>('tasks',[]);
    this.tasks=stored.map(task=>this.workers.has(task.id)?this.tasks.find(t=>t.id===task.id)||task:task);
    for(const task of this.tasks){if(task.status==='running'&&!this.workers.has(task.id))task.status='queued';}
    this.pump();
    const history=await this.store.read<any[]>('history',[]);const byId=new Map(history.map(entry=>[entry.id,entry]));
    return this.tasks.map(task=>{const result=clone(task);const entry=byId.get(task.historyId||task.id);if(task.status==='completed')result.result={images:(entry?.images||[]).map((ref:any)=>({mime:ref.mime||'image/png',b64:ref.url.slice(ref.url.indexOf(',')+1)}))};return result;});
  }
  async taskCancel(id:string){
    await this.ready;this.requireAccount();const task=this.tasks.find(t=>t.id===id);if(!task)throw new Error('任务不存在');
    task.status='cancelled';task.error='已停止本页等待。已提交的生成会继续执行，可继续查询原任务。';this.controllers.get(id)?.abort();await this.save(task);return clone(task);
  }
  async taskRetry(id:string){
    await this.ready;this.requireAccount();await this.taskList();const task=this.tasks.find(t=>t.id===id);if(!task)throw new Error('任务不存在');
    if(['queued','running','completed'].includes(task.status))return clone(task);
    if(this.controllers.has(id))throw new Error('正在停止等待，请稍后继续查询。');
    const rows=await this.store.change<any[]>('tasks',[],stored=>stored.map(current=>{
      if(current.id!==id||['queued','running','completed'].includes(current.status))return current;
      for(const submission of current.submissions){if(submission.state==='failed')Object.assign(submission,{key:uuid(),state:'new',taskId:undefined,url:undefined,image:undefined});}
      current.status='queued';delete current.error;delete current.finishedAt;return current;
    }));
    Object.assign(task,rows.find(current=>current.id===id));this.pump();return clone(task);
  }

  historyList(){return this.store.read('history',[]);}
  historyRemove(id:string){return this.store.change<any[]>('history',[],rows=>rows.filter(r=>r.id!==id));}
  historyClear(){return this.store.write('history',[]);}
  galleryList(){return this.store.read('gallery',[]);}
  async galleryAppend(entry:any){const saved={...entry,id:uuid(),images:entry.images.map(imageRef)};const entries=await this.store.change<any[]>('gallery',[],rows=>[saved,...rows]);return {entries,added:true};}
  galleryRemove(id:string){return this.store.change<any[]>('gallery',[],rows=>rows.filter(r=>r.id!==id));}
  galleryClear(){return this.store.write('gallery',[]);}
  gallerySetTags(id:string,tags:string[]){return this.store.change<any[]>('gallery',[],rows=>rows.map(r=>r.id===id?{...r,tags}:r));}
  async canvasList(){const docs:any[]=await this.store.read('canvases',[]);return docs.map(d=>({id:d.id,title:d.title,revision:d.revision,nodeCount:d.nodes.length,createdAt:d.createdAt,updatedAt:d.updatedAt}));}
  async canvasCreate(title='未命名画布'){const document={version:2,id:uuid(),title,revision:0,viewport:{x:0,y:0,k:1},background:'dots',nodes:[],connections:[],createdAt:Date.now(),updatedAt:Date.now()};await this.store.change<any[]>('canvases',[],docs=>[document,...docs]);return clone(document);}
  async canvasRead(id:string){const docs:any[]=await this.store.read('canvases',[]);const doc=docs.find(d=>d.id===id);if(!doc)throw new Error('画布不存在');return doc;}
  async canvasSave(doc:any,revision:number){const saved={...clone(doc),revision:revision+1,updatedAt:Date.now()};await this.store.change<any[]>('canvases',[],docs=>{const old=docs.find(d=>d.id===doc.id);if(!old||old.revision!==revision)throw new Error('画布已更新，请重试');return docs.map(d=>d.id===doc.id?saved:d);});return clone(saved);}
  async canvasRemove(id:string){await this.store.change<any[]>('canvases',[],docs=>docs.filter(d=>d.id!==id));return this.canvasList();}
  async canvasUpload(dataUrl:string,width:number,height:number,meta:any={}){return {assetId:uuid(),url:dataUrl,mime:dataUrl.match(/^data:([^;]+)/)?.[1]||'image/png',bytes:Math.round(dataUrl.length*.75),width,height,origin:'upload',...meta};}
  async canvasImport(source:string,entryId:string,index:number,width:number,height:number){const rows:any[]=await this.store.read(source,[]);const ref=rows.find(r=>r.id===entryId)?.images[index];if(!ref)throw new Error('图片不存在');return this.canvasUpload(ref.url,width,height,{origin:source,entryId,imageIndex:index});}
  async templatesList(sourceId:string){this.catalog??=json('/image-studio/assets/catalog.json').catch(error=>{this.catalog=undefined;throw error;});const data=await this.catalog;const cases=data.filter((c:any)=>sourceId==='ipzsk'||c.librarySource===sourceId);return {sourceId,cases,total:cases.length,origin:'bundled',repository:'https://github.com/JayceHuang/dsh-imagegen',fetchedAt:'2026-09-08'};}
  async templatesRefresh(sourceId:string){return this.templatesList(sourceId);}
  async templatesSample(count:number){const {cases}=await this.templatesList('ipzsk');return [...cases].sort(()=>Math.random()-.5).slice(0,count).map(c=>({sourceId:'ipzsk',case:c}));}
  async favoritesList(){const rows:any[]=await this.store.read('favorites',[]);if(!rows.length)return rows;const {cases}=await this.templatesList('ipzsk');const byId=new Map(cases.map((c:any)=>[c.id,c]));return rows.map(row=>({...row,case:byId.get(row.case.id)||row.case}));}
  favoritesAdd(sourceId:string,item:any){const key=`${sourceId}:${item.id}`;return this.store.change<any[]>('favorites',[],rows=>[{key,sourceId,savedAt:new Date().toISOString(),case:item},...rows.filter(r=>r.key!==key)]);}
  favoritesRemove(key:string){return this.store.change<any[]>('favorites',[],rows=>rows.filter(r=>r.key!==key));}
  async enhancePrompt(prompt:string){return (await this.post(API+'/api/me/image-prompt',{prompt})).prompt;}
  async updateCheck(){return {currentVersion:'1.7.0',latestVersion:'1.7.0',updateAvailable:false};}
}
