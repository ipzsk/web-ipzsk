const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const handler = require("../api/v1/chat/completions.js");

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    json(value) { this.body = value; return this; },
    write(value) { this.chunks.push(Buffer.from(value)); },
    end(value) { if (value) this.write(value); this.ended = true; return this; },
  };
}

afterEach(() => {
  delete process.env.DSH_PPT_PROXY_TOKEN;
  delete process.env.APIMART_API_KEY;
  delete global.fetch;
});

test("rejects requests when the proxy token is missing on the server", async () => {
  const res = responseRecorder();
  await handler({ method: "POST", headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 503);
});

test("rejects invalid desktop credentials", async () => {
  process.env.DSH_PPT_PROXY_TOKEN = "expected-token";
  const res = responseRecorder();
  await handler({ method: "POST", headers: { authorization: "Bearer wrong-token" }, body: {} }, res);
  assert.equal(res.statusCode, 401);
});

test("forwards an authenticated, constrained GPT-5 request", async () => {
  process.env.DSH_PPT_PROXY_TOKEN = "desktop-token";
  process.env.APIMART_API_KEY = "upstream-token";
  let upstream;
  global.fetch = async (url, options) => {
    upstream = { url, options, body: JSON.parse(options.body) };
    return new Response('{"choices":[]}', { status: 200, headers: { "content-type": "application/json" } });
  };
  const res = responseRecorder();
  await handler({
    method: "POST",
    headers: { authorization: "Bearer desktop-token" },
    body: { model: "other-model", messages: [{ role: "developer", content: "只输出 JSON" }, { role: "user", content: "生成 PPT 大纲" }], max_tokens: 9_000, stream: false },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(upstream.url, "https://api.apimart.ai/v1/chat/completions");
  assert.equal(upstream.body.model, "gpt-5");
  assert.equal(upstream.body.max_completion_tokens, 3_000);
  assert.equal(upstream.body.stream, false);
  assert.equal(upstream.options.headers.Authorization, "Bearer upstream-token");
  assert.equal(Buffer.concat(res.chunks).toString(), '{"choices":[]}');
});
