const TOKEN=/^Bearer ipz_[A-Za-z0-9_-]{43}$/;
const TASK=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(res,status,error){res.setHeader('Cache-Control','no-store');return res.status(status).json({error:{code:error,message:error}});}

module.exports=async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return fail(res,405,'method_not_allowed');}
  const authorization=req.headers?.authorization;
  if(typeof authorization!=='string'||!TOKEN.test(authorization))return fail(res,401,'invalid_api_token');
  const taskId=Array.isArray(req.query?.task_id)?req.query.task_id[0]:req.query?.task_id;
  if(typeof taskId!=='string'||!TASK.test(taskId))return fail(res,400,'invalid_task_id');
  try{
    const base=(process.env.IPZSK_API_BASE_URL||'https://api.ipzsk.com').replace(/\/$/,'');
    const response=await fetch(base+'/v1/tasks/'+encodeURIComponent(taskId),{headers:{Authorization:authorization},signal:AbortSignal.timeout(18000)});
    const text=await response.text();res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',response.headers.get('content-type')||'application/json; charset=utf-8');return res.status(response.status).send(text);
  }catch(error){return fail(res,502,error?.name==='TimeoutError'?'gateway_timeout':'gateway_unavailable');}
};
module.exports.config={maxDuration:30};
