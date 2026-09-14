// Images and answers are checked by the server; no client-side bypass or embedded answer.
export function createHumanProof({request}) {
  return function humanProof(action,email){
    return new Promise((resolve,reject)=>{
      const $=id=>document.getElementById(id),dialog=$('captcha-dialog'),status=$('captcha-status');
      const image=$('captcha-image'),input=$('captcha-answer'),form=$('captcha-form');
      const cancel=$('captcha-cancel'),refresh=$('captcha-retry'),submit=$('captcha-continue');
      let finished=false,generation=0,challenge,busy=false;
      const feedback=(text,error=false)=>{status.textContent=text;status.classList.toggle('is-error',error);};
      const controls=()=>{submit.disabled=busy||!challenge;refresh.disabled=busy;input.disabled=busy||!challenge;};
      const finish=(error,proof)=>{
        if(finished)return;finished=true;generation++;
        cancel.removeEventListener('click',onCancel);dialog.removeEventListener('cancel',onCancel);
        refresh.removeEventListener('click',load);form.removeEventListener('submit',verify);
        image.removeAttribute('src');image.hidden=true;input.value='';challenge=null;dialog.close();
        error?reject(new Error(error)):resolve(proof);
      };
      const onCancel=e=>{e.preventDefault();finish('已取消图片验证。');};
      async function load(){
        if(busy||finished)return;const attempt=++generation;busy=true;challenge=null;
        input.value='';input.removeAttribute('aria-invalid');image.hidden=true;image.removeAttribute('src');controls();feedback('正在加载图片验证码…');
        try{
          const data=await request('/api/account/captcha',{action,email});
          if(finished||attempt!==generation)return;
          if(typeof data.id!=='string'||typeof data.image!=='string'||!data.image.startsWith('data:image/png;base64,'))throw new Error('图片加载失败，请点击换一张。');
          challenge=data.id;image.src=data.image;image.hidden=false;
          feedback('请输入图片中的 5 位字符，不区分大小写。图片 2 分钟内有效。');
        }catch(error){if(!finished&&attempt===generation)feedback(error.message||'图片加载失败，请点击换一张。',true);}
        finally{if(!finished&&attempt===generation){busy=false;controls();if(challenge)input.focus();}}
      }
      async function verify(e){
        e.preventDefault();if(busy||!challenge||finished)return;
        const answer=input.value.trim().toUpperCase();
        if(!/^[A-Z0-9]{5}$/.test(answer)){input.setAttribute('aria-invalid','true');feedback('请输入图片中的 5 位字母或数字。',true);input.focus();return;}
        busy=true;controls();feedback('正在校验…');const attempt=generation;
        try{
          const proof=await request('/api/account/captcha/verify',{id:challenge,answer,action,email});
          if(finished||attempt!==generation)return;
          if(typeof proof.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(proof.token))throw new Error('验证结果无效，请换一张重试。');
          finish(null,proof);
        }catch(error){if(!finished&&attempt===generation){input.value='';input.setAttribute('aria-invalid','true');feedback(error.code==='captcha_invalid'?'图片验证码错误、已过期或尝试次数过多，请重新输入或换一张。':error.message,true);}}
        finally{if(!finished&&attempt===generation){busy=false;controls();input.focus();}}
      }
      submit.textContent=action==='login'?'验证并登录':'验证并发送邮件';
      cancel.addEventListener('click',onCancel);dialog.addEventListener('cancel',onCancel);
      refresh.addEventListener('click',load);form.addEventListener('submit',verify);
      dialog.showModal();load();
    });
  };
}
