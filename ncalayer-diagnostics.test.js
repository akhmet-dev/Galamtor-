'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  NCALAYER_HOST,
  NCALAYER_PORT,
  classifyNcaLayerError,
  checkNcaLayer
} = require('./ncalayer-diagnostics');

function createMockRequest({ response, error, timeout = false } = {}) {
  let options;
  class MockRequest extends EventEmitter {
    setTimeout() {}
    end() {
      queueMicrotask(() => {
        if (timeout) this.emit('timeout');
        else if (error) this.emit('error', error);
        else response?.(this.callback);
      });
    }
    destroy() {}
  }
  const instance = new MockRequest();
  const request = (requestOptions, callback) => {
    options = requestOptions;
    instance.callback = callback;
    return instance;
  };
  return { request, instance, get options() { return options; } };
}

test('probes only the fixed loopback NCALayer TLS endpoint', async () => {
  const mock = createMockRequest({
    response(callback) { callback({ statusCode: 404, resume() {} }); }
  });
  const result = await checkNcaLayer({ request: mock.request });
  assert.deepEqual(result, { available: true, statusCode: 404 });
  assert.equal(mock.options.hostname, NCALAYER_HOST);
  assert.equal(mock.options.port, NCALAYER_PORT);
  assert.equal(mock.options.rejectUnauthorized, true);
  assert.equal(mock.options.protocol, 'https:');
});

test('classifies stopped service, certificate failures and other local errors', async () => {
  assert.equal(classifyNcaLayerError({ code: 'ECONNREFUSED' }), 'stopped');
  assert.equal(classifyNcaLayerError({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }), 'certificate');
  assert.equal(classifyNcaLayerError({ code: 'ETIMEDOUT' }), 'unreachable');
  const mock = createMockRequest({ error: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) });
  assert.deepEqual(await checkNcaLayer({ request: mock.request }), { available: false, reason: 'stopped' });
});

test('reports the local TLS trust issue without bypassing certificate checks', async () => {
  const mock = createMockRequest({ error: Object.assign(new Error('untrusted'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }) });
  assert.deepEqual(await checkNcaLayer({ request: mock.request }), { available: false, reason: 'certificate' });
  assert.equal(mock.options.rejectUnauthorized, true);
});
