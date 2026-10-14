(function exposeWebAuthStore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GalamtorWebAuthStore = api;
})(globalThis, function createWebAuthStoreModule() {
  const DATABASE_NAME = 'galamtor-web-auth-v1';
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  function failure(code) { return Object.assign(new Error(code), { code }); }
  function validKey(value) {
    return typeof value === 'string' && value.startsWith('firebase:authUser:') && value.length <= 1024;
  }
  async function encryptValue(crypto, key, name, value) {
    if (!validKey(name)) throw failure('storage/invalid-key');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const contents = encoder.encode(JSON.stringify(value));
    if (contents.byteLength > 1024 * 1024) throw failure('storage/value-too-large');
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(name) }, key, contents);
    return { version: 1, iv, ciphertext };
  }
  async function decryptValue(crypto, key, name, record) {
    if (!validKey(name) || record?.version !== 1 || !(record.iv instanceof Uint8Array) || record.iv.length !== 12 || !(record.ciphertext instanceof ArrayBuffer)) {
      throw failure('storage/invalid-record');
    }
    const contents = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv, additionalData: encoder.encode(name) }, key, record.ciphertext);
    return JSON.parse(decoder.decode(contents));
  }
  function createIndexedBackend(indexedDB, name) {
    let database;
    const ready = new Promise((resolve, reject) => {
      if (!indexedDB?.open) { reject(failure('storage/unavailable')); return; }
      const request = indexedDB.open(name, 1);
      const timer = setTimeout(() => reject(failure('storage/timeout')), 5000);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('values')) db.createObjectStore('values');
      };
      request.onerror = () => { clearTimeout(timer); reject(failure('storage/unavailable')); };
      request.onblocked = () => { clearTimeout(timer); reject(failure('storage/blocked')); };
      request.onsuccess = () => {
        clearTimeout(timer); database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
    });
    // Capability checks may be postponed until auth is initialized.
    ready.catch(() => {});
    async function transaction(stores, mode, operation) {
      const db = await ready;
      return new Promise((resolve, reject) => {
        let value, tx;
        try {
          tx = db.transaction(stores, mode);
          tx.oncomplete = () => resolve(value);
          tx.onerror = tx.onabort = () => reject(failure('storage/operation-failed'));
          operation(tx, result => { value = result; });
        } catch { reject(failure('storage/operation-failed')); }
      });
    }
    function readMeta(tx, done) {
      const meta = tx.objectStore('meta');
      const enabled = meta.get('remember');
      const key = meta.get('encryption-key');
      let received = 0;
      const finish = () => { if (++received === 2) done({ enabled: enabled.result === true, keyEntry: key.result || null }); };
      enabled.onsuccess = finish; key.onsuccess = finish;
    }
    return {
      readMeta: () => transaction(['meta'], 'readonly', (tx, done) => readMeta(tx, done)),
      getOrCreateKey: candidate => transaction(['meta'], 'readwrite', (tx, done) => {
        const store = tx.objectStore('meta'), request = store.get('encryption-key');
        request.onsuccess = () => {
          if (!request.result) store.put(candidate, 'encryption-key');
          done(request.result || candidate);
        };
      }),
      enable: () => transaction(['meta'], 'readwrite', tx => tx.objectStore('meta').put(true, 'remember')),
      disable: () => transaction(['meta', 'values'], 'readwrite', tx => {
        tx.objectStore('meta').put(false, 'remember');
        tx.objectStore('meta').delete('encryption-key');
        tx.objectStore('values').clear();
      }),
      setValue: (name, record, keyId) => transaction(['meta', 'values'], 'readwrite', (tx, done) => readMeta(tx, snapshot => {
        if (!snapshot.enabled || snapshot.keyEntry?.id !== keyId) { tx.abort(); return; }
        tx.objectStore('values').put(record, name); done(true);
      })),
      getValue: name => transaction(['meta', 'values'], 'readonly', (tx, done) => {
        const request = tx.objectStore('values').get(name);
        let snapshot, loaded = false;
        const finish = () => { if (snapshot && loaded) done({ ...snapshot, record: request.result || null }); };
        request.onsuccess = () => { loaded = true; finish(); };
        readMeta(tx, result => { snapshot = result; finish(); });
      }),
      removeValue: name => transaction(['values'], 'readwrite', tx => tx.objectStore('values').delete(name)),
      clearValues: () => transaction(['values'], 'readwrite', tx => tx.objectStore('values').clear())
    };
  }
  function create(options = {}) {
    const crypto = options.crypto || globalThis.crypto;
    const backend = options.backend || createIndexedBackend(options.indexedDB || globalThis.indexedDB, options.databaseName || DATABASE_NAME);
    let capability, queue = Promise.resolve();
    const serial = operation => {
      const result = queue.then(operation);
      queue = result.catch(() => {});
      return result;
    };
    async function ensureKey() {
      if (!crypto?.subtle || !crypto?.getRandomValues) throw failure('storage/crypto-unavailable');
      const snapshot = await backend.readMeta();
      if (snapshot.keyEntry?.key?.type === 'secret' && snapshot.keyEntry.key.extractable === false) return snapshot.keyEntry;
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
      const entry = await backend.getOrCreateKey({ id, key });
      if (entry.key?.extractable !== false) throw failure('storage/invalid-key');
      return entry;
    }
    async function isCapable() {
      if (!capability) capability = ensureKey().then(async entry => {
        const name = 'firebase:authUser:capability:galamtor-web';
        const record = await encryptValue(crypto, entry.key, name, { probe: true });
        if ((await decryptValue(crypto, entry.key, name, record)).probe !== true) throw failure('storage/crypto-unavailable');
        return true;
      }).catch(() => { capability = null; return false; });
      return capability;
    }
    return {
      async getRememberState() {
        try {
          const available = await isCapable();
          const snapshot = await backend.readMeta();
          return { enabled: snapshot.enabled, available };
        } catch { return { enabled: false, available: false }; }
      },
      setRememberSignIn: enabled => serial(async () => {
        if (typeof enabled !== 'boolean') throw failure('storage/invalid-preference');
        if (enabled) {
          if (!await isCapable()) throw failure('storage/unavailable');
          await ensureKey(); await backend.enable();
        } else {
          await backend.disable(); capability = null;
        }
        return { ok: true, enabled, available: true };
      }),
      async authPersistenceAvailable() {
        const state = await this.getRememberState();
        return state.enabled && state.available;
      },
      setAuthPersistenceValue: (name, value) => serial(async () => {
        const snapshot = await backend.readMeta();
        if (!snapshot.enabled) throw failure('storage/remember-disabled');
        const entry = await ensureKey();
        const record = await encryptValue(crypto, entry.key, name, value);
        await backend.setValue(name, record, entry.id);
        return true;
      }),
      async getAuthPersistenceValue(name) {
        if (!validKey(name)) throw failure('storage/invalid-key');
        const snapshot = await backend.getValue(name);
        if (!snapshot.enabled || !snapshot.record) return null;
        if (!snapshot.keyEntry?.key) throw failure('storage/missing-key');
        return decryptValue(crypto, snapshot.keyEntry.key, name, snapshot.record);
      },
      removeAuthPersistenceValue: name => serial(async () => {
        if (!validKey(name)) throw failure('storage/invalid-key');
        await backend.removeValue(name); return true;
      }),
      clearAuthValues: () => serial(async () => { await backend.clearValues(); return true; })
    };
  }
  return Object.freeze({ create, encryptValue, decryptValue });
});
