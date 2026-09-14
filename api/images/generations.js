const gateway=require('../../lib/gateway');
module.exports=(req,res)=>req.method==='POST'?gateway(req,res,'/v1/images/generations',req.body):res.status(405).json({error:'Method not allowed'});
module.exports.config={maxDuration:120};
