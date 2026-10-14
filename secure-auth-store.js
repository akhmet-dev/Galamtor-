'use strict';

const fs = require('node:fs');
const { writeJsonAtomic } = require('./profile-storage');

const MAX_STORED_BYTES = 256 * 1024;
const KEY_PATTERN = /^firebase:(?:authUser|persistence):[A-Za-z0-9._\-\[\]:]{1,480}$/;

function validKey(key) {
  return typeof key === 'string' && key.length <= 512 && KEY_PATTERN.test(key);
}

function createSecureAuthStore({ safeStorage, filePath, isEnabled, write = writeJsonAtomic, fileSystem = fs }) {
  if (!safeStorage || typeof filePath !== 'string' || typeof isEnabled !== 'function') {
    throw new TypeError('Invalid secure auth store configuration');
  }

  let queue = Promise.resolve();
  const serialize = task => {
    const next = queue.then(task, task);
    queue = next.catch(() => {});
    return next;
  };

  function encryptionAvailable() {
    try {
      if (!safeStorage.isEncryptionAvailable()) return false;
      if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text') return false;
      return true;
    } catch { return false; }
  }

  function requireAvailable() {
    if (!isEnabled() || !encryptionAvailable()) throw new Error('Secure sign-in storage is unavailable');
  }

  function readValues() {
    let document;
    try { document = JSON.parse(fileSystem.readFileSync(filePath, 'utf8')); }
    catch (error) {
      if (error?.code === 'ENOENT') return {};
      throw new Error('Secure sign-in data could not be read');
    }
    if (!document || document.version !== 1 || typeof document.encrypted !== 'string' ||
        document.encrypted.length > MAX_STORED_BYTES * 2) {
      throw new Error('Secure sign-in data is invalid');
    }
    try {
      const decrypted = safeStorage.decryptString(Buffer.from(document.encrypted, 'base64'));
      if (Buffer.byteLength(decrypted, 'utf8') > MAX_STORED_BYTES) throw new Error();
      const values = JSON.parse(decrypted);
      if (!values || typeof values !== 'object' || Array.isArray(values) ||
          Object.keys(values).some(key => !validKey(key))) throw new Error();
      return values;
    } catch { throw new Error('Secure sign-in data could not be decrypted'); }
  }

  function writeValues(values) {
    const plaintext = JSON.stringify(values);
    if (Buffer.byteLength(plaintext, 'utf8') > MAX_STORED_BYTES) throw new Error('Secure sign-in data is too large');
    const encrypted = safeStorage.encryptString(plaintext).toString('base64');
    write(filePath, { version: 1, encrypted }, { backup: false, isValid: value =>
      value?.version === 1 && typeof value.encrypted === 'string' });
    try { fileSystem.chmodSync(filePath, 0o600); } catch {}
  }

  return Object.freeze({
    isAvailable() { return encryptionAvailable(); },
    get(key) {
      if (!validKey(key)) return Promise.reject(new Error('Invalid secure sign-in key'));
      return serialize(() => { requireAvailable(); return readValues()[key] ?? null; });
    },
    set(key, value) {
      if (!validKey(key)) return Promise.reject(new Error('Invalid secure sign-in key'));
      return serialize(() => {
        requireAvailable();
        let serialized;
        try { serialized = JSON.stringify(value); } catch { throw new Error('Invalid secure sign-in value'); }
        if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > MAX_STORED_BYTES) {
          throw new Error('Secure sign-in data is too large');
        }
        const values = readValues();
        values[key] = JSON.parse(serialized);
        writeValues(values);
        return true;
      });
    },
    remove(key) {
      if (!validKey(key)) return Promise.reject(new Error('Invalid secure sign-in key'));
      return serialize(() => {
        requireAvailable();
        const values = readValues();
        delete values[key];
        if (Object.keys(values).length) writeValues(values);
        else fileSystem.rmSync(filePath, { force: true });
        return true;
      });
    },
    clear() {
      return serialize(() => { fileSystem.rmSync(filePath, { force: true }); return true; });
    }
  });
}

module.exports = { createSecureAuthStore, validKey, MAX_STORED_BYTES };
