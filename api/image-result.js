const gateway=require('../lib/gateway');
module.exports=(req,res)=>{
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const id=req.query?.task_id;if(typeof id!=='string'||!/^[-a-f0-9]{36}$/i.test(id))return res.status(400).json({error:'无效的任务编号'});
  return gateway(req,res,'/v1/tasks/'+id+'/image/0');
};
