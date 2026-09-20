const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const root = join(__dirname, '..');
const html = readFileSync(join(root, 'account.html'), 'utf8');
const script = readFileSync(join(root, 'account.js'), 'utf8');
const billingScript = readFileSync(join(root, 'billing-ui.js'), 'utf8');

function element() {
  const classes = new Set();
  return { textContent: '', innerHTML: '', children: [], value: '',
    classList: { toggle(name, force) { if (force) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
    setAttribute() {}, addEventListener() {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
  };
}
async function account(wallet) {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], element()]));
  const context = vm.createContext({
    document: { getElementById: id => elements.get(id), createElement: element },
    location: { search: '' }, URLSearchParams, clearTimeout, setTimeout, AbortSignal,
    fetch: async url => {
      const payload = {
        '/api/me/profile': { user: { email: 'currency@example.test' } },
        '/api/me/wallet': wallet,
        '/api/me/usage': { rows: [{ model:'image-model',created_at:'2026-09-19T00:00:00Z',billing_state:'settled',charged_cny:'0.00092800' }], count:1,page_size:30 },
        '/api/me/payments/options': { enabled: true, mode: 'prod', packs: [10,50,100].map(n => ({key:'cny_'+n,amount_cny:String(n)})) },
        '/api/me/payments/orders': { rows: [{ id:'fixture',amount_cny:'10.00',state:'credited',mode:'prod',created_at:'2026-09-19T00:00:00Z' }] },
      }[new URL(url).pathname];
      return { ok: true, json: async () => payload };
    },
  });
  vm.runInContext(billingScript, context);
  vm.runInContext(script, context);
  await vm.runInContext('loadAccount()', context);
  return { context, elements };
}

test('账户余额和充值档位直接显示人民币，不把元乘成点数', async () => {
  const {elements} = await account({available_cny:'5.00000000',available_points:'500',source:'lanehub',entries:[
    {kind:'signup_bonus',amount_cny:'5.00000000',created_at:'2026-09-19T00:00:00Z'},
    {kind:'consumption',amount_cny:'-0.00092800',created_at:'2026-09-19T00:00:00Z'},
  ]});
  assert.equal(elements.get('balance').textContent,'¥5.00');
  assert.equal(elements.get('balanceSource').textContent,'人民币 · 可用余额');
  assert.match(elements.get('entries').innerHTML,/注册赠送/);
  assert.match(elements.get('entries').innerHTML,/-¥0\.000928/);
  const buttons=elements.get('paymentPacks').children;
  assert.deepEqual(buttons.map(button=>button.children.map(child=>child.textContent)),[
    ['¥10.00','到账 ¥10.00'],['¥50.00','到账 ¥50.00'],['¥100.00','到账 ¥100.00'],
  ]);
  assert.match(elements.get('paymentOrders').children[0].textContent,/¥10\.00 · 充值已到账/);
  assert.equal(elements.get('paymentEmail').textContent,'currency@example.test');
  assert.equal(elements.get('usageRows').children[0].children[2].textContent,'¥0.000928');
  assert.equal(elements.get('usageNext').disabled,true);
});

test('金额缺失不显示为零，小额扣费不显示为免费，明细保留精度', async () => {
  const {context,elements} = await account({available_cny:null,entries:[]});
  assert.equal(elements.get('balance').textContent,'—');
  const format = (value,detailed=false) => {
    context.input = value; context.detailed = detailed;
    return vm.runInContext('money(input,detailed)',context);
  };
  assert.equal(format('0'),'¥0.00');
  assert.equal(format('0.00000001'),'¥0.00000001');
  assert.equal(format('-0.17105910',true),'-¥0.1710591');
  for(const value of [null,undefined,'',' ','invalid',Infinity]) assert.equal(format(value),'—');
});

test('注册赠额和定价说明统一人民币，页面不再混用点数', () => {
  const pricing = readFileSync(join(root,'pricing.html'),'utf8');
  assert.match(html,/赠送 ¥5\.00/);
  assert.match(pricing,/¥5\.00 体验额度/);
  assert.doesNotMatch(html+pricing+script,/500 点|点额度|balance_points|available_points|amount_points/);
});
