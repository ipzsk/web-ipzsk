const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const handler = require("../api/v1/chat/completions.js");

function responseRecorder() {
  return {
    statusCode: 200, headers: {}, chunks: [],
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
  };
}
const VALID = "ipz_" + "a".repeat(43);
afterEach(() => { delete global.fetch; delete process.env.IPZSK_GATEWAY_URL; });

test("只接受 POST", async () => {
  const res = responseRecorder();
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 405);
});

// 这条是这次改造的重点：网站这侧不再有任何共享密钥，没带账户令牌就打不通，
// 不会再出现「记不到人头上的消费」。
test("没有账户令牌一律拒绝，且不会发出任何上游请求", async () => {
  let called = false;
  global.fetch = async () => { called = true; return new Response("{}"); };
  for (const headers of [{}, { authorization: "Bearer legacy-shared-token" }, { authorization: "Bearer ipz_short" }]) {
    const res = responseRecorder();
    await handler({ method: "POST", headers, body: { messages: [] } }, res);
    assert.equal(res.statusCode, 401);
  }
  assert.equal(called, false, "一个请求都不该发出去");
});

test("把调用方自己的令牌原样转给网关", async () => {
  let seen = null;
  process.env.IPZSK_GATEWAY_URL = "https://gateway.test";
  global.fetch = async (url, init) => { seen = { url: String(url), init }; return new Response('{"ok":true}', { headers: { "content-type": "application/json" } }); };
  const res = responseRecorder();
  await handler({ method: "POST", headers: { authorization: "Bearer " + VALID }, body: { model: "gpt-5", messages: [{ role: "user", content: "hi" }] } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(seen.url, "https://gateway.test/v1/chat/completions");
  assert.equal(seen.init.headers.Authorization, "Bearer " + VALID);
  assert.equal(JSON.parse(seen.init.body).model, "gpt-5");
});

test("请求体过大直接拒绝", async () => {
  const res = responseRecorder();
  await handler({ method: "POST", headers: { authorization: "Bearer " + VALID }, body: "x".repeat(300 * 1024) }, res);
  assert.equal(res.statusCode, 413);
});
