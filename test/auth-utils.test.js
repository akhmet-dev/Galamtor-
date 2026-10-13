const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAuthCallback } = require('../auth-utils');
const state = 'a'.repeat(64);

test('OAuth callback rejects null payloads and multibyte states without throwing', () => {
  assert.equal(validateAuthCallback(null, state).status, 400);
  assert.equal(validateAuthCallback([], state).status, 400);
  assert.equal(validateAuthCallback({ state: 'ө'.repeat(64), googleIdToken: 'token' }, state).status, 403);
  assert.equal(validateAuthCallback({ state: 'b'.repeat(64), googleIdToken: 'token' }, state).status, 403);
});

test('OAuth callback accepts a matching state and bounded credential strings only', () => {
  assert.equal(validateAuthCallback({ state, googleIdToken: {} }, state).status, 422);
  assert.equal(validateAuthCallback({ state, googleIdToken: 'x'.repeat(20000) }, state).status, 422);
  const result = validateAuthCallback({ state, googleAccessToken: 'token', uid: 'untrusted' }, state);
  assert.deepEqual(result, { status: 200, payload: { googleIdToken: null, googleAccessToken: 'token' } });
});
