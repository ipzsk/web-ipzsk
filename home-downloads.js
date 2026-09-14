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
