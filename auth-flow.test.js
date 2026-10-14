const test = require('node:test');
const assert = require('node:assert/strict');
const flow = require('./public/auth-flow');
const firebase = require('firebase/compat/app');
require('firebase/compat/auth');
const GoogleAuthProvider = firebase.auth.GoogleAuthProvider;

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

const state = 'a'.repeat(64);

test('reads real Firebase compat OAuth credentials where the modular extractor returns null', () => {
  const credential = GoogleAuthProvider.credential('qa-google-id', 'qa-google-access');
  const result = { operationType: 'signIn', user: {}, credential, additionalUserInfo: {} };
  assert.equal(GoogleAuthProvider.credentialFromResult(result), null);
  assert.deepEqual(flow.extractGoogleTokens(result, GoogleAuthProvider), {
    googleIdToken: 'qa-google-id', googleAccessToken: 'qa-google-access'
  });
});

test('supports Google access-token-only and ID-token-only compat credentials', () => {
  for (const [googleIdToken, googleAccessToken] of [['qa-google-id', null], [null, 'qa-google-access']]) {
    const credential = GoogleAuthProvider.credential(googleIdToken, googleAccessToken);
    assert.deepEqual(flow.extractGoogleTokens({ credential }, GoogleAuthProvider), { googleIdToken, googleAccessToken });
  }
});

test('supports a modular result using the actual Firebase SDK extractor', () => {
  const result = { _tokenResponse: { oauthIdToken: 'qa-google-id', oauthAccessToken: 'qa-google-access' } };
  assert.deepEqual(flow.extractGoogleTokens(result, GoogleAuthProvider), {
    googleIdToken: 'qa-google-id', googleAccessToken: 'qa-google-access'
  });
});

test('rejects missing, non-Google and malformed credentials without requesting a Firebase user token', () => {
  const user = { getIdToken() { assert.fail('Firebase ID token must not be substituted for a Google token'); } };
  for (const result of [null, {}, { user, credential: null },
    { credential: { providerId: 'github.com', accessToken: 'qa-other-provider' } },
    { credential: { providerId: 'google.com', idToken: {}, accessToken: ' ' } },
    { credential: { providerId: 'google.com', idToken: 'x'.repeat(16385) } }]) {
    assert.equal(flow.extractGoogleTokens(result, GoogleAuthProvider), null);
  }
});

test('returns only bounded Google token fields, excluding account data', () => {
  const credential = { providerId: 'google.com', idToken: 'qa-google-id', accessToken: 'qa-google-access', email: 'qa@example.invalid', secret: 'qa-placeholder' };
  assert.deepEqual(Object.keys(flow.extractGoogleTokens({ credential }, GoogleAuthProvider)).sort(), ['googleAccessToken', 'googleIdToken']);
});

test('does not fall back to another response when an explicit compat credential is absent or rejected', () => {
  const provider = { credentialFromResult() { assert.fail('Compat result must use its own credential'); } };
  assert.equal(flow.extractGoogleTokens({ credential: null }, provider), null);
  assert.equal(flow.extractGoogleTokens({ credential: { providerId: 'github.com', accessToken: 'qa-other' } }, provider), null);
  assert.equal(flow.extractGoogleTokens({}, { credentialFromResult() { throw new Error('fixture'); } }), null);
});

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
