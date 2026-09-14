const assert=require('node:assert/strict');
const {afterEach,test}=require('node:test');
const generate=require('../api/videos/generations.js');
const tasks=require('../api/videos/tasks.js');
const token='Bearer ipz_'+('a'.repeat(43));

function response(){return{statusCode:200,headers:{},status(code){this.statusCode=code;return this;},setHeader(name,value){this.headers[name.toLowerCase()]=value;},json(value){this.body=value;return this;},send(value){this.body=value;return this;}};}
afterEach(()=>{delete global.fetch;delete process.env.IPZSK_API_BASE_URL;});

test('video generation requires a user token and constrained parameters',async()=>{
  let res=response();await generate({method:'POST',headers:{},body:{}},res);assert.equal(res.statusCode,401);
  res=response();await generate({method:'POST',headers:{authorization:token,'idempotency-key':'request-1'},body:{model:'seedance-2.0-mini',prompt:'cat',resolution:'1080p',duration:5}},res);assert.equal(res.statusCode,400);
});

test('video generation forwards only the supported canonical request',async()=>{
  let upstream;global.fetch=async(url,options)=>{upstream={url,options,body:JSON.parse(options.body)};return new Response('{"code":200,"data":[{"task_id":"id"}]}',{headers:{'content-type':'application/json'}});};
  const res=response();await generate({method:'POST',headers:{authorization:token,'idempotency-key':'request-2'},body:{model:'seedance-2.0-mini',prompt:'  orange cat  ',resolution:'720p',duration:8,admin:true}},res);
  assert.equal(res.statusCode,200);assert.equal(upstream.url,'https://api.ipzsk.com/v1/videos/generations');assert.deepEqual(upstream.body,{model:'seedance-2.0-mini',prompt:'orange cat',resolution:'720p',duration:8});assert.equal(upstream.options.headers.Authorization,token);assert.equal(upstream.options.headers['Idempotency-Key'],'request-2');
});

test('task polling validates the platform task id and preserves user authorization',async()=>{
  let upstream;global.fetch=async(url,options)=>{upstream={url,options};return new Response('{"code":200,"data":{"status":"processing"}}');};
  let res=response();await tasks({method:'GET',headers:{authorization:token},query:{task_id:'task_upstream'}},res);assert.equal(res.statusCode,400);
  res=response();const id='123e4567-e89b-42d3-a456-426614174000';await tasks({method:'GET',headers:{authorization:token},query:{task_id:id}},res);assert.equal(res.statusCode,200);assert.equal(upstream.url,'https://api.ipzsk.com/v1/tasks/'+id);assert.equal(upstream.options.headers.Authorization,token);
});
