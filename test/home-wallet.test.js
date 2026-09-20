const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const root = join(__dirname, '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const common = readFileSync(join(root, 'billing-ui.js'), 'utf8');
const script = readFileSync(join(root, 'home-wallet.js'), 'utf8');
function element() {
  return { textContent: '', hidden: false, children: [], attributes:{}, handlers:{},
    classList:{toggle(){}},
    setAttribute(name,value) { this.attributes[name]=value; },
    addEventListener(event,handler) { this.handlers[event]=handler; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children=children; },
    querySelectorAll() { return this.children; }, closest() { return this; },
  };
}
const usage = [
  {model:'image-model',billing_state:'settled',charged_cny:'0.00000001',cost_cny:'100',created_at:'2026-09-19T00:00:00Z'},
  {model:'video-model',billing_state:null,charged_cny:null,cost_cny:'5',created_at:'2026-09-19T00:00:00Z'},
  {model:'text-model',billing_state:'reserved',charged_cny:'0',created_at:'2026-09-19T00:00:00Z'},
  {model:'image-model',billing_state:'released',charged_cny:'0',created_at:'2026-09-19T00:00:00Z'},
];
async function home({fail={},search='',hostname='www.ipzsk.com',hash='',checkoutUrl='https://pancake.waffo.ai/store/test/checkout/test#token=fixture'}={}) {
  const elements=new Map([...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)].map(match=>[match[1],{...element(),hidden:/\shidden(?:\s|>)/.test(match[0])}]));
  const requests=[], redirects=[], timers=[], windowEvents={};
  const payloads={
    '/api/me/profile':{user:{email:'user@example.test'}},
    '/api/me/wallet':{available_cny:'5',entries:[]},
    '/api/me/usage':{rows:usage,count:usage.length,page_size:30},
    '/api/me/payments/options':{enabled:true,mode:'prod',packs:[10,50,100].map(n=>({key:'cny_'+n,amount_cny:String(n)}))},
    '/api/me/payments/orders':{rows:[]},
    '/api/me/payments/checkout':{checkout_url:checkoutUrl},
  };
  const context=vm.createContext({
    document:{getElementById:id=>elements.get(id),createElement:element},
    window:{addEventListener:(event,handler)=>{windowEvents[event]=handler;}},
    location:{search,hostname,pathname:'/',hash,assign:url=>redirects.push(url),replace:url=>redirects.push(url)}, URL,URLSearchParams,AbortSignal,
    crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},
    clearTimeout(){},setTimeout(handler){timers.push(handler);},
    fetch:async(url,options)=>{
      const path=new URL(url).pathname;requests.push({path,options});
      return {ok:!fail[path],status:fail[path]||200,json:async()=>fail[path]?{error:{code:'test'}}:payloads[path]};
    },
  });
  vm.runInContext(common,context);vm.runInContext(script,context);
  await new Promise(resolve=>setImmediate(resolve));
  return {elements,requests,redirects,timers,payloads,windowEvents,context};
}
test('默认首页只展示介绍，不展示钱包或请求账户接口',async()=>{
  const {elements,requests}=await home();
  assert.match(html,/<section id="wallet"[^>]* hidden>/);
  assert.equal(elements.get('wallet').hidden,true);
  assert.equal(elements.get('home').hidden,false);
  assert.equal(elements.get('homeTab').attributes['aria-current'],'page');
  assert.equal(elements.get('walletTab').attributes['aria-current'],'false');
  assert.equal(requests.length,0);
});
test('点击账单 Tab 才加载账户，首页/下载/前进后退均同步切换视图',async()=>{
  const page=await home();
  const {elements,requests,context,windowEvents}=page;
  async function navigate(hash) {
    context.location.hash=hash;windowEvents.hashchange();
    await new Promise(resolve=>setImmediate(resolve));
  }
  await navigate('#wallet');
  assert.equal(elements.get('wallet').hidden,false);
  assert.equal(elements.get('home').hidden,true);
  assert.equal(elements.get('walletTab').attributes['aria-current'],'page');
  assert.equal(elements.get('homeTab').attributes['aria-current'],'false');
  assert.equal(requests.length,5);
  await navigate('#home');
  assert.equal(elements.get('wallet').hidden,true);
  assert.equal(elements.get('home').hidden,false);
  assert.equal(elements.get('homeBalance').textContent,'—');
  assert.equal(requests.length,5);
  await navigate('#wallet');
  assert.equal(elements.get('wallet').hidden,false);
  assert.equal(requests.length,10);
  await navigate('#download');
  assert.equal(elements.get('wallet').hidden,true);
  assert.equal(elements.get('home').hidden,false);
  windowEvents.pageshow({persisted:true});
  assert.equal(requests.length,10);
});
test('账单 Tab：读取人民币，按真实扣款展示消费，小额不取零',async()=>{
  const {elements,requests}=await home({hash:'#wallet'});
  assert.match(html,/href="#wallet">余额与账单/);
  assert.equal(elements.get('homeBalance').textContent,'¥5.00');
  assert.equal(elements.get('walletDashboard').hidden,false);
  assert.equal(elements.get('walletGuest').hidden,true);
  assert.deepEqual(elements.get('homeUsage').children.map(tr=>tr.children[2].textContent),['¥0.00000001','待结算','待结算','¥0.00']);
  assert.deepEqual(elements.get('homePaymentPacks').children.map(button=>button.children[0].textContent),['¥10.00','¥50.00','¥100.00']);
  assert.ok(requests.every(r=>r.options.credentials==='include'&&r.options.cache==='no-store'));
  assert.match(html,/微信支付 · 可用/);
  assert.doesNotMatch(html,/支付宝|Apple Pay|Google Pay/);
});
test('未登录不读取钱包，不显示假余额；故障不会被当作未消费',async()=>{
  const guest=await home({hash:'#wallet',fail:{'/api/me/profile':401}});
  assert.equal(guest.elements.get('walletDashboard').hidden,true);
  assert.equal(guest.elements.get('walletGuest').hidden,false);
  assert.equal(guest.requests.length,1);
  const offline=await home({hash:'#wallet',fail:{'/api/me/profile':503}});
  assert.match(offline.elements.get('walletStatus').textContent,/暂时无法读取/);
  const partial=await home({hash:'#wallet',fail:{'/api/me/wallet':503,'/api/me/usage':503}});
  assert.equal(partial.elements.get('homeBalance').textContent,'—');
  assert.match(partial.elements.get('homeUsageStatus').textContent,/加载失败/);
  assert.equal(partial.elements.get('homePaymentPacks').children.length,3);
});
test('支付仅由点击发起，重复点击拦截；只发送档位，不发送用户身份或价格',async()=>{
  const page=await home({hash:'#wallet'});
  const button=page.elements.get('homePaymentPacks').children[0];
  await Promise.all([button.handlers.click(),button.handlers.click()]);
  const posts=page.requests.filter(r=>r.options.method==='POST');
  assert.equal(posts.length,1);
  assert.deepEqual(JSON.parse(posts[0].options.body),{pack:'cny_10'});
  assert.ok(posts[0].options.headers['Idempotency-Key']);
  assert.equal(page.redirects.length,1);
  const unsafe=await home({hash:'#wallet',checkoutUrl:'https://pancake.waffo.ai.evil.example/'});
  await unsafe.elements.get('homePaymentPacks').children[0].handlers.click();
  assert.equal(unsafe.redirects.length,0);
  assert.match(unsafe.elements.get('homePaymentNotice').textContent,/无法打开/);
});
test('支付回跳不代表到账，页面不改余额，也不自动创建支付订单',async()=>{
  const page=await home({search:'?payment=return',hash:'#wallet'});
  assert.equal(page.elements.get('wallet').hidden,false);
  assert.equal(page.elements.get('home').hidden,true);
  assert.equal(page.elements.get('homeBalance').textContent,'¥5.00');
  assert.equal(page.requests.filter(r=>r.options.method==='POST').length,0);
  assert.match(page.elements.get('homePaymentNotice').textContent,/只有支付核实后/);
});
test('会话失效或浏览器恢复旧页面会清除旧账户数据',async()=>{
  const page=await home({hash:'#wallet',fail:{'/api/me/usage':401}});
  assert.equal(page.elements.get('walletDashboard').hidden,true);
  assert.equal(page.elements.get('homeEmail').textContent,'');
  assert.equal(page.elements.get('homeUsage').children.length,0);
  const restored=await home({hash:'#wallet'});
  restored.windowEvents.pageshow({persisted:true});
  assert.equal(restored.elements.get('walletDashboard').hidden,true);
  assert.equal(restored.elements.get('homeBalance').textContent,'—');
});
test('裸域名先进入支持登录的 www，同步保留回跳参数且不发出跨域账户请求',async()=>{
  const page=await home({hostname:'ipzsk.com',search:'?payment=return',hash:'#wallet'});
  assert.deepEqual(page.redirects,['https://www.ipzsk.com/?payment=return#wallet']);
  assert.equal(page.requests.length,0);
});
