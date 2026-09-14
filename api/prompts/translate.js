// The shipped catalog already contains Chinese prompts; no runtime paid translation.
module.exports=(_req,res)=>res.status(410).json({error:'提示词已预先中文化，请刷新图片工作台。'});
