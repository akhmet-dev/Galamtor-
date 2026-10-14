const http = require('node:http');
const { validateAuthCallback, validateAuthState } = require('./auth-utils');
const { withTimeout } = require('./public/async-operations');

function createAuthCallbackServer({ state, origins, onCredential, onExpire = () => {}, onCancel = () => {}, credentialTimeoutMs = 35000, sessionTimeoutMs = 300000 }) {
  let stopped = false, busy = false, expiry;
  const responses = new Set();
  const server = http.createServer((req, res) => {
    const port = server.address()?.port;
    const allowed = origins.includes(req.headers.origin) && req.headers.host === `127.0.0.1:${port}`;
    const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'Vary': 'Origin' };
    if (allowed) Object.assign(headers, {
      'Access-Control-Allow-Origin': req.headers.origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Private-Network': 'true'
    });
    const finish = (status, code) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, headers);
      res.end(JSON.stringify({ ok: status === 200, code }));
    };
    if (!allowed) { finish(403, 'forbidden'); return; }
    if (!['/callback', '/cancel'].includes(req.url)) { finish(404, 'not-found'); return; }
    if (req.method === 'OPTIONS') { res.writeHead(204, headers); res.end(); return; }
    if (req.method !== 'POST') { finish(405, 'method'); return; }
    if (!(req.headers['content-type'] || '').startsWith('application/json')) { finish(415, 'content-type'); return; }
    if (stopped) { finish(410, 'expired'); return; }
    if (busy && req.url === '/callback') { finish(409, 'pending'); return; }
    let body = '', bytes = 0;
    const bodyTimer = setTimeout(() => { finish(408, 'body-timeout'); req.destroy(); }, 10000);
    req.setEncoding('utf8');
    req.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 65536) { clearTimeout(bodyTimer); finish(413, 'body-too-large'); req.resume(); }
      else body += chunk;
    });
    req.on('close', () => clearTimeout(bodyTimer));
    req.on('error', () => clearTimeout(bodyTimer));
    req.on('end', async () => {
      clearTimeout(bodyTimer);
      if (res.writableEnded || stopped) return;
      let payload;
      try { payload = JSON.parse(body); } catch { finish(400, 'invalid-json'); return; }
      if (req.url === '/cancel') {
        if (!validateAuthState(payload?.state, state)) { finish(403, 'invalid-state'); return; }
        finish(200, 'auth/cancelled');
        onCancel();
        stop();
        return;
      }
      const validation = validateAuthCallback(payload, state);
      body = '';
      if (validation.status !== 200) { finish(validation.status, 'invalid-callback'); return; }
      // Check again after body reading: two simultaneous POSTs cannot dispatch twice.
      if (busy) { finish(409, 'pending'); return; }
      busy = true;
      responses.add(res);
      try {
        const result = await withTimeout(Promise.resolve().then(() => onCredential(validation.payload)), credentialTimeoutMs, 'auth/timeout');
        const code = result?.code || (result?.ok === true ? 'complete' : 'auth/failed');
        const status = result?.ok === true ? 200 : code === 'auth/cancelled' ? 410 : code === 'auth/timeout' ? 504 : 401;
        if (!stopped) finish(status, code);
      } catch { if (!stopped) finish(504, 'auth/timeout'); }
      finally { responses.delete(res); stop(); }
    });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(expiry);
    for (const res of responses) {
      if (!res.writableEnded && !res.destroyed) { res.writeHead(410, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, code: 'auth/cancelled' })); }
    }
    server.close();
    server.closeIdleConnections();
  }
  server.once('listening', () => {
    expiry = setTimeout(() => { stop(); onExpire(); }, sessionTimeoutMs);
  });
  return { server, stop };
}

module.exports = { createAuthCallbackServer };
