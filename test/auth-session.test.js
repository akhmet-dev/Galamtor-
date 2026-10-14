const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthSession } = require('../auth-session');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('credential exchange waits for safe persistence setup before contacting Firebase', async t => {
  let ready;const f=fixture(t,{beforeSignIn:()=>new Promise(resolve=>{ready=resolve;})});await tick();f.session.start();
  const accepted=f.session.accept({requestId:'memory-ready'});await tick();assert.equal(f.requests.length,0);
  ready();await tick();assert.equal(f.requests.length,1);f.requests[0].resolve({uid:'qa-user'});
  assert.equal(await accepted,true);
});

test('failed persistence setup cannot dispatch or acknowledge successful authentication', async t => {
  const f=fixture(t,{beforeSignIn:async()=>{throw Object.assign(new Error('fixture'),{code:'auth/web-storage-unsupported'});}});await tick();f.session.start();
  assert.equal(await f.session.accept({requestId:'persistence-failed'}),false);assert.equal(f.requests.length,0);
  assert.deepEqual(f.complete,[['persistence-failed','auth/web-storage-unsupported']]);assert.equal(f.states.at(-1),'disconnected');
});

test('cancelling while persistence setup is pending never exchanges a late credential', async t => {
  let ready;const f=fixture(t,{beforeSignIn:()=>new Promise(resolve=>{ready=resolve;})});await tick();f.session.start();
  const accepted=f.session.accept({requestId:'persistence-cancelled'});await tick();f.session.cancel();ready();
  assert.equal(await accepted,false);assert.equal(f.requests.length,0);assert.equal(f.session.user,null);
});
function fixture(t, options = {}) {
  const requests = [], states = [], complete = [], errors = [];
  let observer;
  const auth = {
    currentUser: null,
    onAuthStateChanged(fn) { observer = fn; queueMicrotask(() => fn(null)); return () => {}; },
    signInWithCredential() { return new Promise((resolve, reject) => requests.push({ resolve(user) { auth.currentUser = user; observer(user); resolve({ user }); }, reject })); },
    async updateCurrentUser(user) { auth.currentUser = user; observer(user); },
    async signOut() { auth.currentUser = null; observer(null); }
  };
  const session = createAuthSession({ auth, credentialFromTokens: value => value,
    onState: state => states.push(state), onComplete: (...args) => complete.push(args), onError: code => errors.push(code), ...options });
  t.after(() => session.dispose());
  return { auth, session, requests, states, complete, errors };
}

test('Google credential is acknowledged only after Firebase confirms a user', async t => {
  const f = fixture(t); await tick();
  assert.equal(f.session.start(), true); assert.equal(f.session.start(), false);
  const accepted = f.session.accept({ requestId: 'request-1' });
  assert.deepEqual(f.complete, []);
  f.requests[0].resolve({ uid: 'qa-user' });
  assert.equal(await accepted, true);
  assert.equal(f.session.user.uid, 'qa-user');
  assert.deepEqual(f.complete, [['request-1', null]]);
  assert.equal(f.states.at(-1), 'connected');
});

test('provider failure acknowledges failure, clears busy state and permits retry', async t => {
  const f = fixture(t); await tick(); f.session.start();
  const accepted = f.session.accept({ requestId: 'failed' });
  f.requests[0].reject(Object.assign(new Error('fixture'), { code: 'auth/invalid-credential' }));
  assert.equal(await accepted, false);
  assert.deepEqual(f.complete, [['failed', 'auth/invalid-credential']]);
  assert.equal(f.states.at(-1), 'disconnected');
  assert.equal(f.session.start(), true);
});

test('cancel prevents a late Firebase result from silently logging in', async t => {
  const f = fixture(t); await tick(); f.session.start();
  const accepted = f.session.accept({ requestId: 'cancelled' });
  f.session.cancel(); f.requests[0].resolve({ uid: 'late-user' });
  assert.equal(await accepted, false); await tick();
  assert.equal(f.auth.currentUser, null); assert.equal(f.session.user, null);
  assert.deepEqual(f.complete, [['cancelled', 'auth/cancelled']]);
  assert.ok(!f.states.includes('connected'));
});

test('credential timeout supports retry and an older result cannot replace the new session', async t => {
  const f = fixture(t, { credentialTimeoutMs: 15 }); await tick(); f.session.start();
  assert.equal(await f.session.accept({ requestId: 'timeout' }), false);
  assert.equal(f.errors.at(-1), 'auth/timeout');
  f.session.start(); const next = f.session.accept({ requestId: 'next' });
  const newUser = { uid: 'new-user' }; f.requests[1].resolve(newUser); assert.equal(await next, true);
  f.requests[0].resolve({ uid: 'old-user' }); await tick();
  assert.equal(f.auth.currentUser, newUser); assert.equal(f.session.user, newUser);
});

test('chooser expiration and callback without an active attempt cannot connect', async t => {
  const f = fixture(t, { chooserTimeoutMs: 10 }); await tick(); f.session.start();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.states.at(-1), 'disconnected'); assert.equal(f.errors.at(-1), 'auth/timeout');
  assert.equal(await f.session.accept({ requestId: 'expired' }), false);
  assert.equal(f.requests.length, 0);
});

test('sign-out failure keeps the accepted session and can be retried', async t => {
  const f = fixture(t); await tick(); f.session.start();
  const accepted = f.session.accept({ requestId: 'initial' }); f.requests[0].resolve({ uid: 'qa-user' }); await accepted;
  const original = f.auth.signOut;
  f.auth.signOut = async () => { throw Object.assign(new Error('fixture'), { code: 'auth/network-request-failed' }); };
  assert.equal(await f.session.signOut(), false); assert.equal(f.session.user.uid, 'qa-user');
  f.auth.signOut = original; assert.equal(await f.session.signOut(), true); assert.equal(f.session.user, null);
});
