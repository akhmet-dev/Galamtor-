'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSecureAuthStore } = require('../secure-auth-store');

function makeFixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'galamtor-secure-auth-'));
  const filePath = path.join(directory, 'firebase-auth.secure.json');
  let enabled = options.enabled ?? true;
  const safeStorage = options.safeStorage || {
    isEncryptionAvailable: () => true,
    encryptString: plaintext => Buffer.from(`qa-cipher:${Buffer.from(plaintext, 'utf8').toString('base64')}`),
    decryptString: encrypted => {
      const value = encrypted.toString();
      if (!value.startsWith('qa-cipher:')) throw new Error('bad fixture cipher');
      return Buffer.from(value.slice('qa-cipher:'.length), 'base64').toString('utf8');
    }
  };
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { filePath, safeStorage, setEnabled(value) { enabled = value; },
    store: createSecureAuthStore({ safeStorage, filePath, isEnabled: () => enabled }) };
}

test('Firebase refresh-token material is encrypted at rest and removed on sign-out', async t => {
  const fixture = makeFixture(t);
  const key = 'firebase:authUser:qa-key:[DEFAULT]';
  const value = { uid: 'synthetic-user', stsTokenManager: { refreshToken: 'qa-plain-secret-sentinel' } };
  await fixture.store.set(key, value);
  const contents = fs.readFileSync(fixture.filePath, 'utf8');
  assert.equal(contents.includes('qa-plain-secret-sentinel'), false);
  assert.equal(contents.includes('refreshToken'), false);
  assert.deepEqual(await fixture.store.get(key), value);
  assert.equal(fs.statSync(fixture.filePath).mode & 0o777, 0o600);
  await fixture.store.remove(key);
  assert.equal(fs.existsSync(fixture.filePath), false);
});

test('secure auth store rejects writes unless the user enabled persistent sign-in', async t => {
  const fixture = makeFixture(t, { enabled: false });
  await assert.rejects(fixture.store.set('firebase:authUser:qa-key:[DEFAULT]', { uid: 'synthetic' }), /unavailable/);
  assert.equal(fs.existsSync(fixture.filePath), false);
});

test('secure auth store accepts only Firebase auth keys and bounded serializable values', async t => {
  const fixture = makeFixture(t);
  await assert.rejects(fixture.store.set('../../settings.json', { uid: 'synthetic' }), /Invalid secure sign-in key/);
  await assert.rejects(fixture.store.get('history'), /Invalid secure sign-in key/);
  const circular = {}; circular.self = circular;
  await assert.rejects(fixture.store.set('firebase:authUser:qa-key:[DEFAULT]', circular), /Invalid secure sign-in value/);
});

test('turning off persistent sign-in clears the encrypted store even when encryption is unavailable', async t => {
  const fixture = makeFixture(t);
  await fixture.store.set('firebase:authUser:qa-key:[DEFAULT]', { uid: 'synthetic' });
  fixture.safeStorage.isEncryptionAvailable = () => false;
  await fixture.store.clear();
  assert.equal(fs.existsSync(fixture.filePath), false);
});
