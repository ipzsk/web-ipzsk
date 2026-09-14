const TOKEN=/^Bearer ipz_[A-Za-z0-9_-]{43}$/;
const MODEL=/^[a-zA-Z0-9._-]{1,128}$/;

function fail(res,status,error){res.setHeader('Cache-Control','no-store');return res.status(status).json({error:{code:error,message:error}});}

module.exports=async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return fail(res,405,'method_not_allowed');}
  const authorization=req.headers?.authorization;
  if(typeof authorization!=='string'||!TOKEN.test(authorization))return fail(res,401,'invalid_api_token');
  const body=req.body&&typeof req.body==='object'&&!Buffer.isBuffer(req.body)?req.body:{};
  if(typeof body.model!=='string'||!MODEL.test(body.model)||typeof body.prompt!=='string'||!body.prompt.trim()||body.prompt.length>32000
    ||!['480p','720p'].includes(body.resolution)||!Number.isInteger(body.duration)||body.duration<1||body.duration>10)return fail(res,400,'invalid_video_request');
  const idempotency=req.headers['idempotency-key'];
  if(typeof idempotency!=='string'||!/^[\x21-\x7e]{1,128}$/.test(idempotency))return fail(res,400,'invalid_idempotency_key');
  try{
    const base=(process.env.IPZSK_API_BASE_URL||'https://api.ipzsk.com').replace(/\/$/,'');
    const response=await fetch(base+'/v1/videos/generations',{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json','Idempotency-Key':idempotency},body:JSON.stringify({model:body.model,prompt:body.prompt.trim(),resolution:body.resolution,duration:body.duration}),signal:AbortSignal.timeout(35000)});
    const text=await response.text();res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',response.headers.get('content-type')||'application/json; charset=utf-8');return res.status(response.status).send(text);
  }catch(error){return fail(res,502,error?.name==='TimeoutError'?'gateway_timeout':'gateway_unavailable');}
};
module.exports.config={maxDuration:60};
