const test = require('node:test');
const assert = require('node:assert/strict');
const State = require('../public/app/web-state.js');
function storage() { const values = new Map(); return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), values }; }
test('web state accepts only safe web URLs and bounds profile/session preferences', () => {
  const state = State.normalize({ profile: { name: '<script>x</script>', createdAt: 'bad' }, tabs: [{ id: 'a', url: 'javascript:alert(1)' }, { id: 'b', url: 'https://example.com', title: 'Example' }, { id: 'b', url: null }], activeId: 'a', settings: { wallpaper: '../secret', dim: 900, widgets: { clock: false } }, bookmarks: [{ url: 'https://u:p@example.com', title: 'Secret' }], vibes: [{ id: 'bad', name: 'bad', color: 'url(x)' }] });
  assert.equal(state.tabs.length, 2); assert.notEqual(state.tabs[0].id, state.tabs[1].id); assert.equal(state.activeId, state.tabs[0].id);
  assert.equal(state.settings.wallpaper, 'alatau'); assert.equal(state.settings.dim, 85); assert.equal(state.settings.widgets.clock, false); assert.equal(state.bookmarks.length, 0);
  assert.ok(state.vibes.every(item => /^#[a-f0-9]{6}$/i.test(item.color)));
});
test('web repository restores favorites and tabs without credentials or unknown keys', () => {
  const local = storage(), repo = State.createRepository(local), state = State.defaults();
  state.tabs.push({ id: 'example', url: 'https://example.com/', title: 'Example' }); state.activeId = 'example';
  state.bookmarks = [{ id: 'fav', url: 'https://example.com', title: 'Favorite' }]; state.authToken = 'do-not-export';
  assert.equal(repo.save(state).ok, true);
  const restored = State.createRepository(local).load().state;
  assert.equal(restored.activeId, 'example'); assert.equal(restored.bookmarks.length, 1); assert.ok(!local.values.get(State.KEY).includes('do-not-export'));
});
test('disabled session restoration keeps favorites while starting on a new home tab', () => {
  const local = storage(), state = State.defaults(); state.tabs = [{ id: 'saved', url: 'https://example.com/', title: 'Example' }]; state.activeId = 'saved'; state.settings.restoreSession = false;
  state.bookmarks = [{ url: 'https://example.com/', title: 'Favorite' }]; State.createRepository(local).save(state);
  const restored = State.createRepository(local).load().state; assert.equal(restored.tabs.length, 1); assert.equal(restored.tabs[0].url, null); assert.equal(restored.bookmarks.length, 1);
});
test('corrupt workspace is preserved until the user explicitly resets it', () => {
  const local = storage(); local.setItem(State.KEY, '{corrupt'); const repo = State.createRepository(local);
  assert.equal(repo.load().error, 'corrupt'); assert.equal(repo.save(State.defaults()).error, 'corrupt'); assert.equal(local.getItem(State.KEY), '{corrupt');
  assert.equal(repo.reset().ok, true); assert.equal(repo.save(State.defaults()).ok, true);
});
test('denied browser storage never reports saving or reset success', () => {
  const blocked = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); }, removeItem() { throw new Error('Blocked'); } };
  const repo = State.createRepository(blocked); assert.equal(repo.load().error, 'unavailable'); assert.equal(repo.save(State.defaults()).ok, false); assert.equal(repo.reset().ok, false);
});
test('explicit import is atomic and does not remove the old profile if writing fails', () => {
  const local = storage(), repo = State.createRepository(local);
  repo.save(State.defaults()); const previous = local.getItem(State.KEY);
  local.setItem = () => { throw new Error('Quota'); };
  assert.equal(repo.replace(State.defaults()).ok, false); assert.equal(local.getItem(State.KEY), previous);
});
