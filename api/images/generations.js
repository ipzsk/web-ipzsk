async function proxyApiMart(req, res, path, body) {
  const baseUrl = (process.env.APIMART_BASE_URL || "https://api.apimart.ai/v1").replace(/\/$/, "");
  const apiKey = process.env.APIMART_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "APIMart 生图服务尚未配置" });

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", response.headers.get("content-type") || "application/json; charset=utf-8");
    return res.status(response.status).send(text);
  } catch (error) {
    const message = error?.name === "TimeoutError" ? "连接 APIMart 超时" : "APIMart 当前不可用";
    return res.status(502).json({ error: message });
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = Buffer.isBuffer(req.body)
    ? req.body
    : typeof req.body === "string"
      ? req.body
      : JSON.stringify(req.body || {});
  if (Buffer.byteLength(body) > 15 * 1024 * 1024) {
    return res.status(413).json({ error: "请求内容不能超过 15MB" });
  }

  return proxyApiMart(req, res, "/images/generations", body);
};
