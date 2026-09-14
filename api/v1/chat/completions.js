const MAX_BODY_BYTES = 256 * 1024;
const MAX_MESSAGES = 32;
const MAX_OUTPUT_TOKENS = 3_000;

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

const gateway=require('../../../lib/gateway');
async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!/^Bearer ipz_[A-Za-z0-9_-]{43}$/.test(req.headers?.authorization||''))return res.status(401).json({error:'请先登录账户并充值点数。'});
  try{return await gateway(req,res,'/v1/chat/completions',normalizeBody(parseBody(req)));}
  catch(error){return res.status(error.statusCode||400).json({error:error.message});}
}
module.exports=handler;
module.exports.config={maxDuration:120};
module.exports.normalizeBody=normalizeBody;
