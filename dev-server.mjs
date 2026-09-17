// Local preview: serves static files and proxies /api /v1 /downloads to the real backend
// so the cookie session works same-origin on localhost. Usage: node dev-server.mjs [port]
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(process.argv[2] ?? 5173);
const UPSTREAM = process.env.IPZSK_API_BASE_URL ?? 'https://api.ipzsk.com';
const SITE_ORIGIN = 'https://www.ipzsk.com'; // backend CORS/CSRF only trusts www
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.mp4': 'video/mp4' };
const REWRITES = { '/workstation': '/workstation.html', '/account': '/account.html', '/developer': '/developer.html', '/workspace': '/workspace.html', '/login': '/account.html', '/register': '/account.html' };

async function proxy(req, res) {
  const headers = { ...req.headers, host: new URL(UPSTREAM).host, origin: SITE_ORIGIN, referer: SITE_ORIGIN + '/' };
  delete headers['accept-encoding'];
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(await Array.fromAsync(req));
  const r = await fetch(UPSTREAM + req.url, { method: req.method, headers, body, redirect: 'manual' });
  const out = {};
  r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie'].includes(k) && !k.startsWith('access-control-')) out[k] = v; });
  // Drop Domain only; keep Secure (__Secure- prefixed cookies are rejected without it; localhost is a secure context)
  const cookies = r.headers.getSetCookie().map(c => c.replace(/;\s*Domain=[^;]*/i, ''));
  if (cookies.length) out['set-cookie'] = cookies;
  res.writeHead(r.status, out).end(Buffer.from(await r.arrayBuffer()));
}

async function serve(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  p = REWRITES[p] ?? p;
  let file = path.join(ROOT, path.normalize(p));
  if (!file.startsWith(ROOT) || file.includes(`${path.sep}.`)) return res.writeHead(403).end();
  if ((await fs.stat(file).catch(() => null))?.isDirectory()) file = path.join(file, 'index.html');
  let data = await fs.readFile(file).catch(() => null);
  if (!data) return res.writeHead(404).end('not found');
  const ext = path.extname(file);
  if (['.html', '.js', '.mjs'].includes(ext)) data = data.toString().replaceAll(UPSTREAM, '').replaceAll('https://www.ipzsk.com/', '/');
  res.writeHead(200, { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(data);
}

http.createServer((req, res) => {
  const handler = /^\/(api|v1|downloads)\//.test(req.url) ? proxy : serve;
  handler(req, res).catch(e => { console.error(req.url, e); res.writeHead(502).end(String(e)); });
}).listen(PORT, () => console.log(`http://localhost:${PORT}  →  ${UPSTREAM}`));
