const test = require('node:test');
const assert = require('node:assert/strict');
const { getKazakhGreeting } = require('../welcome-utils');

test('greets in the morning from 05:00 until before 11:00', () => {
  assert.equal(getKazakhGreeting(5), 'Қайырлы таң!');
  assert.equal(getKazakhGreeting(10), 'Қайырлы таң!');
});

test('greets during the day from 11:00 until before 17:00', () => {
  assert.equal(getKazakhGreeting(11), 'Қайырлы күн!');
  assert.equal(getKazakhGreeting(16), 'Қайырлы күн!');
});

test('greets in the evening from 17:00 until before 22:00', () => {
  assert.equal(getKazakhGreeting(17), 'Қайырлы кеш!');
  assert.equal(getKazakhGreeting(21), 'Қайырлы кеш!');
});

test('greets at night before 05:00 and from 22:00 onward', () => {
  assert.equal(getKazakhGreeting(0), 'Қайырлы түн!');
  assert.equal(getKazakhGreeting(4), 'Қайырлы түн!');
  assert.equal(getKazakhGreeting(22), 'Қайырлы түн!');
  assert.equal(getKazakhGreeting(23), 'Қайырлы түн!');
});

test('uses the provided local Date hour', () => {
  assert.equal(getKazakhGreeting(new Date(2026, 9, 13, 19, 30)), 'Қайырлы кеш!');
});

test('falls back to a daytime greeting for invalid hours', () => {
  assert.equal(getKazakhGreeting(-1), 'Қайырлы күн!');
  assert.equal(getKazakhGreeting(24), 'Қайырлы күн!');
  assert.equal(getKazakhGreeting(new Date('invalid')), 'Қайырлы күн!');
});
