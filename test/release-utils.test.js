const test = require('node:test');
const assert = require('node:assert/strict');
const { REPOSITORY, isNewerVersion, normalizeRelease, fetchRelease } = require('../public/release-utils');
const release = { tag_name: 'v1.5.0', html_url: `${REPOSITORY}/releases/tag/v1.5.0`, published_at: '2026-10-13T15:00:00Z', assets: [
  { name: 'Galamtor-1.5.0-arm64.dmg', browser_download_url: `${REPOSITORY}/releases/download/v1.5.0/Galamtor-1.5.0-arm64.dmg`, size: 100 }
] };

test('updates compare complete numeric versions without downgrades or prerelease confusion', () => {
  assert.equal(isNewerVersion('v1.10.0', '1.9.9'), true);
  assert.equal(isNewerVersion('v1.5.0', '1.5.0'), false);
  assert.equal(isNewerVersion('v1.4.9', '1.5.0'), false);
  assert.equal(isNewerVersion('v2.0.0-preview', '1.5.0'), false);
  assert.equal(isNewerVersion('v2.0.0', 'invalid'), false);
});

test('release metadata accepts only stable releases in the official repository', () => {
  assert.equal(normalizeRelease(release).assets.length, 1);
  assert.equal(normalizeRelease({ ...release, prerelease: true }), null);
  assert.equal(normalizeRelease({ ...release, draft: true }), null);
  assert.equal(normalizeRelease({ ...release, html_url: 'javascript:alert(1)' }), null);
  assert.equal(normalizeRelease({ ...release, html_url: 'https://github.com/other/repo/releases/tag/v1.5.0' }), null);
});

test('release metadata filters foreign, unsafe and mismatched download assets', () => {
  const bad = ['javascript:alert(1)', 'https://evil.example/file', `${REPOSITORY}/releases/download/v1.4.0/a.dmg`];
  const value = normalizeRelease({ ...release, assets: [...release.assets, ...bad.map(browser_download_url => ({ name: 'a.dmg', size: 1, browser_download_url }))] });
  assert.equal(value.assets.length, 1);
});

test('release checking covers successful, empty and failed provider responses', async () => {
  let signal;
  const result = await fetchRelease(async (_, options) => { signal = options.signal; return { ok: true, json: async () => release }; });
  assert.equal(result.tag_name, 'v1.5.0');
  assert.ok(signal instanceof AbortSignal);
  await assert.rejects(fetchRelease(async () => ({ ok: false })), /unavailable/);
  await assert.rejects(fetchRelease(async () => ({ ok: true, json: async () => null })), /Invalid/);
  await assert.rejects(fetchRelease(async () => { throw new Error('offline'); }), /offline/);
});
