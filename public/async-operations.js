(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GalamtorAsync = api;
})(globalThis, function () {
  function withTimeout(operation, milliseconds, code = 'operation/timeout') {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), milliseconds);
      Promise.resolve(operation).then(resolve, reject).finally(() => clearTimeout(timer));
    });
  }

  // Only the latest waiting snapshot matters. A failed write stops the drain;
  // the next explicit update/retry starts it again instead of looping offline.
  function createLatestWriter({ write, onState = () => {}, timeoutMs = 10000 }) {
    let latest = null, running = null;
    async function drain() {
      while (latest !== null) {
        const value = latest;
        latest = null;
        onState('saving');
        try {
          await withTimeout(Promise.resolve().then(() => write(value)), timeoutMs, 'sync/timeout');
          onState('saved');
        } catch (error) {
          onState('error', error?.code || 'sync/failed');
          latest = null;
          return false;
        }
      }
      return true;
    }
    return {
      update(value) {
        latest = value;
        if (!running) running = drain().finally(() => { running = null; });
        return running;
      }
    };
  }
  return { withTimeout, createLatestWriter };
});
