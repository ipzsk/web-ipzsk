// Legacy same-origin routes accept only account-owned credentials.
module.exports = async function gateway(req,res,path,body){
  const authorization=req.headers?.authorization;
  res.setHeader('Cache-Control','no-store');
  if(typeof authorization!=='string'||!/^Bearer ipz_[A-Za-z0-9_-]{43}$/.test(authorization))return res.status(401).json({error:{code:'customer_login_required',message:'请先登录并使用充值码充值点数。'}});
  try{
    const response=await fetch('https://api.ipzsk.com'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:authorization,...(body===undefined?{}:{'Content-Type':'application/json'}),...(req.headers['idempotency-key']?{'Idempotency-Key':req.headers['idempotency-key']}:{})},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)}),signal:AbortSignal.timeout(110000),redirect:'error'});
    res.status(response.status);res.setHeader('Content-Type',response.headers.get('content-type')||'application/json');
    if(response.headers.get('x-request-id'))res.setHeader('X-Request-Id',response.headers.get('x-request-id'));
    for await(const chunk of response.body||[])res.write(Buffer.from(chunk));return res.end();
  }catch{return res.status(502).json({error:{code:'gateway_unavailable',message:'计费服务暂不可用，请稍后重试。'}});}
};
