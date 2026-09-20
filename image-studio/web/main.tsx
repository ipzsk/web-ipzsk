import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ImageGenPanel} from '../vendor/src/client/ImageGenPanel';
import {WebImageApi} from './api';
import {scope} from './settings';
import {legacyImportStatus,importLegacyWorks} from './storage';
import './theme.css';
function StudioApp({api,userId}:{api:WebImageApi;userId:string|null}){
  const [legacy,setLegacy]=useState({available:false,count:0,pendingTasks:0});
  const [importing,setImporting]=useState(false);
  const [importMessage,setImportMessage]=useState('');
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    document.querySelector('.web-layout')?.classList.add('web-layout-advanced');
    return ()=>document.querySelector('.web-layout')?.classList.remove('web-layout-advanced');
  },[]);
  useEffect(()=>{
    let disposed=false;
    void legacyImportStatus(userId).then(value=>{if(!disposed)setLegacy(value);}).catch(()=>{});
    return ()=>{disposed=true;};
  },[userId]);
  async function importWorks(){
    if(!userId||importing)return;
    setImporting(true);setImportMessage('');
    try{
      const count=await importLegacyWorks(userId);
      setLegacy(value=>({...value,available:false}));
      setImportMessage(`已导入 ${count} 条旧作品记录。旧任务请到个人中心核对。`);
      setRevision(value=>value+1);
    }catch(error){setImportMessage(error instanceof Error?error.message:'暂时无法导入，请稍后重试。');}
    finally{setImporting(false);}
  }
  return <div className="web-advanced">
    {legacy.available&&<aside className="web-advanced-nav" aria-label="导入旧作品">
      <span>本浏览器有 {legacy.count} 条旧作品记录，尚未关联账户。仅在这些作品属于你时导入当前账户。原记录会保留，旧任务请到个人中心核对，不会自动重新生成。</span>
      <button className="web-button" disabled={importing} onClick={()=>void importWorks()}>{importing?'正在导入…':'确认这些作品属于我并导入'}</button>
    </aside>}
    {!legacy.available&&legacy.pendingTasks>0&&<aside className="web-advanced-nav"><span>本浏览器保留了 {legacy.pendingTasks} 个旧的进行中任务，请到个人中心核对结果和费用。这些任务不会自动重新生成。</span><a className="web-button" href="/account">核对旧任务</a></aside>}
    {importMessage&&<div className="web-advanced-nav" role="status"><span>{importMessage}</span></div>}
    <ImageGenPanel key={revision} api={api as any} scope={scope as any} userId={userId}/>
  </div>;
}

const root=createRoot(document.getElementById('studio')!);
let current:{userId:string|null;api:WebImageApi}|null=null;
let request:AbortController|null=null;
let requestVersion=0;
let suspended=false;
let pollTimer:number|undefined;

function setIdentity(userId:string|null){
  if(current?.userId===userId)return;
  current?.api.dispose();
  const api=new WebImageApi(userId);
  current={userId,api};
  // A different key clears uploads, previews, history and editor state together.
  root.render(<StudioApp key={userId??'anonymous'} api={api} userId={userId}/>);
}

async function refreshIdentity(){
  if(suspended)return;
  request?.abort();
  const controller=new AbortController(),version=++requestVersion;
  request=controller;
  const timeout=window.setTimeout(()=>controller.abort(),10000);
  try{
    const response=await fetch('https://api.ipzsk.com/api/me/profile',{credentials:'include',cache:'no-store',signal:controller.signal});
    if(controller.signal.aborted||version!==requestVersion||suspended)return;
    if(response.status===401){setIdentity(null);return;}
    if(!response.ok)return;
    const data=await response.json();
    if(controller.signal.aborted||version!==requestVersion||suspended)return;
    const id=data.user?.id;
    const validId=(typeof id==='string'&&id.length>0)||(typeof id==='number'&&Number.isFinite(id));
    setIdentity(validId?String(id):null);
  }catch{
    // A transient connection error does not prove that the account changed.
  }finally{
    window.clearTimeout(timeout);
    if(request===controller)request=null;
  }
}

function startPolling(){
  if(pollTimer!==undefined)return;
  pollTimer=window.setInterval(()=>{if(document.visibilityState==='visible')void refreshIdentity();},30000);
}
window.addEventListener('focus',()=>void refreshIdentity());
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refreshIdentity();});
window.addEventListener('ipzsk-account-changed',()=>{
  if(suspended)return;
  setIdentity(null);
  void refreshIdentity();
});
window.addEventListener('pagehide',()=>{
  suspended=true;++requestVersion;request?.abort();request=null;
  window.clearInterval(pollTimer);pollTimer=undefined;
  current?.api.dispose();current=null;root.render(null);
});
window.addEventListener('pageshow',()=>{
  suspended=false;setIdentity(current?.userId??null);startPolling();void refreshIdentity();
});
setIdentity(null);startPolling();void refreshIdentity();
