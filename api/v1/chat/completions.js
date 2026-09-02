const { timingSafeEqual } = require("node:crypto");

const MAX_BODY_BYTES = 256 * 1024;
const MAX_MESSAGES = 32;
const MAX_OUTPUT_TOKENS = 3_000;

function configuredToken() {
  return process.env.DSH_PPT_PROXY_TOKEN || "";
}

function requestToken(req) {
  const authorization = req.headers?.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return "";
  return authorization.slice(7);
}

function tokenMatches(provided, expected) {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseBody(req) {
  const raw = Buffer.isBuffer(req.body)
    ? req.body.toString("utf8")
    : typeof req.body === "string"
      ? req.body
      : JSON.stringify(req.body || {});
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
    const error = new Error("请求内容不能超过 256KB");
    error.statusCode = 413;
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("请求体必须是有效 JSON");
    error.statusCode = 400;
    throw error;
  }
}

function normalizeBody(body) {
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > MAX_MESSAGES) {
    const error = new Error(`messages 必须包含 1 到 ${MAX_MESSAGES} 条消息`);
    error.statusCode = 400;
    throw error;
  }
  for (const message of body.messages) {
    if (!message || !["developer", "system", "user", "assistant"].includes(message.role)) {
      const error = new Error("messages 包含不支持的角色");
      error.statusCode = 400;
      throw error;
    }
  }

  const requestedTokens = Number(body.max_completion_tokens ?? body.max_tokens ?? MAX_OUTPUT_TOKENS);
  const maxCompletionTokens = Number.isFinite(requestedTokens)
    ? Math.min(MAX_OUTPUT_TOKENS, Math.max(1, Math.floor(requestedTokens)))
    : MAX_OUTPUT_TOKENS;

  return {
    model: "gpt-5",
    messages: body.messages,
    stream: body.stream !== false,
    max_completion_tokens: maxCompletionTokens,
    ...(typeof body.temperature === "number" ? { temperature: Math.min(2, Math.max(0, body.temperature)) } : {}),
    ...(typeof body.reasoning_effort === "string" ? { reasoning_effort: body.reasoning_effort } : {}),
  };
}

async function forward(req, res, body) {
  const baseUrl = (process.env.APIMART_BASE_URL || "https://api.apimart.ai/v1").replace(/\/$/, "");
  const apiKey = process.env.APIMART_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "APIMart 文本服务尚未配置" });

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(110_000),
    });

    res.status(response.status);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", response.headers.get("content-type") || "application/json; charset=utf-8");
    if (!response.body) return res.end();

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    return res.end();
  } catch (error) {
    const message = error?.name === "TimeoutError" ? "连接 APIMart 超时" : "APIMart 当前不可用";
    return res.status(502).json({ error: message });
  }
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const expected = configuredToken();
  if (!expected) return res.status(503).json({ error: "DSH PPT 代理尚未配置" });
  if (!tokenMatches(requestToken(req), expected)) {
    res.setHeader("WWW-Authenticate", "Bearer");
    return res.status(401).json({ error: "无效的桌面端凭据" });
  }

  try {
    return await forward(req, res, normalizeBody(parseBody(req)));
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || "请求失败" });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 120 };
module.exports.normalizeBody = normalizeBody;
