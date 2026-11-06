// Local development CORS proxy for Expo Web. Browsers block direct fetch() to
// third-party APIs (nhentai.net, gelbooru.com) without Access-Control-Allow-Origin;
// native builds have no CORS layer. Point Settings -> Worker URL at
// http://localhost:8085 to exercise the same `${workerUrl}?url=...` contract the
// app already uses against a deployed Cloudflare Worker.
const http = require('node:http');
const { Readable } = require('node:stream');

const PORT = Number(process.env.PORT) || 8085;
const USER_AGENT =
  process.env.PROXY_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': contentType });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, `Method not allowed: ${req.method}`);
    return;
  }

  let target;
  try {
    target = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('url');
  } catch {
    send(res, 400, 'Bad request: unparsable request URL');
    return;
  }

  if (!target) {
    send(res, 400, 'Bad request: missing "url" query parameter');
    return;
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    send(res, 400, `Bad request: invalid target URL: ${target}`);
    return;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    send(res, 400, `Bad request: unsupported protocol: ${parsed.protocol}`);
    return;
  }

  const startedAt = Date.now();
  try {
    // Neutral UA only; the app's workerHeaders() already strips Referer/Cookie.
    // nhentai.net returns Brotli that RN iOS cannot decode, so request a
    // Conservative encoding set and let fetch transparently decompress here.
    const upstream = await fetch(parsed.toString(), {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*', 'Accept-Encoding': 'gzip, deflate' },
      redirect: 'follow',
    });

    const headers = { ...CORS_HEADERS };
    const contentType = upstream.headers.get('content-type');
    if (contentType) headers['Content-Type'] = contentType;
    const cacheControl = upstream.headers.get('cache-control');
    if (cacheControl) headers['Cache-Control'] = cacheControl;
    // Body is decompressed in transit, so Content-Length/Content-Encoding from
    // upstream no longer describe the bytes we stream back.
    headers['X-Proxy-Status'] = String(upstream.status);

    res.writeHead(upstream.status, headers);
    if (req.method === 'HEAD' || !upstream.body) {
      res.end();
    } else {
      Readable.fromWeb(upstream.body).pipe(res);
    }
    console.log(`${req.method} ${upstream.status} ${parsed.toString()} (${Date.now() - startedAt}ms)`);
  } catch (error) {
    console.error(`GET 502 ${parsed.toString()} :: ${error && error.message ? error.message : error}`);
    send(res, 502, `Upstream fetch failed: ${error && error.message ? error.message : String(error)}`);
  }
});

server.listen(PORT, () => {
  console.log(`Local CORS proxy listening on http://localhost:${PORT}`);
  console.log('Usage: http://localhost:8085/?url=<encoded-target-url>');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
