import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';

const storageBundle=await build({entryPoints:['web/storage.ts'],bundle:true,write:false,format:'iife',globalName:'StudioStorage'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function environment(factory=new IDBFactory()){
  const dom=new JSDOM('<main class="web-layout"><div id="studio"></div></main>',{url:'https://www.ipzsk.com/image.html',runScripts:'outside-only',pretendToBeVisual:true});
  dom.window.indexedDB=factory;dom.window.structuredClone=structuredClone;
  dom.window.eval(storageBundle.outputFiles[0].text);
  return dom;
}
const plain=value=>JSON.parse(JSON.stringify(value));
async function rawDatabase(factory){
  return new Promise((resolve,reject)=>{
    const request=factory.open('ipzsk-image-studio',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('records');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
async function seedLegacy(factory,entries){
  const db=await rawDatabase(factory);
  await new Promise((resolve,reject)=>{
    const tx=db.transaction('records','readwrite');
    for(const [key,value] of Object.entries(entries))tx.objectStore('records').put(value,key);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
  db.close();
}

test('private storage isolates accounts and anonymous callers cannot read legacy data or write',async()=>{
  const factory=new IDBFactory();
  await seedLegacy(factory,{history:[{id:'unclaimed',prompt:'Legacy private work'}]});
  const dom=environment(factory),{createStorage}=dom.window.StudioStorage;
  try{
    const alice=createStorage('alice'),bob=createStorage('bob'),guest=createStorage(null);
    await alice.write('history',[{id:'alice-only'}]);
    assert.deepEqual(plain(await alice.read('history',[])),[{id:'alice-only'}]);
    assert.deepEqual(plain(await bob.read('history',[])),[]);
    assert.deepEqual(plain(await guest.read('history',[])),[]);
    await assert.rejects(()=>guest.write('history',[]),/请先登录/);
    let called=false;
    await assert.rejects(()=>guest.change('history',[],()=>{called=true;return [];}),/请先登录/);
    assert.equal(called,false);
    await bob.write('history',[{id:'bob-only'}]);
    assert.deepEqual(plain(await createStorage('alice').read('history',[])),[{id:'alice-only'}]);
  }finally{dom.window.close();}
});

test('read-modify-write transactions serialize across independent tabs and roll back thrown changes',async()=>{
  const factory=new IDBFactory(),first=environment(factory),second=environment(factory);
  try{
    const a=first.window.StudioStorage.createStorage('alice');
    const b=second.window.StudioStorage.createStorage('alice');
    await Promise.all(Array.from({length:40},(_,index)=>(index%2?a:b).change('counter',0,value=>value+1)));
    assert.equal(await a.read('counter',0),40);
    await a.write('draft',{text:'saved'});
    await assert.rejects(()=>b.change('draft',{},value=>{value.text='discard';throw new Error('mutator rejected');}),/mutator rejected/);
    assert.deepEqual(plain(await a.read('draft',{})),{text:'saved'});
    await a.change('counter',0,value=>value+1);
    assert.equal(await b.read('counter',0),41);
  }finally{first.window.close();second.window.close();}
});

test('legacy import requires an explicit claim, preserves originals and tasks, and allows only one owner',async()=>{
  const factory=new IDBFactory(),legacy={
    history:[{id:'old',prompt:'Legacy image'},{id:'duplicate',prompt:'Old duplicate'}],
    gallery:[{id:'saved-image'}],canvases:[{id:'canvas'}],favorites:[{key:'favorite'}],
    tasks:[{id:'old-task',status:'running',requestIds:['accepted-task']}],
  };
  await seedLegacy(factory,legacy);
  const first=environment(factory),second=environment(factory);
  try{
    const a=first.window.StudioStorage,b=second.window.StudioStorage;
    assert.equal((await a.legacyImportStatus('alice')).available,true);
    assert.equal((await a.legacyImportStatus('alice')).pendingTasks,1);
    assert.deepEqual(plain(await a.createStorage('alice').read('history',[])),[]);
    await a.createStorage('alice').write('history',[{id:'duplicate',prompt:'Current version'},{id:'new'}]);
    const attempts=await Promise.allSettled([a.importLegacyWorks('alice'),b.importLegacyWorks('bob')]);
    assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(attempts[0].status,'fulfilled');
    assert.equal(attempts[0].value,4);
    assert.match(attempts[1].reason.message,/其他账户认领/);
    assert.equal(await a.importLegacyWorks('alice'),0);
    assert.equal((await b.legacyImportStatus('bob')).available,false);
    assert.deepEqual(plain(await a.createStorage('alice').read('history',[])),[{id:'duplicate',prompt:'Current version'},{id:'new'},{id:'old',prompt:'Legacy image'}]);
    assert.deepEqual(plain(await a.createStorage('alice').read('tasks',[])),[]);
    assert.deepEqual(plain(await b.createStorage('bob').read('gallery',[])),[]);
    const db=await rawDatabase(factory);
    const originals=await new Promise((resolve,reject)=>{
      const tx=db.transaction('records'),values={};
      for(const key of Object.keys(legacy)){
        const request=tx.objectStore('records').get(key);request.onsuccess=()=>{values[key]=request.result;};
      }
      tx.oncomplete=()=>resolve(values);tx.onerror=()=>reject(tx.error);
    });
    assert.deepEqual(plain(originals),legacy);db.close();
  }finally{first.window.close();second.window.close();}
});

const mainBundle=await build({
  entryPoints:['web/main.tsx'],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'empty'},
  define:{'process.env.NODE_ENV':'"production"'},
  plugins:[{name:'identity-fixtures',setup(builder){
    builder.onResolve({filter:/^(\.\/api|\.\/storage|\.\.\/vendor\/src\/client\/ImageGenPanel)$/},args=>({path:args.path,namespace:'identity-fixture'}));
    builder.onLoad({filter:/.*/,namespace:'identity-fixture'},args=>{
      if(args.path==='./api')return {contents:'export class WebImageApi {constructor(userId){this.userId=userId;this.disposeCount=0;window.__apis.push(this)} dispose(){this.disposeCount++}}'};
      if(args.path==='./storage')return {contents:'export async function legacyImportStatus(){return {available:false,count:0,pendingTasks:0}};export async function importLegacyWorks(){return 0}'};
      return {contents:`import React,{useState} from 'react';export function ImageGenPanel({api}){const [preview,setPreview]=useState('empty');return <button data-owner={api.userId??'anonymous'} data-preview={preview} onClick={()=>setPreview('private upload')}>{api.userId??'anonymous'}</button>}`,loader:'jsx',resolveDir:process.cwd()};
    });
  }}],
});
async function eventually(predicate){
  for(let index=0;index<100;index++){if(predicate())return;await pause(5);}
  assert.ok(predicate(),'expected lifecycle state was not reached');
}
test('identity refresh disposes old engines and clears private UI across account changes and page restoration',async()=>{
  const dom=environment(),w=dom.window;w.__apis=[];
  let user='alice',pendingProfile=null,networkFailure=false;
  w.fetch=async()=>{
    if(networkFailure)throw new Error('offline');
    if(pendingProfile)return pendingProfile;
    return user?{ok:true,status:200,json:async()=>({user:{id:user}})}:{ok:false,status:401};
  };
  try{
    w.eval(mainBundle.outputFiles[0].text);
    await eventually(()=>w.document.querySelector('[data-owner="alice"]'));
    const alice=w.__apis.find(api=>api.userId==='alice');
    w.document.querySelector('[data-owner="alice"]').click();
    await eventually(()=>w.document.querySelector('[data-preview="private upload"]'));
    user='bob';w.dispatchEvent(new w.Event('focus'));
    await eventually(()=>w.document.querySelector('[data-owner="bob"]'));
    assert.equal(alice.disposeCount,1);
    assert.equal(w.document.querySelector('[data-owner="bob"]').dataset.preview,'empty');
    assert.equal(w.document.querySelector('[data-owner="alice"]'),null);
    const bob=w.__apis.find(api=>api.userId==='bob');
    const count=w.__apis.length;
    networkFailure=true;w.dispatchEvent(new w.Event('focus'));await pause(15);
    assert.equal(w.__apis.length,count);assert.equal(bob.disposeCount,0);
    networkFailure=false;
    let resolveProfile;
    pendingProfile=new Promise(resolve=>{resolveProfile=resolve;});
    w.dispatchEvent(new w.Event('ipzsk-account-changed'));
    assert.equal(bob.disposeCount,1);
    await eventually(()=>w.document.querySelector('[data-owner="anonymous"]'));
    resolveProfile({ok:false,status:401});pendingProfile=null;user=null;
    await pause(15);
    const guest=w.__apis.at(-1);
    w.dispatchEvent(new w.Event('pagehide'));
    assert.equal(guest.disposeCount,1);
    await eventually(()=>w.document.querySelector('#studio').childElementCount===0);
    user='carol';w.dispatchEvent(new w.Event('pageshow'));
    await eventually(()=>w.document.querySelector('[data-owner="carol"]'));
  }finally{w.dispatchEvent(new w.Event('pagehide'));await pause(5);w.close();}
});
