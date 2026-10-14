(function exposeWebAuth(root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(root, node ? require('./web-auth-store') : root.GalamtorWebAuthStore,
    node ? require('../../secure-auth-persistence') : root.GalamtorSecureAuthPersistence);
  if (node) module.exports = api;
  else root.GalamtorWebAuth = api;
})(globalThis, function createWebAuthModule(root, storeModule, persistenceModule) {
  // Public Firebase app metadata, shared with the desktop app and auth hub.
  const firebaseConfig = Object.freeze({
    apiKey: 'AIzaSyDkEReqxwG0_IR12_lNFioKSPEdipqcPZ8',
    authDomain: 'galamtor-browser-974cc.firebaseapp.com',
    projectId: 'galamtor-browser-974cc',
    storageBucket: 'galamtor-browser-974cc.firebasestorage.app',
    messagingSenderId: '984286831243',
    appId: '1:984286831243:web:e694bfabf858f946eeaa8e'
  });
  const ERROR_MESSAGES = Object.freeze({
    'auth/popup-blocked': 'Google терезесі бұғатталды. Осы сайтқа popup рұқсатын беріп, қайта басыңыз.',
    'auth/popup-closed-by-user': 'Google терезесі жабылды. Қайта кіруге болады.',
    'auth/cancelled-popup-request': 'Алдыңғы Google терезесі жабылды. Қайта басыңыз.',
    'auth/network-request-failed': 'Желіге қосылмады. Интернетті тексеріп, қайталап көріңіз.',
    'auth/unauthorized-domain': 'Firebase бұл доменге кіруге рұқсат бермеді.',
    'auth/invalid-credential': 'Google кіруі расталмады. Қайталап көріңіз.',
    'auth/account-exists-with-different-credential': 'Бұл аккаунт басқа кіру әдісімен тіркелген.',
    'auth/timeout': 'Кіру уақыты аяқталды. Қайта бастауға болады.'
  });
  function safeName(value) {
    return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>]/g, '').trim().slice(0, 80) : '';
  }
  function normalizeStats(value) {
    const count = name => Number.isFinite(value?.[name]) ? Math.min(100000, Math.max(0, Math.floor(value[name]))) : 0;
    const candidate = value?.registrationDate;
    const date = typeof candidate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(candidate) && !Number.isNaN(Date.parse(`${candidate}T00:00:00Z`))
      ? candidate : new Date().toISOString().slice(0, 10);
    return { openTabsCount: count('openTabsCount'), pinnedTabsCount: count('pinnedTabsCount'), vibesCount: count('vibesCount'), registrationDate: date };
  }
  function timeout(operation, milliseconds, code = 'auth/timeout') {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), milliseconds);
      Promise.resolve(operation).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
  }
  function create(options = {}) {
    const sdk = options.firebase || root.firebase;
    const store = options.store || storeModule?.create();
    const onState = typeof options.onState === 'function' ? options.onState : () => {};
    const popupTimeoutMs = options.popupTimeoutMs || 60000;
    const operationTimeoutMs = options.operationTimeoutMs || 15000;
    let auth, db, provider, securePersistence, memoryPersistence, initialized = false, acceptedUser = null;
    let generation = 0, attempt = null, mutationBusy = false, recovering = false, recovery = Promise.resolve(), syncGeneration = 0;
    let syncLatest = null, syncRunning = null;
    const pending = new Set();
    const state = { status: 'loading', message: 'Google кіру модулі жүктелуде…', displayName: '', remember: false,
      rememberAvailable: false, syncStatus: 'idle', signedIn: false };
    function emit(patch = {}) {
      Object.assign(state, patch);
      state.displayName = safeName(acceptedUser?.displayName);
      state.signedIn = Boolean(acceptedUser || auth?.currentUser);
      try { onState({ ...state }); } catch {}
    }
    function invalidateSync() {
      syncGeneration++;
      if (syncLatest) { syncLatest.resolve(false); syncLatest = null; }
      state.syncStatus = 'idle';
    }
    function errorMessage(error) { return ERROR_MESSAGES[error?.code] || 'Google кіруі аяқталмады. Қайталап көріңіз.'; }
    function clearAttempt() {
      if (!attempt) return;
      clearTimeout(attempt.timer); const previous = attempt; attempt = null; previous.resolve(false);
    }
    function recoverAcceptedSession() {
      recovery = recovery.catch(() => {}).then(async () => {
        recovering = true;
        try {
          while (auth.currentUser !== acceptedUser) {
            const expected = acceptedUser;
            if (expected) await auth.updateCurrentUser(expected);
            else await auth.signOut();
            // A newer accepted login or explicit sign-out can finish while
            // Firebase is restoring. Reconcile against that newest session.
            if (expected === acceptedUser) break;
          }
        } catch { emit({ status: 'error', message: 'Кіруді тоқтату толық аяқталмады. «Шығу» батырмасын басыңыз.' }); }
        finally { recovering = false; }
      });
      return recovery;
    }
    const ready = (async () => {
      emit();
      try {
        if (!sdk?.initializeApp || !store || !persistenceModule) throw new Error('unavailable');
        const preference = await store.getRememberState();
        state.remember = preference.enabled === true && preference.available === true;
        state.rememberAvailable = preference.available === true;
        securePersistence = persistenceModule.createPersistence(store);
        memoryPersistence = persistenceModule.createMemoryPersistence();
        const appName = 'galamtor-web';
        const app = sdk.apps?.find(item => item.name === appName) || sdk.initializeApp(firebaseConfig, appName);
        const authProvider = app._delegate.container.getProvider('auth');
        if (!authProvider.isInitialized()) {
          const initialize = authProvider.initialize.bind(authProvider);
          authProvider.initialize = settings => initialize({ ...settings,
            options: { ...settings?.options, persistence: state.remember ? [securePersistence, memoryPersistence] : [memoryPersistence] } });
          try { auth = app.auth(); } finally { authProvider.initialize = initialize; }
        } else {
          auth = app.auth();
          await auth._delegate.setPersistence(state.remember ? securePersistence : memoryPersistence);
        }
        db = app.firestore();
        provider = new sdk.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await timeout(auth._delegate.authStateReady(), operationTimeoutMs);
        acceptedUser = auth.currentUser || null;
        initialized = true;
        auth.onAuthStateChanged(user => {
          if (pending.size || recovering || mutationBusy || attempt) return;
          if (acceptedUser?.uid !== user?.uid) invalidateSync();
          acceptedUser = user || null;
          emit({ status: user ? 'connected' : 'idle', message: user ? 'Google аккаунты қосылған' : 'Google аккаунты қосылмаған' });
        });
        emit({ status: acceptedUser ? 'connected' : 'idle', message: acceptedUser ? 'Google аккаунты қосылған' : 'Google аккаунты қосылмаған' });
        return true;
      } catch {
        emit({ status: 'error', message: 'Google кіру модулі іске қосылмады. Бетті қайта жүктеп көріңіз.' });
        return false;
      }
    })();
    function login() {
      if (!initialized || mutationBusy || attempt) return Promise.resolve(false);
      const id = ++generation;
      let resolveAttempt;
      const completion = new Promise(resolve => { resolveAttempt = resolve; });
      attempt = { id, resolve: resolveAttempt, timer: null };
      attempt.timer = setTimeout(() => {
        if (attempt?.id !== id) return;
        generation++; clearAttempt();
        emit({ status: 'error', message: ERROR_MESSAGES['auth/timeout'] });
      }, popupTimeoutMs);
      emit({ status: 'signing-in', message: 'Google терезесінде аккаунтты таңдаңыз…', syncStatus: 'idle' });
      pending.add(id);
      let raw;
      // This call stays in the original click event: no await/microtask before popup.
      try { raw = auth.signInWithPopup(provider); }
      catch (error) { raw = Promise.reject(error); }
      Promise.resolve(raw).then(async result => {
        if (generation !== id || attempt?.id !== id) { await recoverAcceptedSession(); return; }
        if (!result?.user) throw Object.assign(new Error('auth/invalid-credential'), { code: 'auth/invalid-credential' });
        await recovery;
        if (generation !== id || attempt?.id !== id) { await recoverAcceptedSession(); return; }
        // A prior cancelled popup may have restored an earlier session while
        // this popup was completing. Accept only the newest successful user.
        if (auth.currentUser !== result.user) await auth.updateCurrentUser(result.user);
        if (generation !== id || attempt?.id !== id) { await recoverAcceptedSession(); return; }
        if (acceptedUser?.uid !== result.user.uid) invalidateSync();
        acceptedUser = result.user;
        clearTimeout(attempt.timer); const current = attempt; attempt = null;
        emit({ status: 'connected', message: 'Google аккаунты қосылған' }); current.resolve(true);
      }).catch(error => {
        if (generation !== id || attempt?.id !== id) return;
        clearAttempt();
        emit({ status: 'error', message: errorMessage(error) });
      }).finally(() => pending.delete(id));
      return completion;
    }
    function cancelLogin() {
      generation++; clearAttempt();
      emit({ status: acceptedUser ? 'connected' : 'idle', message: 'Google кіруі тоқтатылды.' });
      return true;
    }
    async function signOut() {
      if (mutationBusy || !await ready) return false;
      mutationBusy = true; cancelLogin(); invalidateSync();
      try {
        await timeout(auth.signOut(), operationTimeoutMs);
        acceptedUser = null;
        await store.clearAuthValues();
        emit({ status: 'idle', message: 'Google аккаунтынан шықтыңыз.', syncStatus: 'idle' });
        return true;
      } catch {
        emit({ status: 'error', message: 'Аккаунттан шығу толық аяқталмады. Қайталап көріңіз.' });
        return false;
      } finally { mutationBusy = false; }
    }
    async function setRemember(enabled) {
      if (typeof enabled !== 'boolean' || mutationBusy || attempt || !await ready) return false;
      if (state.remember === enabled) return true;
      const previous = state.remember;
      mutationBusy = true;
      try {
        if (enabled) {
          await store.setRememberSignIn(true);
          await auth._delegate.setPersistence(securePersistence);
          if (!persistenceModule.isActive(auth._delegate, securePersistence)) throw new Error('inactive');
        } else {
          await auth._delegate.setPersistence(memoryPersistence);
          await store.setRememberSignIn(false);
        }
        state.remember = enabled;
        const preference = await store.getRememberState();
        state.rememberAvailable = preference.available;
        emit({ message: enabled ? 'Кіру осы браузерде шифрланып сақталады.' : 'Кіру осы ашық сессияда ғана сақталады.' });
        return true;
      } catch {
        let restored = false;
        try {
          if (previous) {
            await store.setRememberSignIn(true);
            await auth._delegate.setPersistence(securePersistence);
            restored = persistenceModule.isActive(auth._delegate, securePersistence);
          } else {
            await auth._delegate.setPersistence(memoryPersistence);
            await store.setRememberSignIn(false);
            restored = true;
          }
        } catch {}
        const preference = await store.getRememberState().catch(() => ({ enabled: previous, available: false }));
        state.remember = restored ? previous : preference.enabled === true;
        state.rememberAvailable = preference.available === true;
        emit({ message: enabled ? 'Кіруді сақтау қосылмады. Қайталап көріңіз.' : 'Сақталған кіруді өшіру аяқталмады. Қайталап көріңіз.' });
        return false;
      } finally { mutationBusy = false; }
    }
    function isCurrentSnapshot(snapshot) {
      return snapshot.generation === syncGeneration && acceptedUser?.uid === snapshot.userId && auth.currentUser?.uid === snapshot.userId;
    }
    async function drainStats() {
      while (syncLatest) {
        const snapshot = syncLatest;
        syncLatest = null;
        if (!isCurrentSnapshot(snapshot)) { snapshot.resolve(false); continue; }
        emit({ syncStatus: 'saving' });
        const stats = { ...snapshot.stats };
        const stamp = sdk.firestore?.FieldValue?.serverTimestamp;
        if (stamp) stats.lastUpdated = stamp();
        const write = Promise.resolve().then(() => {
          if (!isCurrentSnapshot(snapshot)) throw Object.assign(new Error('sync/session-changed'), { code: 'sync/session-changed' });
          return db.collection('users').doc(snapshot.userId).collection('profileData').doc('stats').set(stats, { merge: true });
        });
        try {
          await timeout(write, options.syncTimeoutMs || 10000, 'sync/timeout');
          const current = isCurrentSnapshot(snapshot);
          if (current && !syncLatest) emit({ syncStatus: 'saved' });
          snapshot.resolve(current);
        } catch (error) {
          if (isCurrentSnapshot(snapshot)) emit({ syncStatus: 'error' });
          snapshot.resolve(false);
          // Firestore cannot cancel a dispatched write. Even after displaying
          // a timeout, wait for it to settle before sending the next snapshot;
          // otherwise that late old write could overwrite the newest counts.
          if (error?.code === 'sync/timeout') await write.catch(() => {});
        }
      }
    }
    async function syncStats(value) {
      if (!await ready || !acceptedUser || mutationBusy) return false;
      const completion = new Promise(resolve => {
        if (syncLatest) syncLatest.resolve(false);
        syncLatest = { stats: normalizeStats(value), userId: acceptedUser.uid, generation: syncGeneration, resolve };
      });
      startStatsDrain();
      return completion;
    }
    function startStatsDrain() {
      if (syncRunning) return;
      syncRunning = drainStats().finally(() => {
        syncRunning = null;
        // A caller may enqueue in the microtask between the last snapshot's
        // resolution and this cleanup. Ensure that snapshot also gets a drain.
        if (syncLatest) startStatsDrain();
      });
    }
    return Object.freeze({ ready, login, cancelLogin, signOut, setRemember, syncStats,
      getState: () => ({ ...state, signedIn: Boolean(acceptedUser || auth?.currentUser) }) });
  }
  return Object.freeze({ create, normalizeStats, safeName });
});
