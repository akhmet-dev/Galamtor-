const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createAuthCallbackServer } = require('../auth-server');
const state = 'a'.repeat(64), origin = 'https://galamtor.web.app';
async function fixture(t, options = {}) {
  const flow = createAuthCallbackServer({ state, origins: [origin], onCredential: async () => ({ ok: true }), ...options });
  await new Promise(resolve => flow.server.listen(0, '127.0.0.1', resolve));
  const port = flow.server.address().port;
  t.after(() => flow.stop());
  function request(body = { state, googleIdToken: 'qa-fake-token' }, headers = {}, path = '/callback', method = 'POST') {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path, method, headers: { Origin: origin, 'Content-Type': 'application/json', ...headers } }, res => {
        let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
      });
      req.on('error', reject); req.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
  }
  return { flow, request, localOrigin: `http://127.0.0.1:${port}` };
}

test('bridge documents require a valid nonce, approved opener origin and exact loopback host', async t => {
  const f = await fixture(t, { bridge: { html: '<title>Bridge fixture</title>', script: '// fixture' } });
  const path = `/bridge?state=${state}&origin=${encodeURIComponent(origin)}`;
  const page = await f.request('', {}, path, 'GET');
  assert.equal(page.status, 200); assert.match(page.headers['content-type'], /text\/html/);
  assert.equal(page.headers['cache-control'], 'no-store'); assert.equal(page.headers['referrer-policy'], 'no-referrer');
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(page.headers['content-security-policy'], /connect-src 'self'/);
  assert.equal((await f.request('', {}, path.replace(state, 'b'.repeat(64)), 'GET')).status, 403);
  assert.equal((await f.request('', {}, path.replace(encodeURIComponent(origin), encodeURIComponent('https://evil.example')), 'GET')).status, 403);
  assert.equal((await f.request('', { Host:'evil.example' }, path, 'GET')).status, 403);
  const script = await f.request('', {}, '/auth-bridge.js', 'GET');
  assert.equal(script.status, 200); assert.equal(script.body, '// fixture');
});

test('bridge same-origin callbacks still require the session nonce and reject null origins', async t => {
  let dispatched = 0;
  const f = await fixture(t, { bridge: { html:'fixture',script:'fixture' }, onCredential: async () => { dispatched++;return {ok:true}; } });
  assert.equal((await f.request(undefined, {Origin:'null'})).status, 403);
  assert.equal((await f.request({ state:'b'.repeat(64),googleIdToken:'fake' }, {Origin:f.localOrigin})).status, 403);
  assert.equal(dispatched, 0);
  assert.equal((await f.request(undefined, {Origin:f.localOrigin})).status, 200); assert.equal(dispatched, 1);
});

test('same-origin access remains disabled unless a local bridge is configured', async t => {
  const f = await fixture(t);
  assert.equal((await f.request(undefined, {Origin:f.localOrigin})).status, 403);
});

test('a malformed HTTP target cannot crash the callback server', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('', {}, 'http://[', 'GET')).status, 400);
  assert.equal((await f.request()).status, 200);
});

test('loopback requires the approved origin, exact host, valid state and bounded JSON', async t => {
  const f = await fixture(t);
  assert.equal((await f.request(undefined, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.request(undefined, { Host: 'localhost:4242' })).status, 403);
  assert.equal((await f.request('{')).status, 400);
  assert.equal((await f.request({ state: 'b'.repeat(64), googleIdToken: 'fake' })).status, 403);
  assert.equal((await f.request('x'.repeat(65537))).status, 413);
  assert.equal((await f.request(undefined, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await f.request(undefined, {}, '/unknown')).status, 404);
});

test('preflight permits the approved local-network callback without wildcard origins', async t => {
  const f = await fixture(t); const result = await f.request('', {}, '/callback', 'OPTIONS');
  assert.equal(result.status, 204); assert.equal(result.headers['access-control-allow-origin'], origin);
  assert.equal(result.headers['access-control-allow-private-network'], 'true');
});

test('callback waits for desktop confirmation and simultaneous duplicates dispatch only once', async t => {
  let confirm, count = 0;
  const f = await fixture(t, { onCredential: () => { count++; return new Promise(resolve => { confirm = resolve; }); } });
  const first = f.request();
  while (!confirm) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.request()).status, 409); assert.equal(count, 1);
  confirm({ ok: true }); const result = await first;
  assert.equal(result.status, 200); assert.equal(JSON.parse(result.body).ok, true);
});

test('desktop credential rejection never reports successful synchronization', async t => {
  const f = await fixture(t, { onCredential: async () => ({ ok: false, code: 'auth/invalid-credential' }) });
  const result = await f.request(); assert.equal(result.status, 401); assert.equal(JSON.parse(result.body).ok, false);
});

test('a hung desktop authentication is bounded and closes the callback listener', async t => {
  const f = await fixture(t, { credentialTimeoutMs: 15, onCredential: () => new Promise(() => {}) });
  assert.equal((await f.request()).status, 504);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.flow.server.listening, false);
});

test('web cancellation validates state and can interrupt a pending credential', async t => {
  let confirm, cancellations = 0;
  const f = await fixture(t, { onCredential: () => new Promise(resolve => { confirm = resolve; }), onCancel: () => cancellations++ });
  assert.equal((await f.request({ state: 'b'.repeat(64) }, {}, '/cancel')).status, 403);
  const pending = f.request(); while (!confirm) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.request({ state }, {}, '/cancel')).status, 200);
  assert.equal((await pending).status, 410); assert.equal(cancellations, 1); confirm({ ok: false });
});

test('an abandoned chooser expires and notifies the desktop', async t => {
  let expired = false; const f = await fixture(t, { sessionTimeoutMs: 15, onExpire: () => { expired = true; } });
  await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(expired, true); assert.equal(f.flow.server.listening, false);
});
