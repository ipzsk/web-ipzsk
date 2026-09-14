const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('../image-studio/node_modules/jsdom');
const html=fs.readFileSync(path.join(__dirname,'../video.html'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../video.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(generate){
  const dom=new JSDOM(html,{url:'https://www.ipzsk.com/video',runScripts:'outside-only'});
  const w=dom.window;
  w.fetch=async(url,options)=>{
    if(url.endsWith('/profile'))return {ok:true,json:async()=>({user:{id:'user-1',email_verified:true}})};
    if(url.endsWith('/bootstrap'))return {ok:true,json:async()=>({token:'mock',video_models:[{id:'seedance-2.0-mini',params:[]}]})};
    return generate(url,options);
  };
  w.eval(script);
  return dom;
}
test('active generation disables repeat submissions and completed result restores submit',async()=>{
  let requests=0;
  const dom=setup(async()=>{requests++;return {ok:true,json:async()=>({data:[{task_id:'123e4567-e89b-42d3-a456-426614174000'}]})};});
  try{
    await tick();const w=dom.window;
    w.document.querySelector('#prompt').value='cat';
    await w.eval('submit()');await w.eval('submit()');
    assert.equal(requests,1);assert.equal(w.document.querySelector('#generate').disabled,true);
    w.eval('renderTask({status:"completed",result:{videos:[{url:["https://example.com/video.mp4"]}]}})');
    assert.equal(w.document.querySelector('#generate').disabled,false);
    assert.equal(w.document.querySelector('#video-result').hidden,false);
  }finally{dom.window.close();}
});
test('uncertain submission reuses its idempotency key on retry',async()=>{
  const keys=[];
  const dom=setup(async(url,options)=>{keys.push(options.headers['Idempotency-Key']);throw new Error('network unavailable');});
  try{
    await tick();dom.window.document.querySelector('#prompt').value='cat';
    await dom.window.eval('submit()');await dom.window.eval('submit()');
    assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
  }finally{dom.window.close();}
});
