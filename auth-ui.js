// Authentication views share one flow; account data and credentials remain in account.js.
export function initAuth({request,humanProof,onSignedIn}) {
  const $=selector=>document.querySelector(selector),root=$('#email-login');
  const storageKey='ipzsk.auth.flow';
  const readSaved=()=>{try{return JSON.parse(sessionStorage.getItem(storageKey))||{};}catch{return {};}};
  const saved=readSaved(),pending={},cooldowns=new Map();
  for(const kind of ['register','reset']){
    const item=saved.pending?.[kind];
    if(typeof item?.email==='string'&&item.email.length<=254&&item.until>Date.now())pending[kind]=item;
  }
  for(const [email,until] of Object.entries(saved.cooldowns||{}))if(email.length<=254&&typeof until==='number'&&until>Date.now())cooldowns.set(email,until);
  let view='login',email='',ready=false,busy=false,revision=0,completion='register';
  const views={
    login:['欢迎回来','登录你的 IPZSK 账户，继续工作。',''],
    register:['创建账户','用邮箱创建账户，验证后即可登录。','第 1 步，共 2 步 · 设置账户'],
    verify:['验证你的邮箱','输入邮件中的验证码，完成账户注册。','第 2 步，共 2 步 · 验证邮箱'],
    reset:['找回密码','输入注册邮箱，我们会发送重置密码的验证码。','第 1 步，共 2 步 · 确认邮箱'],
    'reset-confirm':['设置新密码','如果该邮箱已注册，你会收到验证码邮件。','第 2 步，共 2 步 · 验证并重置'],
    success:['操作成功','','']
  };
  const formFor={login:'password-login-form',register:'register-form',verify:'verify-register-form',reset:'reset-send-form','reset-confirm':'reset-password-form'};
  const persist=()=>{try{sessionStorage.setItem(storageKey,JSON.stringify({pending,cooldowns:Object.fromEntries(cooldowns)}));}catch{}};
  const normalize=value=>String(value||'').trim().toLowerCase();
  function notice(message='',error=false){const n=$('#account-notice');n.textContent=message;n.hidden=!message;n.classList.toggle('is-error',error);n.setAttribute('role',error?'alert':'status');}
  function currentEmail(){return normalize(formFor[view]?$('#'+formFor[view]).elements.email.value:email);}
  function clearErrors(){for(const field of root.querySelectorAll('[aria-invalid]')){field.removeAttribute('aria-invalid');field.setAttribute('aria-describedby',field.dataset.hint||'');}for(const p of root.querySelectorAll('.field-error'))p.remove();}
  function fieldError(input,message){
    input.setAttribute('aria-invalid','true');const p=document.createElement('p');p.className='field-error';p.id=input.id+'-error';p.textContent=message;
    input.closest('.auth-field').append(p);const hint=input.dataset.hint||'';input.setAttribute('aria-describedby',[hint,p.id].filter(Boolean).join(' '));
  }
  for(const input of root.querySelectorAll('input:not([type="hidden"])')){
    input.dataset.hint=input.getAttribute('aria-describedby')||'';
    input.addEventListener('input',()=>{input.removeAttribute('aria-invalid');document.getElementById(input.id+'-error')?.remove();input.setAttribute('aria-describedby',input.dataset.hint);if(input.name==='email')refreshButtons();});
  }
  function validate(form){
    clearErrors();let first;
    for(const input of form.querySelectorAll('input:not([type="hidden"])')){
      if(input.name==='email')input.value=normalize(input.value);
      let message='';
      if(!input.value)message=input.name==='email'?'请输入邮箱地址。':input.name==='otp'?'请输入邮箱验证码。':'请输入密码。';
      else if(input.type==='email'&&!input.validity.valid)message='请输入有效的邮箱地址，例如 you@example.com。';
      else if(input.name==='otp'&&!/^\d{6}$/.test(input.value))message='验证码需要填写 6 位数字。';
      else if(input.name==='password'&&input.minLength>0&&input.value.length<input.minLength)message='密码至少需要 12 个字符。';
      else if(input.maxLength>0&&input.value.length>input.maxLength)message='输入内容过长，请检查。';
      if(message){fieldError(input,message);first??=input;}
    }
    if(first){notice('请检查下方填写的内容。',true);first.focus();return false;}return true;
  }
  const sendButtons=[['register-submit','register-form','继续，验证邮箱'],['resend-register','verify-register-form','重新发送'],['reset-send','reset-send-form','发送重置验证码'],['resend-reset','reset-password-form','重新发送']];
  function refreshButtons(){
    for(const b of root.querySelectorAll('button'))b.disabled=busy;
    for(const [id,form,label] of sendButtons){const b=$('#'+id),target=normalize($('#'+form).elements.email.value);const seconds=Math.max(0,Math.ceil(((cooldowns.get(target)||0)-Date.now())/1000));
      b.disabled=busy||!ready||seconds>0;if(!b.dataset.working)b.textContent=seconds?`${seconds} 秒后重发`:label;
    }
    for(const field of root.querySelectorAll('input'))field.readOnly=busy;
  }
  function updateURL(next,replace){
    const url=new URL(location.href);const mode=['register','verify'].includes(next)?'register':['reset','reset-confirm'].includes(next)?'reset':'login';
    if(mode==='login')url.searchParams.delete('mode');else url.searchParams.set('mode',mode);
    if(next==='verify')url.searchParams.set('step','verify');else if(next==='reset-confirm')url.searchParams.set('step','password');else url.searchParams.delete('step');
    if(url.href!==location.href)history[replace?'replaceState':'pushState']({},'',url);
  }
  function show(next,{targetEmail,url=true,replace=false,focus=true}={}){
    email=normalize(targetEmail??currentEmail());revision++;busy=false;
    if($('#captcha-dialog').open)$('#captcha-cancel').click();
    clearErrors();notice();view=next;
    for(const section of root.querySelectorAll('[data-auth-view]'))section.hidden=section.dataset.authView!==next;
    for(const form of root.querySelectorAll('form')){form.elements.email.value=email;for(const input of form.querySelectorAll('input[name="password"],input[name="otp"]'))input.value='';}
    for(const b of root.querySelectorAll('[data-password-toggle]')){const input=document.getElementById(b.dataset.passwordToggle);input.type='password';b.textContent='显示';b.setAttribute('aria-pressed','false');b.setAttribute('aria-label','显示密码');}
    $('#register-recipient').textContent=email;$('#reset-recipient').textContent=email;
    const [title,description,step]=views[next];$('#account-heading').textContent=title;$('#account-description').textContent=description;$('#auth-step').textContent=step;$('#auth-step').hidden=!step;
    if(next==='success'){
      $('#account-heading').textContent=completion==='register'?'账户已创建':'密码已重置';
      $('#account-description').textContent=completion==='register'?'邮箱验证成功，现在可以登录了。':'请使用新密码重新登录。';
      $('#success-description').textContent=email;
    }
    document.title=$('#account-heading').textContent+' · IPZSK';
    if(url)updateURL(next,replace);refreshButtons();
    if(focus)$('#account-heading').focus({preventScroll:false});
  }
  function fromURL({focus=false}={}){
    const params=new URLSearchParams(location.search),mode=params.get('mode');
    const kind=mode==='register'?'register':mode==='reset'?'reset':'login';
    const item=pending[kind];
    const next=kind==='register'&&params.get('step')==='verify'&&item?'verify':kind==='reset'&&params.get('step')==='password'&&item?'reset-confirm':kind;
    show(next,{targetEmail:item?.email??(email||normalize($('#'+formFor[kind]).elements.email.value)),url:true,replace:true,focus});
  }
  for(const b of root.querySelectorAll('[data-auth-nav]'))b.addEventListener('click',()=>{if(!busy)show(b.dataset.authNav);});
  window.addEventListener('popstate',()=>{if(!root.hidden)fromURL({focus:true});});
  for(const b of root.querySelectorAll('[data-password-toggle]'))b.addEventListener('click',()=>{
    const input=document.getElementById(b.dataset.passwordToggle),visible=input.type==='password';input.type=visible?'text':'password';b.textContent=visible?'隐藏':'显示';b.setAttribute('aria-pressed',String(visible));b.setAttribute('aria-label',visible?'隐藏密码':'显示密码');
  });
  function remember(kind,target,sent=true){pending[kind]={email:normalize(target),until:Date.now()+15*60000};if(sent)cooldowns.set(normalize(target),Date.now()+60000);persist();}
  function clearPending(kind){delete pending[kind];persist();}
  async function run(event,operation){
    event.preventDefault();if(busy)return;
    const form=event.currentTarget.tagName==='FORM'?event.currentTarget:null;if(form&&!validate(form))return;
    const body=form?Object.fromEntries(new FormData(form)):null;
    const button=form?event.submitter||form.querySelector('button[type="submit"]'):event.currentTarget;
    const rev=revision,label=button.textContent;button.dataset.job=String(rev);busy=true;notice();refreshButtons();button.dataset.working='true';button.textContent=button.dataset.busyLabel||'处理中…';button.setAttribute('aria-busy','true');
    const isCurrent=()=>revision===rev;
    try{await operation(body,isCurrent);}catch(error){if(isCurrent()){
      notice(error.message||'操作未完成，请稍后再试。',true);
      const input=form?.elements[(['INVALID_OTP','OTP_EXPIRED','TOO_MANY_ATTEMPTS'].includes(error.code))?'otp':error.code==='PASSWORD_TOO_SHORT'?'password':''];
      if(input){fieldError(input,error.message);input.focus();}else $('#account-notice').focus();
    }}finally{
      if(button.dataset.job===String(rev)){delete button.dataset.working;delete button.dataset.job;button.removeAttribute('aria-busy');button.textContent=label;}
      if(isCurrent())busy=false;refreshButtons();
    }
  }
  async function send(path,body,isCurrent){
    if(!ready)throw new Error('邮箱验证服务暂不可用，请稍后再试。');
    const action=path==='/api/auth/sign-up/email'?'register':path==='/api/auth/email-otp/send-verification-otp'?'resend':'reset';
    const captcha=await humanProof(action,body.email);if(!isCurrent())return false;
    await request(path,{...body,captcha});return isCurrent();
  }
  const submit=(id,fn)=>$('#'+id).addEventListener('submit',event=>run(event,fn));
  submit('password-login-form',async(body,isCurrent)=>{
    try{
      try{await request('/api/auth/sign-in/email',body);}catch(error){
        if(error.code!=='captcha_required')throw error;
        const captcha=await humanProof('login',body.email);if(!isCurrent())return;
        await request('/api/auth/sign-in/email',{...body,captcha});
      }
    }catch(error){
      if(!isCurrent())return;
      if(error.code==='EMAIL_NOT_VERIFIED'){remember('register',body.email,false);show('verify',{targetEmail:body.email});notice('该邮箱尚未验证。请输入已收到的验证码，或点击重新发送。');return;}
      if(error.code==='INVALID_EMAIL_OR_PASSWORD')$('#login-password').value='';throw error;
    }
    if(isCurrent()){for(const input of root.querySelectorAll('input[name="password"]'))input.value='';onSignedIn();}
  });
  submit('register-form',async(body,isCurrent)=>{
    try{if(!await send('/api/auth/sign-up/email',{...body,name:body.email},isCurrent))return;}
    catch(error){if(isCurrent()&&['USER_ALREADY_EXISTS','USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'].includes(error.code)){show('login',{targetEmail:body.email});notice('该邮箱已注册，请登录；忘记密码可以通过邮箱找回。');return;}throw error;}
    remember('register',body.email);show('verify',{targetEmail:body.email});
  });
  submit('verify-register-form',async(body,isCurrent)=>{await request('/api/auth/email-otp/verify-email',body);if(!isCurrent())return;clearPending('register');completion='register';show('success',{targetEmail:body.email});});
  submit('reset-send-form',async(body,isCurrent)=>{if(!await send('/api/auth/email-otp/request-password-reset',body,isCurrent))return;remember('reset',body.email);show('reset-confirm',{targetEmail:body.email});});
  submit('reset-password-form',async(body,isCurrent)=>{await request('/api/auth/email-otp/reset-password',body);if(!isCurrent())return;clearPending('reset');completion='reset';show('success',{targetEmail:body.email});});
  for(const [kind,id,path] of [['register','resend-register','/api/auth/email-otp/send-verification-otp'],['reset','resend-reset','/api/auth/email-otp/request-password-reset']]){
    $('#'+id).addEventListener('click',event=>run(event,async(_,isCurrent)=>{
      const body={email:currentEmail(),...(kind==='register'?{type:'email-verification'}:{})};
      if(!await send(path,body,isCurrent))return;remember(kind,body.email);clearErrors();const code=$('#'+(kind==='register'?'register-code':'reset-code'));code.value='';code.focus();notice('如果邮箱存在对应账户，你会收到新的验证码，请使用最新邮件中的验证码。');
    }));
  }
  $('#register-back').addEventListener('click',()=>{if(busy)return;clearPending('register');show('register');$('#register-email').focus();});
  $('#reset-back').addEventListener('click',()=>{if(busy)return;clearPending('reset');show('reset');$('#reset-email').focus();});
  setInterval(()=>{for(const [key,until] of cooldowns)if(until<=Date.now())cooldowns.delete(key);refreshButtons();},1000);
  fromURL();
  return {
    notice,
    setStatus(status){ready=!!status?.registration_ready;for(const id of ['register-status','reset-status']){$('#'+id).textContent=ready?'':'邮箱验证服务暂不可用，请稍后再试。';$('#'+id).hidden=ready;}refreshButtons();},
    showLogin(){show('login');},
    restore(){fromURL();},
  };
}
