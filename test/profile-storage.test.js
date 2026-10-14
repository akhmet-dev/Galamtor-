const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readJsonFile, writeJsonAtomic } = require('../profile-storage');

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'galamtor-storage-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return path.join(folder, 'session.json');
}

test('a truncated primary recovers the previous complete session', t => {
  const file = fixture(t);
  writeJsonAtomic(file, [{ url: 'https://example.com' }], { isValid: Array.isArray });
  writeJsonAtomic(file, [{ url: 'https://example.org' }], { isValid: Array.isArray });
  fs.writeFileSync(file, '[{"url":');
  assert.deepEqual(readJsonFile(file, [], Array.isArray), [{ url: 'https://example.com' }]);
});

test('a wrong JSON shape uses a valid backup and an invalid write leaves data intact', t => {
  const file = fixture(t);
  writeJsonAtomic(file, ['saved'], { isValid: Array.isArray });
  assert.throws(() => writeJsonAtomic(file, {}, { isValid: Array.isArray }));
  assert.deepEqual(readJsonFile(file, [], Array.isArray), ['saved']);
  fs.writeFileSync(`${file}.bak`, '["backup"]');
  fs.writeFileSync(file, '{}');
  assert.deepEqual(readJsonFile(file, [], Array.isArray), ['backup']);
});

test('clearing history removes the recovery backup containing old history', t => {
  const file = fixture(t);
  writeJsonAtomic(file, ['old']);
  writeJsonAtomic(file, ['new']);
  writeJsonAtomic(file, [], { backup: false });
  assert.equal(fs.existsSync(`${file}.bak`), false);
  assert.deepEqual(readJsonFile(file, [], Array.isArray), []);
  assert.equal(fs.readdirSync(path.dirname(file)).some(name => name.includes('.tmp-')), false);
});

test('failed primary parsing never replaces a valid backup with corrupt data', t => {
  const file = fixture(t);
  writeJsonAtomic(file, ['old']);
  writeJsonAtomic(file, ['new']);
  fs.writeFileSync(file, '{');
  writeJsonAtomic(file, ['recovered']);
  fs.writeFileSync(file, '{');
  assert.deepEqual(readJsonFile(file, [], Array.isArray), ['old']);
});

test('an unreadable primary is never overwritten with fallback profile data', t => {
  const file = fixture(t);
  writeJsonAtomic(file, ['saved']);
  const read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', function (target, ...args) {
    if (target === file) throw Object.assign(new Error('QA permission failure'), { code: 'EACCES' });
    return read.call(this, target, ...args);
  });
  assert.throws(() => writeJsonAtomic(file, ['fallback']), { code: 'EACCES' });
  t.mock.restoreAll();
  assert.deepEqual(readJsonFile(file, []), ['saved']);
  assert.equal(fs.readdirSync(path.dirname(file)).some(name => name.includes('.tmp-')), false);
});
