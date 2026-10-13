const test = require('node:test');
const assert = require('node:assert/strict');
const { isPhishingOrScam, isYouTubeURL } = require('../security-utils');

test('known blocked hosts and their subdomains are classified before navigation', () => {
  assert.equal(isPhishingOrScam('https://kaspi-login.ru/').isScam, true);
  assert.equal(isPhishingOrScam('https://login.egov-kz.online/').isScam, true);
  assert.equal(isPhishingOrScam('https://kaspi.kz/').isScam, false);
  assert.equal(isPhishingOrScam('https://login.egov.kz/').isScam, false);
  assert.equal(isPhishingOrScam('invalid').isScam, false);
});

test('YouTube ad exceptions require a real domain boundary', () => {
  assert.equal(isYouTubeURL('https://music.youtube.com/'), true);
  assert.equal(isYouTubeURL('https://r1.googlevideo.com/video'), true);
  assert.equal(isYouTubeURL('https://youtube.com.evil.example/'), false);
  assert.equal(isYouTubeURL('https://example.com/?youtube.com'), false);
});
