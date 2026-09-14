import {useEffect, useRef, useState, type FormEvent} from 'react';
import type {WebImageApi} from './api';
import {IMAGE_MODELS} from './settings';
import {REFERENCE_MAX_BYTES} from './upload-limits';
import {EFFECTS, buildEffectPrompt, missingEffectFields, type Effect} from './beginner-effects';
import './beginner.css';

type Photo = {dataUrl:string; name:string};
type Work = {id:string; prompt:string; model:string; createdAt:number; size?:string; quality?:string; images:{url:string}[]; billing?:{charged_points?:string|null}; request?:any};
const MODEL_NAMES:Record<string,string> = {'gpt-image-2':'GPT Image 2','gpt-image-2.5-flare':'GPT Image 2.5 Flare','gemini-3.1-flash-image-preview':'Gemini 生图'};
const running = (task:any) => task?.status === 'queued' || task?.status === 'running';
const recoverable = (task:any) => ['failed','cancelled'].includes(task?.status) && Array.isArray(task?.submissions) && task.submissions.length>0;
const uncertain = (task:any) => recoverable(task) && task.submissions.some((submission:any)=>!submission.image && ['submitting','accepted'].includes(submission.state));
const hasFailedImages = (task:any) => recoverable(task) && task.submissions.some((submission:any)=>submission.state==='failed');
const recoveryLabel = (task:any) => uncertain(task)?'继续查询原任务':hasFailedImages(task)?'重试未完成图片':'继续未完成任务';
const freeEffect = () => EFFECTS.find(effect => effect.id === 'free')!;
const billText = (billing:Work['billing']) => billing?.charged_points == null ? '点数结算中' : `本次消耗 ${Number(billing.charged_points).toLocaleString('zh-CN',{maximumFractionDigits:2})} 点`;

function readableError(error:unknown):string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Media generation failed|image generation failed/i.test(message)) return '这次图片没有生成成功。可以调整描述后重试，实际扣点请查看任务记录。';
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) return '网络连接中断，请检查网络后再试。';
  return message;
}

function fileData(file:Blob):Promise<string> {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('照片读取失败，请重新选择。'));
    reader.readAsDataURL(file);
  });
}

async function preparePhoto(file:File):Promise<Photo> {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片。');
  const dataUrl = await fileData(file);
  if (file.size <= REFERENCE_MAX_BYTES) return {dataUrl,name:file.name};
  const img = await new Promise<HTMLImageElement>((resolve,reject) => {
    const image = new Image(); image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法读取这张照片，请换一张图片。')); image.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  const scale = Math.min(1,2048/Math.max(img.naturalWidth,img.naturalHeight));
  canvas.width = Math.max(1,Math.round(img.naturalWidth*scale)); canvas.height = Math.max(1,Math.round(img.naturalHeight*scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('照片过大，请选择 3MB 以内的图片。');
  context.fillStyle = '#fff'; context.fillRect(0,0,canvas.width,canvas.height); context.drawImage(img,0,0,canvas.width,canvas.height);
  for (const quality of [.88,.72,.55]) {
    const compressed = canvas.toDataURL('image/jpeg',quality);
    if (compressed.length*.75 < REFERENCE_MAX_BYTES) return {dataUrl:compressed,name:file.name};
  }
  throw new Error('照片过大，请选择 3MB 以内的图片。');
}

function workFromHistory(entry:any):Work {
  return {...entry,request:entry.mode === 'text' ? {mode:'text',model:entry.model,prompt:entry.prompt,n:1,size:entry.size || '1:1',quality:entry.quality || 'auto'} : undefined};
}

export function BeginnerStudio({api,onAdvanced}:{api:WebImageApi;onAdvanced:()=>void}) {
  const [page,setPage] = useState<'create'|'history'>('create');
  const [effect,setEffect] = useState<Effect|null>(null);
  const [more,setMore] = useState(false);
  const [values,setValues] = useState<Record<string,string>>({});
  const [photo,setPhoto] = useState<Photo|null>(null);
  const [uploading,setUploading] = useState(false);
  const [model,setModel] = useState(IMAGE_MODELS[0]);
  const [size,setSize] = useState('1:1');
  const [quality,setQuality] = useState('auto');
  const [override,setOverride] = useState<string|null>(null);
  const [showPrompt,setShowPrompt] = useState(false);
  const [editing,setEditing] = useState(false);
  const [editText,setEditText] = useState('');
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [submitting,setSubmitting] = useState(false);
  const [task,setTask] = useState<any>(null);
  const [recoveryTask,setRecoveryTask] = useState<any>(null);
  const [activeId,setActiveId] = useState<string|null>(null);
  const [work,setWork] = useState<Work|null>(null);
  const [imageIndex,setImageIndex] = useState(0);
  const [history,setHistory] = useState<Work[]>([]);
  const [historyLoaded,setHistoryLoaded] = useState(false);
  const [now,setNow] = useState(Date.now());
  const locked = useRef(false);
  const uploadVersion = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const editInput = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const busy = submitting || running(task);
  const prompt = override ?? (effect ? buildEffectPrompt(effect,values) : '');
  const elapsed = Math.max(0,Math.floor((now-(task?.startedAt || task?.createdAt || now))/1000));
  const imageUrl = work?.images[imageIndex]?.url || '';
  const extension = imageUrl.startsWith('data:image/jpeg') ? 'jpg' : imageUrl.startsWith('data:image/webp') ? 'webp' : 'png';

  useEffect(() => {
    let disposed = false;
    Promise.all([api.historyList(),api.taskList()]).then(([entries,tasks]) => {
      if (disposed) return;
      setHistory((entries as any[]).map(workFromHistory)); setHistoryLoaded(true);
      const pending = tasks.find(running);
      const previous = tasks.find(recoverable);
      if (previous) {
        setRecoveryTask(previous);
        if (!pending) {setTask(previous);setEffect(freeEffect());setValues({description:previous.request?.prompt||''});setModel(previous.request?.model||IMAGE_MODELS[0]);}
      }
      if (pending) {locked.current = true;setTask(pending);setActiveId(pending.id);setEffect(freeEffect());}
    }).catch(caught => {if (!disposed) {setError(readableError(caught));setHistoryLoaded(true);}});
    return () => {disposed = true;};
  },[api]);

  useEffect(() => {
    if (!activeId) return;
    let disposed = false;
    let timer:ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const tasks = await api.taskList();
        if (disposed) return;
        const current = tasks.find(item => item.id === activeId);
        if (!current) throw new Error('任务记录暂时无法读取，请在“我的作品”中查看结果。');
        setTask(current);setNow(Date.now());
        if (running(current)) {timer = setTimeout(poll,1000);return;}
        if (current.status === 'completed' && current.result?.images?.length) {
          const entry = current.result.history?.[0];
          setWork({id:entry?.id || current.id,prompt:current.request.prompt,model:current.request.model,createdAt:current.finishedAt || Date.now(),images:current.result.images.map((image:any)=>({url:`data:${image.mime};base64,${image.b64}`})),billing:current.billing,request:{...current.request,n:1}});
          setImageIndex(0);
          setEditing(false);setEditText('');setError('');
          setRecoveryTask(previous=>previous?.id===current.id?null:previous);
        } else if (current.status === 'completed') {
          setNotice('任务已完成，本浏览器没有保留图片文件，请到个人中心核对记录。');
          setRecoveryTask(previous=>previous?.id===current.id?null:previous);
        } else {
          setError(readableError(current.error || '这次生成已停止，请查看任务状态。'));
          if (recoverable(current)) setRecoveryTask(current);
        }
        try {
          const entries = await api.historyList();
          if (!disposed) setHistory((entries as any[]).map(workFromHistory));
        } catch {if (!disposed) setNotice('作品列表暂时读取失败，请先下载当前图片。');}
        if (!disposed) {locked.current = false;setActiveId(null);}
      } catch (caught) {
        if (!disposed) {setError(readableError(caught));timer = setTimeout(poll,3000);}
      }
    };
    void poll();
    return () => {disposed = true;clearTimeout(timer);};
  },[activeId,api]);

  useEffect(() => {
    if (!busy) return;
    if (window.matchMedia('(max-width: 900px)').matches) previewRef.current?.scrollIntoView({block:'start'});
  },[busy]);

  function chooseEffect(next:Effect) {
    if (locked.current || uploading) return;
    uploadVersion.current++;setEffect(next);setValues({});setPhoto(null);setModel(IMAGE_MODELS[0]);setSize(next.size);setQuality('auto');
    setOverride(null);setShowPrompt(false);setWork(null);setTask(null);setEditing(false);setError('');setNotice('');setPage('create');
    requestAnimationFrame(()=>heading.current?.focus());
  }

  async function upload(file?:File) {
    if (!file) return;
    const version = ++uploadVersion.current;setUploading(true);setError('');
    try {const value = await preparePhoto(file);if (version === uploadVersion.current) setPhoto(value);}
    catch (caught) {if (version === uploadVersion.current) setError(readableError(caught));}
    finally {if (version === uploadVersion.current) setUploading(false);}
  }

  async function submit(request:any) {
    if (locked.current || uploading) return;
    if (uncertain(recoveryTask)) {await resumeTask();return;}
    locked.current = true;setSubmitting(true);setError('');setNotice('');setPage('create');
    try {
      const submitted = await api.taskSubmit({...request,n:1});
      setTask(submitted);setActiveId(submitted.id);
    } catch (caught) {locked.current = false;setError(readableError(caught));}
    finally {setSubmitting(false);}
  }

  function generate(event:FormEvent) {
    event.preventDefault();
    if (!effect || locked.current) return;
    if (uncertain(recoveryTask)) {void resumeTask();return;}
    const missing = missingEffectFields(effect,values,!!photo);
    if (missing.length) {setError(`请先填写或上传：${missing.join('、')}`);return;}
    if (!prompt.trim()) {setError('请填写想生成的画面。');return;}
    void submit({mode:photo?'edit':'text',model,prompt,size,quality,...(photo?{image:photo.dataUrl}:{})});
  }

  async function resumeTask() {
    if (!recoveryTask || locked.current || uploading) return;
    locked.current=true;setSubmitting(true);setError('');setNotice('');setPage('create');
    setEffect(freeEffect());setValues({description:recoveryTask.request?.prompt||''});setOverride(null);
    try {
      const resumed=await api.taskRetry(recoveryTask.id);
      setTask(resumed);setActiveId(resumed.id);setRecoveryTask(null);
    } catch (caught) {locked.current=false;setError(readableError(caught));}
    finally {setSubmitting(false);}
  }

  async function editImage(event:FormEvent) {
    event.preventDefault();
    if (!work || locked.current) return;
    if (!editText.trim()) {setError('写一句你想修改的内容，例如“背景换成蓝色”。');return;}
    locked.current = true;setUploading(true);setSubmitting(true);setError('');
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error('原图读取失败，请重新打开这张作品。');
      const blob = await response.blob();
      const reference = await preparePhoto(new File([blob],'上一张图片',{type:blob.type || 'image/png'}));
      // The reference is ready before submit takes the generation lock.
      setUploading(false);
      const submitted = await api.taskSubmit({mode:'edit',model:work.model || IMAGE_MODELS[0],prompt:`基于参考图片进行修改：${editText.trim()}。保留未要求修改的主体、构图和其他细节。`,n:1,size:work.request?.size || work.size || 'auto',quality:work.request?.quality || work.quality || 'auto',image:reference.dataUrl});
      setTask(submitted);setActiveId(submitted.id);
    } catch (caught) {locked.current = false;setError(readableError(caught));}
    finally {setUploading(false);setSubmitting(false);}
  }

  function remake() {
    if (!work || busy) return;
    if (work.request) {void submit(work.request);return;}
    setEffect(freeEffect());setValues({description:work.prompt});setOverride(null);setPhoto(null);setSize(work.size || 'auto');setModel(work.model || IMAGE_MODELS[0]);setQuality(work.quality || 'auto');setWork(null);setTask(null);setEditing(false);
    setNotice('已填入原来的描述。原参考照片没有保存在作品中，请重新上传后生成。');
  }

  function openWork(entry:Work) {
    if (busy) return;
    setImageIndex(0);
    setWork(entry);setPage('create');setEffect(freeEffect());setValues({description:entry.prompt});setOverride(null);setPhoto(null);setModel(entry.model || IMAGE_MODELS[0]);setSize(entry.request?.size || entry.size || 'auto');setQuality(entry.request?.quality || entry.quality || 'auto');setTask(null);setError('');setNotice('');setEditing(false);
  }

  const showResults = !!work && !busy;
  return <div className="easy-studio" data-beginner-studio>
    <nav className="easy-nav" aria-label="图片工作台导航">
      <div className="easy-tabs">
        <button type="button" aria-current={page==='create'?'page':undefined} onClick={()=>setPage('create')}>开始创作</button>
        <button type="button" aria-current={page==='history'?'page':undefined} onClick={()=>setPage('history')}>我的作品 <span className="easy-history-count">{history.length}</span></button>
      </div>
      <button type="button" className="easy-secondary" disabled={busy || uploading} onClick={onAdvanced}>更多工具</button>
    </nav>

    {recoveryTask && !busy && <section className="easy-toast" aria-label="未完成任务">
      <p>{uncertain(recoveryTask)?'上次提交的结果尚未确认，可以继续查询原任务。':hasFailedImages(recoveryTask)?'上次任务有图片未能生成，可重试未完成的图片。':'上次等待已停止，可以继续未完成的任务。'}{hasFailedImages(recoveryTask)?'已完成的图片会保留；重新生成未完成图片会按实际消耗扣点。':'已提交的图片会沿用原任务，不会重复提交。'}</p>
      <button type="button" className="easy-secondary" disabled={uploading} onClick={()=>void resumeTask()}>{recoveryLabel(recoveryTask)}</button>
    </section>}

    {page==='history' ? <>
      <header className="easy-hero"><p className="eyebrow">我的作品</p><h1>每一次灵感，都留在这里。</h1><p>作品保存在当前浏览器。点开图片，可以下载或继续修改。</p></header>
      {history.length ? <div className="easy-history">{history.map(entry=><button type="button" key={entry.id} disabled={busy} onClick={()=>openWork(entry)} aria-label={`查看作品：${entry.prompt.slice(0,30)}`}>
        <img src={entry.images[0]?.url} alt="已生成的作品" loading="lazy"/><strong>{entry.prompt.replace(/^#+\s*/,'').slice(0,44)}</strong><small>{MODEL_NAMES[entry.model] || entry.model} · {billText(entry.billing)}</small>
      </button>)}</div> : <div className="easy-empty"><h2>{historyLoaded?'第一张作品，等你来创作':'正在读取作品…'}</h2><p>选一个喜欢的效果，就可以开始。</p><button type="button" className="easy-primary" onClick={()=>setPage('create')}>去创作</button></div>}
      {busy && <p className="easy-cost" role="status">图片正在生成中，可以返回“开始创作”查看进度。</p>}
    </> : !effect ? <>
      <header className="easy-hero"><p className="eyebrow">灵感，从这里开始</p><h1>你想做一张什么图？</h1><p>选一个喜欢的效果，剩下的交给我们。</p><div className="easy-steps"><span>01 选效果</span><span>02 填内容</span><span>03 生成图片</span></div></header>
      <div className="easy-effects">{(more?EFFECTS:EFFECTS.slice(0,4)).map(item=><button type="button" className="easy-effect" key={item.id} onClick={()=>chooseEffect(item)}>
        {item.image?<img src={item.image} alt={`${item.title}效果示例`} loading="lazy"/>:<div className="easy-free-art" aria-hidden="true"><span>✦</span><span>把想象<br/>变成画面</span></div>}
        <strong>{item.title}</strong><span>{item.description}</span><span className="easy-card-action">{item.id==='free'?'开始描述':'做同款'} <span aria-hidden="true">↗</span></span>
      </button>)}</div>
      <div className="easy-more"><button type="button" className="easy-secondary" aria-expanded={more} onClick={()=>setMore(!more)}>{more?'收起更多风格':'看看更多风格'} <span aria-hidden="true">{more?'−':'＋'}</span></button></div>
    </> : <>
      <div className="easy-form-heading"><button type="button" className="easy-back" disabled={busy || uploading} onClick={()=>{setEffect(null);setWork(null);setError('');setNotice('');}}>← 换个效果</button><span>选效果 <span aria-hidden="true">/</span> 填内容 <span aria-hidden="true">/</span> 生成图片</span></div>
      <div className="easy-workbench">
        <form className="easy-form" onSubmit={generate}>
          <h1 ref={heading} tabIndex={-1}>{effect.title}</h1><p>{effect.description}</p>
          <fieldset disabled={busy || uploading}>
            {(effect.requiresPhoto || photo) && <div className="easy-field"><label>{effect.requiresPhoto?'上传你的照片':'参考图片'}</label><div className="easy-upload">
              {photo ? <><img src={photo.dataUrl} alt="已选择的参考照片"/><small>{photo.name}</small><button type="button" onClick={()=>{setPhoto(null);if(fileInput.current)fileInput.current.value='';}}>移除照片</button></> : <button type="button" onClick={()=>fileInput.current?.click()}><span aria-hidden="true">＋</span><strong>上传照片</strong><small>JPG、PNG、WebP · 大图会自动压缩</small></button>}
            </div></div>}
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden aria-label="上传参考照片" onChange={event=>{void upload(event.target.files?.[0]);event.target.value='';}}/>
            {effect.fields.map(field=><div className="easy-field" key={field.key}><label htmlFor={`easy-${field.key}`}>{field.label}{!field.required && <small>选填</small>}</label>
              {field.key==='title' || field.key==='subject' ? <input id={`easy-${field.key}`} value={values[field.key] || ''} placeholder={field.placeholder} maxLength={300} required={field.required} onChange={event=>{setValues({...values,[field.key]:event.target.value});setOverride(null);}}/> : <textarea id={`easy-${field.key}`} value={values[field.key] || ''} rows={field.key==='description'?6:3} placeholder={field.placeholder} maxLength={20000} required={field.required} onChange={event=>{setValues({...values,[field.key]:event.target.value});setOverride(null);}}/>}
            </div>)}
            {!effect.requiresPhoto && !photo && <button type="button" className="easy-reference" onClick={()=>fileInput.current?.click()}>＋ 添加参考图 <small>选填</small></button>}
            {uploading && <p role="status" className="easy-cost">正在处理图片…</p>}
            {error && <div role="alert" className="easy-error">{error}{/登录|点数不足/.test(error) && <a href="/account.html">前往个人中心</a>}{task?.billing && <small>{billText(task.billing)}</small>}</div>}
            <button className="easy-submit" type={uncertain(recoveryTask)?'button':'submit'} onClick={uncertain(recoveryTask)?()=>void resumeTask():undefined} disabled={busy || uploading}>{busy?'图片生成中…':uncertain(recoveryTask)?'继续查询原任务':'生成图片'} <span aria-hidden="true">✦</span></button>
            <p className="easy-cost">每次生成 1 张 · 按实际消耗扣点<br/>完成后显示本次扣点，余额同步更新。</p>
            {notice && <p role="status" className="easy-toast">{notice}</p>}
            {effect.id!=='free' && <details className="easy-details" open={showPrompt} onToggle={event=>setShowPrompt(event.currentTarget.open)}><summary>查看提示词</summary><p>已根据你的内容整理，可复制或直接修改。修改上方内容后会重新整理。</p><textarea aria-label="完整提示词" rows={8} value={prompt} onChange={event=>setOverride(event.target.value)}/><div className="easy-prompt-actions"><button type="button" onClick={()=>{navigator.clipboard.writeText(prompt).then(()=>setNotice('提示词已复制')).catch(()=>setNotice('复制失败，请选中文字后手动复制。'));}}>复制提示词</button>{override!==null && <button type="button" onClick={()=>setOverride(null)}>恢复自动整理</button>}</div></details>}
            <details className="easy-details"><summary>更多设置 <span>默认已选好</span></summary><div className="easy-settings">
              <label>生图模型<select aria-label="生图模型" value={model} onChange={event=>setModel(event.target.value)}>{IMAGE_MODELS.map(id=><option key={id} value={id}>{MODEL_NAMES[id]}</option>)}</select></label>
              <label>图片比例<select aria-label="图片比例" value={size} onChange={event=>setSize(event.target.value)}>{[['1:1','方形 1:1'],['3:4','竖版 3:4'],['4:3','横版 4:3'],['16:9','宽屏 16:9'],['9:16','竖屏 9:16'],['auto','自动']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
              <label>清晰度<select aria-label="清晰度" value={quality} onChange={event=>setQuality(event.target.value)}><option value="auto">标准（推荐）</option><option value="2k">2K</option><option value="4k">4K</option></select></label>
            </div></details>
          </fieldset>
        </form>
        <section ref={previewRef} className="easy-preview" aria-label="图片预览和生成结果">
          {busy ? <div className="easy-progress" role="status" aria-live="polite"><div className="easy-spinner" aria-hidden="true"/><h2>{task?.status==='queued'?'正在排队，很快就好':'正在把你的想法画出来'}</h2><p>已等待 {elapsed} 秒</p><small>已提交的任务会继续生成。刷新或重新打开本页后可恢复进度，无需重复提交。</small></div> : showResults ? <div className="easy-result">
            <img src={imageUrl} alt="本次生成的图片"/>
            {work!.images.length>1 && <div className="easy-image-tabs" aria-label="选择作品中的图片">{work!.images.map((image,index)=><button type="button" key={index} aria-pressed={imageIndex===index} aria-label={`第 ${index+1} 张图片`} onClick={()=>setImageIndex(index)}><img src={image.url} alt=""/></button>)}</div>}
            <div className="easy-result-meta"><span>{MODEL_NAMES[work!.model] || work!.model}</span><strong>{billText(work!.billing)}</strong></div>
            <div className="easy-result-actions"><a className="easy-primary" href={imageUrl} download={`IPZSK-${work!.id}-${imageIndex+1}.${extension}`}>下载图片</a><button type="button" className="easy-secondary" disabled={uploading} onClick={()=>{setEditing(!editing);setError('');requestAnimationFrame(()=>editInput.current?.focus());}}>修改这张图</button><button type="button" className="easy-secondary" disabled={uploading} onClick={remake}>{work!.request?'再生成一张':'重新制作'}</button></div>
            {editing && <form className="easy-edit-panel" onSubmit={editImage}><label htmlFor="easy-edit">哪里想改一改？</label><textarea ref={editInput} id="easy-edit" rows={3} placeholder="例如：背景换成浅蓝色，其他保持不变" value={editText} onChange={event=>setEditText(event.target.value)} disabled={uploading} required maxLength={2000}/><button className="easy-primary" type="submit" disabled={uploading}>{uploading?'正在准备图片…':'按这个要求修改'}</button><small>会生成一张新图，并按实际消耗扣点。</small></form>}
          </div> : <div className="easy-placeholder">{effect.image?<img src={effect.image} alt={`${effect.title}效果参考`}/>:<div className="easy-free-art" aria-hidden="true"><span>✦</span></div>}<h2>{effect.image?'你的图片，也可以是这个样子':'你的想象，在这里出现'}</h2><p>{effect.image?'这是效果示例，生成的图片会替换这里。':'写下想要的画面，点击生成即可。'}</p></div>}
        </section>
      </div>
    </>}
    <footer className="easy-footer">生成的作品保存在当前浏览器 · 重要作品记得下载</footer>
  </div>;
}
