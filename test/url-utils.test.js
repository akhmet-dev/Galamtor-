const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSearchOrURL } = require('../url-utils');

test('empty input stays empty', () => {
  assert.equal(parseSearchOrURL('   '), '');
  assert.equal(parseSearchOrURL(null), '');
});

test('ordinary domain names use HTTPS', () => {
  assert.equal(parseSearchOrURL('example.com'), 'https://example.com/');
  assert.equal(parseSearchOrURL('example.com/docs?q=browser'), 'https://example.com/docs?q=browser');
});

test('explicit HTTP and HTTPS URLs are preserved', () => {
  assert.equal(parseSearchOrURL('http://localhost:3000'), 'http://localhost:3000/');
  assert.equal(parseSearchOrURL('https://example.com/a'), 'https://example.com/a');
});

test('localhost and local IP addresses use HTTP by default', () => {
  assert.equal(parseSearchOrURL('localhost:3000'), 'http://localhost:3000/');
  assert.equal(parseSearchOrURL('localhost/path'), 'http://localhost/path');
  assert.equal(parseSearchOrURL('127.0.0.1:8080'), 'http://127.0.0.1:8080/');
  assert.equal(parseSearchOrURL('192.168.1.10'), 'http://192.168.1.10/');
  assert.equal(parseSearchOrURL('[::1]:8080'), 'http://[::1]:8080/');
});

test('search text and search operators stay searches', () => {
  assert.equal(parseSearchOrURL('weather in Almaty'), 'https://www.google.com/search?q=weather%20in%20Almaty');
  assert.equal(parseSearchOrURL('site:gov.kz eGov'), 'https://www.google.com/search?q=site%3Agov.kz%20eGov');
});

test('unsupported schemes are rejected and malformed IPs are searched', () => {
  assert.equal(parseSearchOrURL('file:///etc/passwd'), '');
  assert.equal(parseSearchOrURL('ftp://example.com/file'), '');
  assert.equal(parseSearchOrURL('999.999.999.999'), 'https://www.google.com/search?q=999.999.999.999');
});

test('public IP addresses use HTTPS while private IPv6 addresses remain local', () => {
  assert.equal(parseSearchOrURL('8.8.8.8'), 'https://8.8.8.8/');
  assert.equal(parseSearchOrURL('[2001:4860:4860::8888]'), 'https://[2001:4860:4860::8888]/');
  assert.equal(parseSearchOrURL('[fd00::1]:8080'), 'http://[fd00::1]:8080/');
});
