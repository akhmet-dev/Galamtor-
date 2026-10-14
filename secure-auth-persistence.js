(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GalamtorSecureAuthPersistence = api;
})(globalThis, function createSecurePersistenceModule() {
  function createPersistence(api) {
    if (!api || typeof api.authPersistenceAvailable !== 'function' ||
        typeof api.getAuthPersistenceValue !== 'function' ||
        typeof api.setAuthPersistenceValue !== 'function' ||
        typeof api.removeAuthPersistenceValue !== 'function') {
      throw new TypeError('Secure auth persistence API is unavailable');
    }

    return class SecureAuthPersistence {
      static type = 'LOCAL';
      static _shouldAllowMigration = false;
      type = 'LOCAL';
      _shouldAllowMigration = false;
      async _isAvailable() {
        try { return await api.authPersistenceAvailable() === true; }
        catch { return false; }
      }
      _set(key, value) { return api.setAuthPersistenceValue(key, value); }
      _get(key) { return api.getAuthPersistenceValue(key); }
      _remove(key) { return api.removeAuthPersistenceValue(key); }
      _addListener() {}
      _removeListener() {}
    };
  }

  function createMemoryPersistence() {
    return class VolatileAuthPersistence {
      static type = 'NONE';
      type = 'NONE';
      storage = Object.create(null);
      async _isAvailable() { return true; }
      async _set(key, value) { this.storage[key] = value; }
      async _get(key) { return Object.hasOwn(this.storage, key) ? this.storage[key] : null; }
      async _remove(key) { delete this.storage[key]; }
      _addListener() {}
      _removeListener() {}
    };
  }

  function isActive(auth, persistence) {
    const active = auth?.persistenceManager?.persistence;
    return active === persistence || active?.constructor === persistence;
  }

  return Object.freeze({ createPersistence, createMemoryPersistence, isActive });
});
