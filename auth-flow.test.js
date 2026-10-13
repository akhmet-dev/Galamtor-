const test = require('node:test');
const assert = require('node:assert/strict');
const flow = require('./public/auth-flow');

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

const state = 'a'.repeat(64);

test('starts redirect only for an explicit login request with a valid state', () => {
  const storage = createStorage();
  assert.deepEqual(flow.resolveRedirect({ mode: 'login', state, hasResult: false, storage }), { action: 'start', state });
  assert.equal(storage.getItem(flow.LOGIN_STATE_KEY), state);
  assert.equal(storage.getItem(flow.REDIRECT_PENDING_KEY), state);
});

test('does not start OAuth when the auth page is opened without login parameters', () => {
  const storage = createStorage();
  assert.deepEqual(flow.resolveRedirect({ mode: null, state: null, hasResult: false, storage }), { action: 'idle', state: null });
  assert.equal(storage.getItem(flow.REDIRECT_PENDING_KEY), null);
});

test('after returning without a Firebase result, asks for a manual retry instead of redirecting again', () => {
  const storage = createStorage({
    [flow.LOGIN_STATE_KEY]: state,
    [flow.REDIRECT_PENDING_KEY]: state
  });
  assert.deepEqual(flow.resolveRedirect({ mode: null, state: null, hasResult: false, storage }), { action: 'returned-without-result', state });
  assert.equal(storage.getItem(flow.REDIRECT_PENDING_KEY), null);
  assert.equal(storage.getItem(flow.LOGIN_STATE_KEY), state);
  assert.deepEqual(flow.resolveRedirect({ mode: null, state: null, hasResult: false, storage }), { action: 'returned-without-result', state });
});

test('completes a successful redirect and preserves its CSRF state for the loopback callback', () => {
  const storage = createStorage({
    [flow.LOGIN_STATE_KEY]: state,
    [flow.REDIRECT_PENDING_KEY]: state
  });
  assert.deepEqual(flow.resolveRedirect({ mode: null, state: null, hasResult: true, storage }), { action: 'complete', state });
  assert.equal(storage.getItem(flow.REDIRECT_PENDING_KEY), null);
  assert.equal(storage.getItem(flow.LOGIN_STATE_KEY), state);
});

test('ignores malformed login state and clears both state keys after callback success', () => {
  const storage = createStorage();
  assert.deepEqual(flow.resolveRedirect({ mode: 'login', state: 'invalid', hasResult: false, storage }), { action: 'idle', state: null });
  flow.markRedirectPending(state, storage);
  flow.clearLogin(storage);
  assert.equal(storage.getItem(flow.LOGIN_STATE_KEY), null);
  assert.equal(storage.getItem(flow.REDIRECT_PENDING_KEY), null);
});

test('reloading the original login URL never restarts the same failed chooser', () => {
  const storage = createStorage();
  assert.equal(flow.resolveRedirect({ mode: 'login', state, hasResult: false, storage }).action, 'start');
  for (let i = 0; i < 5; i++) {
    assert.equal(flow.resolveRedirect({ mode: 'login', state, hasResult: false, storage }).action, 'returned-without-result');
  }
});

test('a new explicit login state replaces an abandoned attempt', () => {
  const storage = createStorage({ [flow.LOGIN_STATE_KEY]: state, [flow.REDIRECT_PENDING_KEY]: state });
  const next = 'b'.repeat(64);
  assert.deepEqual(flow.resolveRedirect({ mode: 'login', state: next, hasResult: false, storage }), { action: 'start', state: next });
  assert.equal(storage.getItem(flow.LOGIN_STATE_KEY), next);
});

test('unavailable browser storage reports a recoverable setup state without starting OAuth', () => {
  const storage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.deepEqual(flow.resolveRedirect({ mode: 'login', state, hasResult: false, storage }), { action: 'storage-unavailable', state: null });
  assert.equal(flow.markRedirectPending(state, storage), false);
  assert.doesNotThrow(() => flow.clearLogin(storage));
});
