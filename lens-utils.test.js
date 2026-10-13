const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { buildLensUploadUrl, isPrivateOrLocalHost } = require('./lens-utils');

test('sends a public HTTPS image URL to the official Lens URL upload page', () => {
  assert.equal(
    buildLensUploadUrl('https://images.example.org/picture.jpg?token=abc#preview'),
    'https://lens.google.com/uploadbyurl?url=https%3A%2F%2Fimages.example.org%2Fpicture.jpg%3Ftoken%3Dabc'
  );
});

test('rejects local, private, data, credentialed, and oversized image URLs', () => {
  for (const value of [
    'http://images.example.org/picture.jpg',
    'data:image/png;base64,abc',
    'https://user:password@images.example.org/picture.jpg',
    'https://localhost/picture.jpg',
    'https://router.local/picture.jpg',
    'https://127.0.0.1/picture.jpg',
    `https://images.example.org/${'a'.repeat(4100)}`
  ]) assert.equal(buildLensUploadUrl(value), null, value.slice(0, 80));
});

test('classifies IPv6 literals and intranet hostnames as local', () => {
  assert.equal(isPrivateOrLocalHost('[::1]'), true);
  assert.equal(isPrivateOrLocalHost('printer.internal'), true);
  assert.equal(isPrivateOrLocalHost('images.example.org'), false);
});

test('exposes Lens helpers to the sandboxed browser renderer without Node globals', () => {
  const context = vm.createContext({ URL });
  vm.runInContext(fs.readFileSync(require.resolve('./lens-utils'), 'utf8'), context);
  assert.equal(typeof context.GalamtorLensUtils.buildLensUploadUrl, 'function');
  assert.equal(context.GalamtorLensUtils.buildLensUploadUrl('https://images.example.org/a.jpg')?.startsWith('https://lens.google.com/'), true);
});
