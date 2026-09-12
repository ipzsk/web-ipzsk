// DSH PPT 文本代理：**只做转发，不再持有任何密钥**。
//
// 原先这里用一个服务端共享口令（DSH_PPT_PROXY_TOKEN）鉴权，再用一把共享的
// APIMart Key 直连上游——谁调的、烧了多少 token，落不到任何人头上，插件作者
// 的分成自然也无从算起。现在它把调用方自己的 IPZSK 令牌原样转给网关，
// 计费、归属、额度全部由网关负责。
//
// 保留这条路径而不是直接删掉，是因为线上桌面端还指着它；桌面端换成直连
// api.ipzsk.com/v1 之后，这个文件就可以整个删除。
const gateway = () => (process.env.IPZSK_GATEWAY_URL || "https://api.ipzsk.com").replace(/\/$/, "");
const MAX_BODY_BYTES = 256 * 1024;

function requestToken(req) {
  const authorization = req.headers?.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return "";
  return authorization.slice(7);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  // 令牌只认网关签发的那种形状；旧的共享口令会在这里就被挡下，
  // 不会静默地变成一笔记不到人头上的消费。
  const token = requestToken(req);
  if (!/^ipz_[A-Za-z0-9_-]{43}$/.test(token)) {
    return res.status(401).json({ error: "需要 IPZSK 账户令牌（桌面端登录后自动获取）" });
  }

  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8")
    : typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
    return res.status(413).json({ error: "请求内容不能超过 256KB" });
  }

  try {
    const response = await fetch(`${gateway()}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: raw,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", response.headers.get("content-type") || "application/json; charset=utf-8");
    return res.status(response.status).send(text);
  } catch (error) {
    const message = error?.name === "TimeoutError" ? "连接 IPZSK 网关超时" : "IPZSK 网关当前不可用";
    return res.status(502).json({ error: message });
  }
};
