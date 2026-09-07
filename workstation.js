const tools=[
 ['📄','文档四件套','knowledge','直接使用','生成和编辑 Word、Excel、PPT、PDF，配套本地文档运行环境。'],
 ['📚','文档读取与知识检索','knowledge','直接使用','从笔记、表格、演示文稿和 PDF 中提取内容，带着来源回答问题。'],
 ['🌱','AI 成长档案','knowledge','直接使用','记录偏好、项目进度和经过验证的方法，让后续对话接得上。'],
 ['🔧','技能创建','knowledge','直接使用','把反复使用的工作流程整理成自己的 Skill。'],
 ['🎨','图片生成与编辑','creation','需要模型额度','描述画面生成图片，也可传入参考图片调整风格、场景和构图。'],
 ['▥','PPT 制作与风格图册','creation','随包工具','从内容大纲到可编辑演示文稿，附带风格与版式参考。'],
 ['✍','新媒体 AI 员工','creation','随包工具','策划、内容、制作三个角色配合，完成选题、写稿和视觉物料。'],
 ['📰','新媒体排版工具','creation','随包工具','公众号排版、图片整理和社交内容设计，包含源码和参考资料。'],
 ['◈','网页设计套件','creation','随包工具','从设计方向、页面结构和文案，到网页实现与自检。'],
 ['⌘','HTML 页面生成','creation','随包工具','制作 H5、落地页、文章页和可分享的内容页面。'],
 ['✒','自然写作工具','creation','随包工具','检查套话、表达节奏和具体细节，让文案更贴近你的语气。'],
 ['🎬','视频与音频','creation','随包工具','视频生成、下载、抽帧和音频转写；按任务选择本地或云端处理。'],
 ['🔔','任务语音通知','remote','可选工具说明','附带系统语音脚本；自动通知需按 Codex 工作流配置。'],
 ['🔊','AI 语音朗读','remote','系统语音','可让 Codex 调用系统语音朗读简短回复，支持离线朗读。'],
 ['💬','个人微信接入','remote','需要平台授权','附带接入代码和部署手册，用微信发送指令、收取结果。'],
 ['🏢','企业微信接入','remote','需要平台授权','把 AI 接到团队消息入口，包含本地与服务器部署说明。'],
 ['📊','视频号评论导出','business','需要平台登录','导出自己账号的评论，整理为表格，再分析反馈和选题。'],
 ['🎧','网站 AI 客服','business','需要部署','把知识库问答接到网站客服窗口，附带前后端参考实现。'],
 ['↗','营销与增长','business','随包工具','整理用户需求、竞品信息、定价思路和营销计划。'],
];
const grid=document.querySelector('#tool-grid');
for(const [icon,name,category,status,description]of tools){
 const card=document.createElement('article');card.className='tool';card.dataset.category=category;
 const top=document.createElement('div');top.className='tool-icon';const mark=document.createElement('span');mark.textContent=icon;mark.setAttribute('aria-hidden','true');const label=document.createElement('small');label.textContent=status;top.append(mark,label);
 const title=document.createElement('h3');title.textContent=name;const body=document.createElement('p');body.textContent=description;const note=document.createElement('div');note.className='tool-note';note.textContent='在工作台中描述任务，或查看随包安装说明';card.append(top,title,body,note);grid.append(card);
}
for(const button of document.querySelectorAll('[data-filter]'))button.addEventListener('click',()=>{
 for(const other of document.querySelectorAll('[data-filter]')){const selected=other===button;other.classList.toggle('active',selected);other.setAttribute('aria-pressed',String(selected));}
 for(const card of grid.children)card.hidden=button.dataset.filter!=='all'&&card.dataset.category!==button.dataset.filter;
});
async function release(){
 const status=document.querySelector('#release-status');
 try{
  const response=await fetch('/api/desktop-release');if(!response.ok)throw new Error('unavailable');
  const data=await response.json();
  for(const platform of ['mac','mac-intel','windows']){
   const link=document.querySelector(`[data-platform="${platform}"]`);
   const meta=document.getElementById(platform+'-meta');
   const asset=data.assets[platform];
   if(!asset){link.removeAttribute('href');link.setAttribute('aria-disabled','true');link.textContent='此平台暂未发布';meta.textContent='最新正式版尚无此平台安装包';continue;}
   link.href=asset.url;link.removeAttribute('aria-disabled');link.textContent='下载最新正式版 ↓';
   meta.textContent=`v${data.version} · ${(asset.bytes/1024/1024).toFixed(0)} MB`;
  }
  status.textContent=`当前正式版 v${data.version} · 生图等插件请在客户端插件市场安装和更新。`;
 }catch{
  status.textContent='暂时无法读取版本，请前往 GitHub 发布页选择安装包。';
  for(const link of document.querySelectorAll('.download')){link.href='https://github.com/JayceHuang/ipzsk-dsh-desktop/releases/latest';link.removeAttribute('aria-disabled');link.textContent='前往 GitHub 下载 ↗';}
 }
}
release();
