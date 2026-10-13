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
    storage.setItem(LOGIN_STATE_KEY, state);
    storage.setItem(REDIRECT_PENDING_KEY, state);
    return true;
  }

  function clearRedirectPending(storage) {
    storage?.removeItem(REDIRECT_PENDING_KEY);
  }

  function clearLogin(storage) {
    storage?.removeItem(REDIRECT_PENDING_KEY);
    storage?.removeItem(LOGIN_STATE_KEY);
  }

  function resolveRedirect({ mode, state, hasResult, storage }) {
    if (!storage) return { action: 'idle', state: null };

    const storedState = storage.getItem(LOGIN_STATE_KEY);
    const pendingState = storage.getItem(REDIRECT_PENDING_KEY);

    if (hasResult) {
      clearRedirectPending(storage);
      const resolvedState = isValidState(storedState) ? storedState : state;
      return { action: 'complete', state: isValidState(resolvedState) ? resolvedState : null };
    }

    if (isValidState(pendingState)) {
      clearRedirectPending(storage);
      return { action: 'returned-without-result', state: pendingState };
    }

    if (mode === 'login' && isValidState(state)) {
      markRedirectPending(state, storage);
      return { action: 'start', state };
    }

    return { action: 'idle', state: null };
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
