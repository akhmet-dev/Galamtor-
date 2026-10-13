const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSessionTabs, normalizeHistory, normalizeBookmarks, normalizeDownloads, validateProfileImport } = require('../browser-state');

test('session recovery retains the active home tab and filters private and privileged URLs', () => {
  const result = normalizeSessionTabs([
    { url: 'https://example.com', title: 'Example', isMuted: true },
    { url: 'https://private.example', isIncognito: true },
    { url: 'javascript:alert(1)' }, { url: 'data:text/html,secret' },
    { url: null, isHome: true, isActive: true }, null
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].isMuted, true);
  assert.equal(result[1].isActive, true);
  assert.equal(result[1].isHome, true);
  assert.equal(result[1].url, null);
});

test('legacy sessions recover with one active selection and tolerate malformed records', () => {
  assert.deepEqual(normalizeSessionTabs({ tabs: [] }), []);
  const result = normalizeSessionTabs([{ url: 'https://a.example', isActive: true }, { url: 'https://b.example', isActive: true }]);
  assert.equal(result.filter(entry => entry.isActive).length, 1);
  assert.equal(result[0].url, 'https://a.example/');
});

test('persisted list data is bounded, typed and limited to usable web URLs', () => {
  assert.deepEqual(normalizeHistory(null), []);
  const history = normalizeHistory([{ url: 'file:///private' }, { url: 'https://example.com', title: 7, timestamp: 'bad' }]);
  assert.equal(history.length, 1);
  assert.equal(typeof history[0].title, 'string');
  assert.equal(typeof history[0].timestamp, 'number');
  const bookmarks = normalizeBookmarks([{ url: 'https://example.com' }, { url: 'https://example.com/' }]);
  assert.equal(bookmarks.length, 1);
  assert.deepEqual(normalizeDownloads([{ filename: 'secret', savePath: '/tmp/secret', isIncognito: true }]), []);
});

test('profile import rejects invalid structures before applying any field', () => {
  assert.equal(validateProfileImport({ profile: { name: 'User', createdAt: 1 }, vibes: [] }), true);
  assert.equal(validateProfileImport({ profile: { name: 'User' }, vibes: {} }), false);
  assert.equal(validateProfileImport({ lock: { enabled: true, pinHash: 'bad', hiddenUrls: [] } }), false);
  assert.equal(validateProfileImport({ lock: { enabled: false, pinHash: '', hiddenUrls: ['javascript:alert(1)'] } }), false);
  assert.equal(validateProfileImport(null), false);
});

const { changeBookmark } = require('../browser-state');

test('bookmark edits preserve identity and time, refresh favicon only when URL changes', () => {
  const source = [{ id: 'fixed', title: 'Before', url: 'https://example.com', favicon: 'https://example.com/icon.png', createdAt: 123 }];
  const result = changeBookmark(source, { title: 'After', url: 'https://other.example', id: 'injected' }, 'fixed');
  assert.equal(result.ok, true);
  assert.deepEqual(result.bookmarks[0], { id: 'fixed', title: 'After', url: 'https://other.example/', favicon: '', createdAt: 123 });
  assert.equal(source[0].title, 'Before');
  assert.equal(changeBookmark(source, { title: 'Same', url: 'https://example.com/' }, 'fixed').bookmarks[0].favicon, source[0].favicon);
});

test('adding canonical variants updates one bookmark rather than duplicating it', () => {
  const result = changeBookmark([{ id: 'fixed', title: 'A', url: 'https://example.com', createdAt: 1 }], { title: 'B', url: 'https://example.com/' });
  assert.equal(result.bookmarks.length, 1);
  assert.equal(result.bookmarks[0].id, 'fixed');
  assert.equal(result.bookmarks[0].title, 'B');
});

test('editing rejects a URL collision or a deleted ID without losing any bookmark', () => {
  const source = [{ id: 'a', title: 'A', url: 'https://a.example' }, { id: 'b', title: 'B', url: 'https://b.example' }];
  assert.deepEqual(changeBookmark(source, { title: 'A', url: 'https://b.example/' }, 'a'), { ok: false, error: 'duplicate' });
  assert.deepEqual(changeBookmark(source, { title: 'A', url: 'https://a.example' }, 'missing'), { ok: false, error: 'missing' });
  assert.equal(source.length, 2);
});

test('bookmark mutations reject privileged URLs and plaintext credentials in URLs', () => {
  for (const url of ['javascript:alert(1)', 'file:///private', 'https://user:password@example.com', 'data:text/html,test']) {
    assert.deepEqual(changeBookmark([], { title: 'A', url }), { ok: false, error: 'invalid' });
  }
  for (const input of [null, [], { title: ' ', url: 'https://example.com' }]) {
    assert.deepEqual(changeBookmark([], input), { ok: false, error: 'invalid' });
  }
});
