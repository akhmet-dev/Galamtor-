'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { create, encryptValue, decryptValue } = require('../public/app/web-auth-store');
const webAuth = require('../public/app/web-auth');
const AUTH_KEY = 'firebase:authUser:synthetic-key:galamtor-web';
const tick = () => new Promise(resolve => setImmediate(resolve));
function memoryBackend() {
  let enabled = false, keyEntry = null, failDisable = false;
  const values = new Map();
  return {
    values,
    set failDisable(value) { failDisable = value; },
    async readMeta() { return { enabled, keyEntry }; },
    async getOrCreateKey(candidate) { if (!keyEntry) keyEntry = structuredClone(candidate); return keyEntry; },
    async enable() { enabled = true; },
    async disable() { if (failDisable) throw new Error('synthetic failure'); enabled = false; keyEntry = null; values.clear(); },
    async setValue(name, record, keyId) {
      if (!enabled || keyEntry?.id !== keyId) throw new Error('synthetic stale key');
      values.set(name, structuredClone(record));
    },
    async getValue(name) { return { enabled, keyEntry, record: values.get(name) || null }; },
    async removeValue(name) { values.delete(name); },
    async clearValues() { values.clear(); }
  };
}
test('browser auth defaults to memory and rejects persistence without opt-in', async () => {
  const backend = memoryBackend(), store = create({ crypto: webcrypto, backend });
  assert.deepEqual(await store.getRememberState(), { enabled: false, available: true });
  assert.equal(await store.authPersistenceAvailable(), false);
  await assert.rejects(store.setAuthPersistenceValue(AUTH_KEY, { refreshToken: 'synthetic-secret' }), /remember-disabled/);
  assert.equal(backend.values.size, 0);
});
test('opt-in encrypts auth data with a nonexportable key and restores across store instances', async () => {
  const backend = memoryBackend(), store = create({ crypto: webcrypto, backend });
  await store.setRememberSignIn(true);
  const value = { uid: 'synthetic-user', refreshToken: 'synthetic-secret', stsTokenManager: { accessToken: 'synthetic-access' } };
  await store.setAuthPersistenceValue(AUTH_KEY, value);
  const snapshot = await backend.readMeta(), record = backend.values.get(AUTH_KEY);
  assert.equal(snapshot.keyEntry.key.extractable, false);
  await assert.rejects(webcrypto.subtle.exportKey('raw', snapshot.keyEntry.key));
  assert.equal(record.version, 1);
  assert.equal(record.iv.length, 12);
  assert.ok(!Buffer.from(record.ciphertext).includes(Buffer.from('synthetic-secret')));
  assert.ok(!Object.hasOwn(record, 'refreshToken'));
  const reopened = create({ crypto: webcrypto, backend });
  assert.equal(await reopened.authPersistenceAvailable(), true);
  assert.deepEqual(await reopened.getAuthPersistenceValue(AUTH_KEY), value);
});
test('authenticated encryption rejects corruption and swapping ciphertext between auth keys', async () => {
  const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const record = await encryptValue(webcrypto, key, AUTH_KEY, { refreshToken: 'synthetic-secret' });
  await assert.rejects(decryptValue(webcrypto, key, 'firebase:authUser:other:galamtor-web', record));
  new Uint8Array(record.ciphertext)[0] ^= 1;
  await assert.rejects(decryptValue(webcrypto, key, AUTH_KEY, record));
});
test('turning remember off erases encrypted auth records and the encryption key', async () => {
  const backend = memoryBackend(), store = create({ crypto: webcrypto, backend });
  await store.setRememberSignIn(true); await store.setAuthPersistenceValue(AUTH_KEY, { refreshToken: 'synthetic-secret' });
  await store.setRememberSignIn(false);
  assert.equal(backend.values.size, 0);
  assert.deepEqual(await backend.readMeta(), { enabled: false, keyEntry: null });
  assert.equal(await store.getAuthPersistenceValue(AUTH_KEY), null);
});
test('failed remember disabling retains the saved state and reports failure', async () => {
  const backend = memoryBackend(), store = create({ crypto: webcrypto, backend });
  await store.setRememberSignIn(true); await store.setAuthPersistenceValue(AUTH_KEY, { uid: 'synthetic-user' });
  backend.failDisable = true;
  await assert.rejects(store.setRememberSignIn(false));
  assert.equal((await store.getRememberState()).enabled, true);
  assert.deepEqual(await store.getAuthPersistenceValue(AUTH_KEY), { uid: 'synthetic-user' });
});
test('unavailable WebCrypto does not permit remember mode', async () => {
  const store = create({ crypto: {}, backend: memoryBackend() });
  assert.deepEqual(await store.getRememberState(), { enabled: false, available: false });
  await assert.rejects(store.setRememberSignIn(true), /unavailable/);
});
function authFixture(options = {}) {
  let observer, initialized = false, nextSignOutFailure = false;
  const requests = [], writes = [], states = [], writeRequests = [], cloudWrites = [];
  const backend = memoryBackend(), store = create({ crypto: webcrypto, backend });
  const auth = {
    currentUser: null,
    _delegate: {
      persistenceManager: { persistence: null },
      async authStateReady() {},
      async setPersistence(Persistence) {
        const persistence = new Persistence();
        if (!await persistence._isAvailable()) throw new Error('synthetic unavailable');
        if (auth.currentUser) await persistence._set(AUTH_KEY, auth.currentUser);
        const old = this.persistenceManager.persistence;
        if (old && old !== persistence) await old._remove(AUTH_KEY);
        this.persistenceManager.persistence = persistence;
      }
    },
    onAuthStateChanged(fn) { observer = fn; queueMicrotask(() => fn(auth.currentUser)); return () => {}; },
    signInWithPopup() {
      return new Promise((resolve, reject) => requests.push({ reject, async resolve(user) {
        auth.currentUser = user;
        await auth._delegate.persistenceManager.persistence._set(AUTH_KEY, user);
        observer?.(user); resolve({ user });
      } }));
    },
    async updateCurrentUser(user) {
      auth.currentUser = user;
      await auth._delegate.persistenceManager.persistence._set(AUTH_KEY, user);
      observer?.(user);
    },
    async signOut() {
      if (nextSignOutFailure) { nextSignOutFailure = false; throw new Error('synthetic sign-out failure'); }
      auth.currentUser = null;
      await auth._delegate.persistenceManager.persistence._remove(AUTH_KEY); observer?.(null);
    }
  };
  const provider = {
    isInitialized: () => initialized,
    initialize(settings) {
      initialized = true;
      auth._delegate.persistenceManager.persistence = new settings.options.persistence[0]();
      return auth._delegate;
    }
  };
  const firestore = { collection(name) { return { doc(uid) { return { collection(group) { return { doc(document) { return {
    async set(stats, settings) {
      const snapshot = { name, uid, group, document, stats, settings };
      writes.push(snapshot);
      if (options.writeFailure) throw new Error('synthetic sync failure');
      if (options.delayWrites) return new Promise((resolve, reject) => writeRequests.push({ reject,
        resolve() { cloudWrites.push(snapshot); resolve(); } }));
      cloudWrites.push(snapshot);
    }
  }; } }; } }; } }; } };
  const app = { name: 'galamtor-web', _delegate: { container: { getProvider: () => provider } },
    auth() { if (!initialized) provider.initialize({ options: {} }); return auth; }, firestore: () => firestore };
  const sdk = { apps: [], initializeApp() { return app; }, auth: { GoogleAuthProvider: class { setCustomParameters() {} } },
    firestore: { FieldValue: { serverTimestamp: () => 'synthetic-server-time' } } };
  const controller = webAuth.create({ firebase: sdk, store, onState: state => states.push(state), ...options });
  return { controller, auth, store, backend, requests, writes, states, writeRequests, cloudWrites,
    failSignOut() { nextSignOutFailure = true; } };
}
test('web login opens popup synchronously after ready and failures allow retry without redirect', async () => {
  const f = authFixture(); await f.controller.ready;
  assert.equal(f.controller.getState().remember, false);
  const first = f.controller.login(); assert.equal(f.requests.length, 1);
  f.requests[0].reject(Object.assign(new Error('must not expose synthetic-email or token'), { code: 'auth/popup-blocked' }));
  assert.equal(await first, false);
  assert.equal(f.controller.getState().status, 'error');
  assert.ok(!JSON.stringify(f.states).includes('synthetic-email'));
  const second = f.controller.login(); assert.equal(f.requests.length, 2);
  await f.requests[1].resolve({ uid: 'synthetic-user', displayName: 'QA' });
  assert.equal(await second, true); assert.equal(f.controller.getState().status, 'connected');
});
test('cancelled popup result cannot silently reconnect and timeout permits retry', async () => {
  const f = authFixture({ popupTimeoutMs: 15 }); await f.controller.ready;
  const cancelled = f.controller.login(); f.controller.cancelLogin();
  await f.requests[0].resolve({ uid: 'late-user' }); assert.equal(await cancelled, false); await tick();
  assert.equal(f.auth.currentUser, null); assert.equal(f.controller.getState().status, 'idle');
  assert.equal(await f.controller.login(), false); assert.equal(f.controller.getState().status, 'error');
  const retry = f.controller.login(); await f.requests[2].resolve({ uid: 'new-user' }); assert.equal(await retry, true);
  await f.requests[1].resolve({ uid: 'stale-user' }); await tick();
  assert.equal(f.auth.currentUser.uid, 'new-user');
});
test('web remember toggle stores encrypted session, disabling erases it, and sign-out clears saved auth', async () => {
  const f = authFixture(); await f.controller.ready;
  const login = f.controller.login(); await f.requests[0].resolve({ uid: 'synthetic-user', refreshToken: 'synthetic-secret' }); await login;
  assert.equal(await f.controller.setRemember(true), true);
  assert.equal(f.controller.getState().remember, true); assert.equal(f.backend.values.size, 1);
  assert.equal(await f.controller.setRemember(false), true);
  assert.equal(f.controller.getState().remember, false); assert.equal(f.backend.values.size, 0);
  assert.equal(f.auth.currentUser.uid, 'synthetic-user');
  assert.equal(await f.controller.setRemember(true), true);
  assert.equal(await f.controller.signOut(), true); assert.equal(f.backend.values.size, 0);
  assert.equal(f.controller.getState().status, 'idle');
});
test('failed web remember disabling and failed sign-out are visible and retryable', async () => {
  const f = authFixture(); await f.controller.ready;
  const login = f.controller.login(); await f.requests[0].resolve({ uid: 'synthetic-user' }); await login;
  await f.controller.setRemember(true); f.backend.failDisable = true;
  assert.equal(await f.controller.setRemember(false), false); assert.equal(f.controller.getState().remember, true);
  f.backend.failDisable = false; f.failSignOut(); assert.equal(await f.controller.signOut(), false);
  assert.equal(f.controller.getState().status, 'error'); assert.equal(f.auth.currentUser.uid, 'synthetic-user');
  assert.equal(f.controller.getState().signedIn, true);
  assert.equal(f.states.at(-1).signedIn, true);
  assert.equal(await f.controller.signOut(), true);
  assert.equal(f.controller.getState().signedIn, false);
});
test('sync writes only aggregate counts to the existing user profile stats document', async () => {
  const f = authFixture(); await f.controller.ready;
  assert.equal(await f.controller.syncStats({ openTabsCount: 1 }), false);
  const login = f.controller.login(); await f.requests[0].resolve({ uid: 'synthetic-user', displayName: 'QA' }); await login;
  assert.equal(await f.controller.syncStats({ openTabsCount: 2.7, pinnedTabsCount: -1, vibesCount: 3, registrationDate: '2026-10-14', url: 'secret page', chat: 'private message' }), true);
  assert.deepEqual(f.writes[0], { name: 'users', uid: 'synthetic-user', group: 'profileData', document: 'stats', settings: { merge: true },
    stats: { openTabsCount: 2, pinnedTabsCount: 0, vibesCount: 3, registrationDate: '2026-10-14', lastUpdated: 'synthetic-server-time' } });
  assert.equal(f.controller.getState().syncStatus, 'saved');
});
test('sync failure is reported without provider text or identity data', async () => {
  const f = authFixture({ writeFailure: true }); await f.controller.ready;
  const login = f.controller.login(); await f.requests[0].resolve({ uid: 'synthetic-user' }); await login;
  assert.equal(await f.controller.syncStats({}), false); assert.equal(f.controller.getState().syncStatus, 'error');
  assert.ok(!JSON.stringify(f.states).includes('synthetic-user'));
});
test('stats queue serializes writes, discards intermediate snapshots, and keeps the newest cloud counts', async () => {
  const f = authFixture({ delayWrites: true }); await f.controller.ready;
  const login = f.controller.login(); await f.requests[0].resolve({ uid: 'synthetic-user' }); await login;
  const first = f.controller.syncStats({ openTabsCount: 1, url: 'private-url-first' }); await tick();
  assert.equal(f.writes.length, 1);
  const intermediate = f.controller.syncStats({ openTabsCount: 2, url: 'private-url-intermediate' }); await tick();
  const latest = f.controller.syncStats({ openTabsCount: 3, url: 'private-url-latest', chat: 'private-chat' }); await tick();
  assert.equal(await intermediate, false);
  assert.equal(f.writes.length, 1, 'second network write waits for the first');
  f.writeRequests[0].resolve(); assert.equal(await first, true); await tick();
  assert.equal(f.writes.length, 2); assert.equal(f.writes[1].stats.openTabsCount, 3);
  f.writeRequests[1].resolve(); assert.equal(await latest, true);
  assert.deepEqual(f.cloudWrites.map(write => write.stats.openTabsCount), [1, 3]);
  assert.equal(f.controller.getState().syncStatus, 'saved');
  assert.ok(!JSON.stringify(f.writes).includes('private-url'));
  assert.ok(!JSON.stringify(f.writes).includes('private-chat'));
});
test('sign-out invalidates queued stats and a new session never dispatches an old snapshot', async () => {
  const f = authFixture({ delayWrites: true }); await f.controller.ready;
  const login = f.controller.login(); await f.requests[0].resolve({ uid: 'first-user' }); await login;
  const first = f.controller.syncStats({ openTabsCount: 1 }); await tick();
  const oldQueued = f.controller.syncStats({ openTabsCount: 2, url: 'private-url' }); await tick();
  assert.equal(await f.controller.signOut(), true); assert.equal(await oldQueued, false);
  const nextLogin = f.controller.login(); await f.requests[1].resolve({ uid: 'second-user' }); await nextLogin;
  const newQueued = f.controller.syncStats({ openTabsCount: 9 }); await tick();
  assert.equal(f.writes.length, 1);
  f.writeRequests[0].resolve(); assert.equal(await first, false); await tick();
  assert.equal(f.writes.length, 2); assert.equal(f.writes[1].uid, 'second-user');
  assert.equal(f.writes[1].stats.openTabsCount, 9);
  f.writeRequests[1].resolve(); assert.equal(await newQueued, true);
  assert.ok(!JSON.stringify(f.writes).includes('private-url'));
});
test('timed-out stats write cannot complete after and overwrite the next queued snapshot', async () => {
  const f = authFixture({ delayWrites: true, syncTimeoutMs: 15 }); await f.controller.ready;
  const login = f.controller.login(); await f.requests[0].resolve({ uid: 'synthetic-user' }); await login;
  const first = f.controller.syncStats({ openTabsCount: 1 }); await tick();
  const latest = f.controller.syncStats({ openTabsCount: 8 }); await tick();
  assert.equal(await first, false); assert.equal(f.controller.getState().syncStatus, 'error');
  assert.equal(f.writes.length, 1, 'timeout does not permit overlapping uncancellable Firestore writes');
  f.writeRequests[0].resolve(); await tick();
  assert.equal(f.writes.length, 2); assert.equal(f.writes[1].stats.openTabsCount, 8);
  f.writeRequests[1].resolve(); assert.equal(await latest, true);
  assert.equal(f.cloudWrites.at(-1).stats.openTabsCount, 8);
});
test('a snapshot queued immediately after the last completion is not stranded during drain cleanup', async () => {
  const f = authFixture(); await f.controller.ready;
  const login = f.controller.login(); await f.requests[0].resolve({ uid: 'synthetic-user' }); await login;
  assert.equal(await f.controller.syncStats({ openTabsCount: 1 }), true);
  const next = f.controller.syncStats({ openTabsCount: 2 });
  let timer;
  const deadline = new Promise(resolve => { timer = setTimeout(() => resolve('stranded'), 100); });
  assert.equal(await Promise.race([next, deadline]), true); clearTimeout(timer);
  assert.equal(f.cloudWrites.at(-1).stats.openTabsCount, 2);
});
