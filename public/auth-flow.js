(function exposeAuthFlow(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GalamtorAuthFlow = api;
})(typeof globalThis === 'object' ? globalThis : this, function createAuthFlow() {
  const LOGIN_STATE_KEY = 'galamtor-login-state';
  const REDIRECT_PENDING_KEY = 'galamtor-oauth-pending';
  const STATE_PATTERN = /^[a-f0-9]{64}$/;

  function isValidState(state) {
    return typeof state === 'string' && STATE_PATTERN.test(state);
  }

  function markRedirectPending(state, storage) {
    if (!isValidState(state) || !storage) return false;
    try {
      storage.setItem(LOGIN_STATE_KEY, state);
      storage.setItem(REDIRECT_PENDING_KEY, state);
      return true;
    } catch { return false; }
  }

  function clearRedirectPending(storage) {
    try { storage?.removeItem(REDIRECT_PENDING_KEY); } catch {}
  }

  function clearLogin(storage) {
    try { storage?.removeItem(REDIRECT_PENDING_KEY); } catch {}
    try { storage?.removeItem(LOGIN_STATE_KEY); } catch {}
  }

  function resolveRedirect({ mode, state, hasResult, storage }) {
    if (!storage) return { action: mode === 'login' && isValidState(state) ? 'storage-unavailable' : 'idle', state: null };

    try {
      const storedState = storage.getItem(LOGIN_STATE_KEY);
      const pendingState = storage.getItem(REDIRECT_PENDING_KEY);

      // A new explicit request supersedes an abandoned request in the same tab.
      if (!hasResult && mode === 'login' && isValidState(state) && state !== storedState && state !== pendingState) {
        if (!markRedirectPending(state, storage)) return { action: 'storage-unavailable', state: null };
        return { action: 'start', state };
      }

      if (hasResult) {
        clearRedirectPending(storage);
        const resolvedState = isValidState(storedState) ? storedState : state;
        return { action: 'complete', state: isValidState(resolvedState) ? resolvedState : null };
      }

      if (isValidState(pendingState)) {
        clearRedirectPending(storage);
        return { action: 'returned-without-result', state: pendingState };
      }

      if (isValidState(storedState)) {
        return { action: 'returned-without-result', state: storedState };
      }

      if (mode === 'login' && isValidState(state)) {
        if (!markRedirectPending(state, storage)) return { action: 'storage-unavailable', state: null };
        return { action: 'start', state };
      }

      return { action: 'idle', state: null };
    } catch { return { action: 'storage-unavailable', state: null }; }
  }

  return {
    LOGIN_STATE_KEY,
    REDIRECT_PENDING_KEY,
    isValidState,
    markRedirectPending,
    clearRedirectPending,
    clearLogin,
    resolveRedirect
  };
});
