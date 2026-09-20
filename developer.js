import {request,loginUrl} from '/api.js';
const $=s=>document.querySelector(s),el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const labels={pending:'待审核',approved:'已批准',rejected:'已驳回',disabled:'已停用',published:'已上架',withdrawn:'已撤回 / 下架'};
const amount=v=>v==null?'未确认':Number(v).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:8})+' 元';
const count=v=>v==null?'未知':Number(v).toLocaleString('zh-CN');
const errors={developer_approval_required:'需要管理员批准开发者申请。',developer_application_exists:'已有申请，请等待审核。',published_metadata_locked:'已上架插件的名称需要管理员修改。',invalid_release_url:'请填写当前仓库的 GitHub Release 地址。',select_one_tgz_asset:'请提供 npm pack 生成的 .tgz 附件；多个附件时需指定名称。',package_identity_mismatch:'安装包中的包名或版本与登记信息不一致。',already_exists:'插件标识、包名或版本已存在。',github_fetch_failed:'无法读取 GitHub Release，请检查是否已公开发布。',plugin_not_found:'插件不存在或你没有权限。',invalid_date_range:'日期范围不能超过一年。'};
async function api(path,body){try{return await request('/api/me/developer'+path,{body});}catch(e){if(e.status===401){$('#workspace').hidden=true;showLogin();}throw Object.assign(new Error(errors[e.code]??e.message),{status:e.status});}}
function action(fn){return async e=>{e?.preventDefault();const b=e?.currentTarget?.tagName==='BUTTON'?e.currentTarget:e?.currentTarget?.querySelector('button[type=submit],button.primary');if(b)b.disabled=true;try{$('#notice').textContent='';await fn(e);}catch(err){if(err.status!==401)$('#notice').textContent=err.message;}finally{if(b)b.disabled=false;}};}
function button(text,fn){const b=el('button',text);b.type='button';b.className='secondary';b.addEventListener('click',action(fn));return b;}
function table(box,headers,rows){box.replaceChildren();if(!rows.length){box.append(el('p','暂无记录'));return;}const t=el('table'),h=el('tr');headers.forEach(v=>h.append(el('th',v)));const head=el('thead');head.append(h);t.append(head);const body=el('tbody');for(const row of rows){const tr=el('tr');row.forEach(v=>{const td=el('td');td.append(v instanceof Node?v:document.createTextNode(String(v??'—')));tr.append(td);});body.append(tr);}t.append(body);box.append(t);}
function showLogin(){const gate=$('#gate');gate.hidden=false;const a=el('a','登录 / 注册');a.href=loginUrl('/developer');a.className='primary';gate.replaceChildren(el('p','使用 IPZSK 账户登录，申请成为插件开发者。'),a);}
let selected;
async function refresh(){
 const {profile}=await api('');$('#gate').hidden=false;$('#workspace').hidden=true;
 if(profile?.state!=='approved'){
  const gate=$('#gate');gate.replaceChildren(el('h2',profile?labels[profile.state]:'申请成为开发者'),el('p',profile?.review_note??'审核通过后，可管理自己的插件并查看使用和收益数据。'));
  if(!profile||profile.state==='rejected'){const form=el('form'),label=el('label','开发者名称'),input=el('input');input.name='display_name';input.maxLength=100;input.required=true;input.value=profile?.display_name??'';label.append(input);const submit=el('button','提交申请');submit.className='primary';form.append(label,submit);form.addEventListener('submit',action(async()=>{await api('/apply',{display_name:input.value});await refresh();}));gate.append(form);}return;
 }
 $('#gate').hidden=true;$('#workspace').hidden=false;$('#greeting').textContent=profile.display_name+' · 我的插件';
 const {plugins}=await api('/plugins');const filter=$('#plugin-filter'),previous=filter.value;filter.replaceChildren(new Option('全部',''),...plugins.map(p=>new Option(p.name,p.id)));filter.value=previous;
 table($('#plugins'),['插件','发布状态','累计使用人数','操作'],plugins.map(p=>{
 const status=!p.enabled?'已停用':Number(p.published_versions)>0?'已上架':Number(p.pending_versions)>0?'待审核':'未上架';
 const description=el('div',status);if(Number(p.pending_versions)>0&&Number(p.published_versions)>0)description.append(el('small','新版本待审核'));
 return [p.name,description,count(p.active_users),button('管理',async()=>{selected=p;await releases();})];}));
 if(selected){selected=plugins.find(p=>p.id===selected.id);if(selected&&$('#releases').open)await releases();else if(!selected)$('#releases').close();}
 await usage();
}
async function releases(){const p=selected,box=$('#releases');box.replaceChildren();const heading=el('div');heading.className='dialog-heading';heading.append(el('h2',p.name),button('关闭',()=>box.close()));box.append(heading);if(!box.open)box.showModal();
 const meta=el('div');meta.className='plugin-detail-meta';meta.append(el('p',`共 ${p.versions} 个版本 · 分成比例 ${p.revenue_share_bps==null?'待配置':p.revenue_share_bps/100+'%'}`),button('修改名称',async()=>{const name=prompt('插件名称',p.name);if(!name)return;await api('/plugins/'+p.id+'/settings',{name});await refresh();}));box.append(meta);
 const form=el('form'),label=el('label','GitHub Release 地址'),url=el('input');url.type='url';url.required=true;url.placeholder='https://github.com/'+p.repository+'/releases/tag/v1.0.0';label.append(url);const assetLabel=el('label','附件名（多个 .tgz 时填写）'),asset=el('input');assetLabel.append(asset);const submit=el('button','提交审核');submit.className='primary';form.append(label,assetLabel,submit);
 form.addEventListener('submit',action(async()=>{await api('/plugins/'+p.id+'/releases',{release_url:url.value,asset_name:asset.value||undefined});await refresh();}));const publish=el('details');publish.append(el('summary','＋ 提交新版本'),form,el('p','使用 npm pack 构建的安装包，提交后等待审核。'));box.append(publish);
 const list=el('div');list.className='table-wrap';box.append(list);const {releases}=await api('/plugins/'+p.id+'/releases');table(list,['版本','状态','审核说明','操作'],releases.map(r=>[r.version,labels[r.state]+(r.withdrawal_requested?' · 下架申请中':''),r.review_note||'—',['pending','published'].includes(r.state)&&!r.withdrawal_requested?button(r.state==='pending'?'撤回申请':'申请下架',async()=>{await api('/plugins/'+p.id+'/releases/'+r.id+'/withdraw',{});await refresh();}):'—']));
}
async function usage(){const params=new URLSearchParams(new FormData($('#filter')));const {rows}=await api('/usage?'+params);table($('#usage'),['插件 / 模型','用户计费收入','我的收益（未结算）','明细'],rows.map(r=>[
 r.plugin_name+' / '+r.model,amount(r.billed_revenue_cny),amount(r.accrued_earnings_cny),button('查看',()=>{
  const d=el('dialog');d.className='plugin-dialog';const h=el('div');h.className='dialog-heading';h.append(el('h2',r.plugin_name+' · 用量明细'),button('关闭',()=>d.close()));d.append(h);
  const box=el('div');box.className='table-wrap';d.append(box);table(box,['项目','数量'],[['使用人数',count(r.active_users)],['调用次数',r.requests],['失败次数',r.failed_requests],['输入 / 输出 token',`${count(r.input_tokens)} / ${count(r.output_tokens)}`],['未返回 token',r.unknown_token_requests+' 次'],['媒体任务 / 完成',`${r.media_tasks} / ${r.completed_media_tasks}`],['未配置分成比例的计费请求',r.unconfigured_share_requests+' 笔']]);document.body.append(d);d.addEventListener('close',()=>d.remove());d.showModal();
 })]));}

$('#create').addEventListener('submit',action(async e=>{await api('/plugins',Object.fromEntries(new FormData(e.target)));e.target.reset();await refresh();}));
$('#filter').addEventListener('submit',action(usage));$('#refresh').addEventListener('click',action(refresh));
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});$('#filter').elements.from.value=today.slice(0,8)+'01';$('#filter').elements.to.value=today;
await action(refresh)();
