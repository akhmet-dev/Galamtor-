(function expose(root, factory) {
  const asyncApi = typeof module === 'object' && module.exports ? require('./public/async-operations') : root.GalamtorAsync;
  const api = factory(asyncApi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GalamtorAuthSession = api;
})(globalThis, function ({ withTimeout }) {
  function createAuthSession({ auth, credentialFromTokens, onState = () => {}, onError = () => {}, onComplete = () => {}, onSuccess = () => {}, chooserTimeoutMs = 300000, credentialTimeoutMs = 30000 }) {
    let generation = 0, attempt = null, timer = null, acceptedUser = auth.currentUser || null, restoring = false;
    const pending = new Set();
    function emit(state) { onState(state, acceptedUser); }
    function clearTimer() { if (timer) clearTimeout(timer); timer = null; }
    async function restoreAccepted() {
      if (restoring || auth.currentUser === acceptedUser) return;
      restoring = true;
      try {
        if (acceptedUser) await auth.updateCurrentUser(acceptedUser);
        else await auth.signOut();
      } catch { onError('auth/session-recovery-failed'); }
      finally { restoring = false; }
    }
    const unsubscribe = auth.onAuthStateChanged(user => {
      if (pending.size || restoring) return;
      acceptedUser = user || null;
      if (!attempt) emit(user ? 'connected' : 'disconnected');
    });
    function cancel(code = 'auth/cancelled') {
      const old = attempt;
      attempt = null;
      generation++;
      clearTimer();
      if (old?.requestId) onComplete(old.requestId, code);
      emit(acceptedUser ? 'connected' : 'disconnected');
    }
    return {
      start() {
        if (attempt) return false;
        attempt = { id: ++generation, requestId: null };
        emit('connecting');
        timer = setTimeout(() => { cancel('auth/timeout'); onError('auth/timeout'); }, chooserTimeoutMs);
        return true;
      },
      cancel,
      fail(code) { cancel(code); onError(code); },
      get user() { return acceptedUser; },
      async accept(payload) {
        const current = attempt;
        const requestId = payload?.requestId;
        if (!current || current.requestId || typeof requestId !== 'string') {
          if (typeof requestId === 'string') onComplete(requestId, 'auth/cancelled');
          return false;
        }
        current.requestId = requestId;
        clearTimer();
        pending.add(current.id);
        let raw;
        try { raw = Promise.resolve(auth.signInWithCredential(credentialFromTokens(payload))); }
        catch (error) { raw = Promise.reject(error); }
        // Firebase has no credential-request cancellation API. A late result
        // must restore the last accepted session instead of signing in silently.
        raw.then(async () => {
          if (generation !== current.id) await restoreAccepted();
        }, () => {}).finally(() => pending.delete(current.id));
        try {
          const result = await withTimeout(raw, credentialTimeoutMs, 'auth/timeout');
          if (generation !== current.id || attempt !== current) return false;
          if (!result?.user) throw Object.assign(new Error('No user'), { code: 'auth/invalid-credential' });
          acceptedUser = result.user;
          attempt = null;
          emit('connected');
          onComplete(requestId, null);
          onSuccess(acceptedUser);
          return true;
        } catch (error) {
          if (generation !== current.id || attempt !== current) return false;
          cancel(error?.code || 'auth/failed');
          onError(error?.code || 'auth/failed');
          return false;
        }
      },
      async signOut() {
        cancel();
        try {
          await withTimeout(auth.signOut(), credentialTimeoutMs, 'auth/timeout');
          acceptedUser = null;
          emit('disconnected');
          return true;
        } catch (error) { onError(error?.code || 'auth/sign-out-failed'); return false; }
      },
      dispose() { cancel(); unsubscribe?.(); }
    };
  }
  return { createAuthSession };
});
