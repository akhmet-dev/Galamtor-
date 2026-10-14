const test = require('node:test');
const assert = require('node:assert/strict');
const { withTimeout, createLatestWriter } = require('../public/async-operations');

test('bounded operations preserve values/errors and time out unresolved work', async () => {
  assert.equal(await withTimeout(Promise.resolve(42), 50), 42);
  await assert.rejects(withTimeout(Promise.reject(Object.assign(new Error('failure'), { code: 'disk' })), 50), { code: 'disk' });
  await assert.rejects(withTimeout(new Promise(() => {}), 10, 'sync/timeout'), { code: 'sync/timeout' });
});

test('profile writes serialize and coalesce waiting snapshots to the latest one', async () => {
  const writes = [], releases = [];
  const writer = createLatestWriter({ write: value => { writes.push(value); return new Promise(resolve => releases.push(resolve)); } });
  const done = writer.update(1); await new Promise(resolve => setImmediate(resolve));
  writer.update(2); writer.update(3);
  releases[0](); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, [1, 3]); releases[1](); assert.equal(await done, true);
});

test('a failed cloud write stops automatic draining and an explicit retry recovers', async () => {
  let broken = true, calls = 0; const states = [];
  const writer = createLatestWriter({ timeoutMs: 10, write: async () => { calls++; if (broken) throw new Error('offline'); }, onState: state => states.push(state) });
  assert.equal(await writer.update({ version: 1 }), false); assert.equal(calls, 1); assert.equal(states.at(-1), 'error');
  broken = false; assert.equal(await writer.update({ version: 2 }), true); assert.equal(states.at(-1), 'saved');
});

test('an offline Firestore write has a visible bounded failure instead of holding the UI', async () => {
  const states = [];
  const writer = createLatestWriter({ timeoutMs: 10, write: () => new Promise(() => {}), onState: state => states.push(state) });
  assert.equal(await writer.update({ count: 4 }), false); assert.deepEqual(states, ['saving', 'error']);
});
