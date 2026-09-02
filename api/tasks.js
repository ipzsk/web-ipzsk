async function proxyApiMart(req, res, path) {
  const baseUrl = (process.env.APIMART_BASE_URL || "https://api.apimart.ai/v1").replace(/\/$/, "");
  const apiKey = process.env.APIMART_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "APIMart 生图服务尚未配置" });

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(12_000),
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
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const taskId = Array.isArray(req.query.task_id) ? req.query.task_id[0] : req.query.task_id;
  if (typeof taskId !== "string" || !taskId || taskId.length > 200) {
    return res.status(400).json({ error: "无效的任务 ID" });
  }

  return proxyApiMart(req, res, `/tasks/${encodeURIComponent(taskId)}?language=zh`);
};
