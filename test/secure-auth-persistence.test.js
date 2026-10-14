'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPersistence, isActive } = require('../secure-auth-persistence');

test('secure Firebase persistence delegates only to the protected main-process API', async () => {
  const calls = [];
  const api = {
    async authPersistenceAvailable() { calls.push(['available']); return true; },
    async getAuthPersistenceValue(key) { calls.push(['get', key]); return { refreshToken: 'synthetic' }; },
    async setAuthPersistenceValue(key, value) { calls.push(['set', key, value]); return true; },
    async removeAuthPersistenceValue(key) { calls.push(['remove', key]); return true; }
  };
  const Persistence = createPersistence(api);
  const persistence = new Persistence();
  assert.equal(Persistence.type, 'LOCAL');
  assert.equal(await persistence._isAvailable(), true);
  await persistence._set('firebase:authUser:qa-key:[DEFAULT]', { refreshToken: 'synthetic' });
  assert.deepEqual(await persistence._get('firebase:authUser:qa-key:[DEFAULT]'), { refreshToken: 'synthetic' });
  await persistence._remove('firebase:authUser:qa-key:[DEFAULT]');
  assert.deepEqual(calls.map(call => call[0]), ['available', 'set', 'get', 'remove']);
  const auth = { persistenceManager: { persistence } };
  assert.equal(isActive(auth, persistence), true);
  assert.equal(isActive(auth, {}), false);
});

test('secure Firebase persistence is unavailable if protected storage cannot be checked', async () => {
  const Persistence = createPersistence({
    async authPersistenceAvailable() { throw new Error('synthetic IPC failure'); },
    async getAuthPersistenceValue() {}, async setAuthPersistenceValue() {}, async removeAuthPersistenceValue() {}
  });
  assert.equal(await new Persistence()._isAvailable(), false);
});

test('volatile Firebase persistence has Firebase-compatible class semantics and isolated memory', async () => {
  const { createMemoryPersistence } = require('../secure-auth-persistence');
  const Persistence = createMemoryPersistence();
  const persistence = new Persistence();
  assert.equal(Persistence.type, 'NONE');
  await persistence._set('firebase:authUser:qa-key:[DEFAULT]', { uid: 'synthetic' });
  assert.deepEqual(await persistence._get('firebase:authUser:qa-key:[DEFAULT]'), { uid: 'synthetic' });
  await persistence._remove('firebase:authUser:qa-key:[DEFAULT]');
  assert.equal(await persistence._get('firebase:authUser:qa-key:[DEFAULT]'), null);
});
