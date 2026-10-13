'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  normalizeModelReference,
  isModelInstalled,
  checkOllamaStatus,
  pullOllamaModel
} = require('./ollama-client');

async function withLocalServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    return await callback({ host: '127.0.0.1', port: server.address().port });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('normalizes an untagged Ollama model to the latest tag', () => {
  assert.equal(normalizeModelReference('hermes3'), 'hermes3:latest');
  assert.equal(normalizeModelReference('hermes3:3'), 'hermes3:3');
});

test('detects an installed model by name or model field', () => {
  assert.equal(isModelInstalled([{ name: 'hermes3:latest' }], 'hermes3'), true);
  assert.equal(isModelInstalled([{ model: 'llama3.2:3b' }], 'llama3.2:3b'), true);
  assert.equal(isModelInstalled([{ name: 'hermes3:3' }], 'hermes3'), false);
});

test('handles missing, malformed, and empty model lists safely', () => {
  assert.equal(isModelInstalled([], 'hermes3'), false);
  assert.equal(isModelInstalled(null, 'hermes3'), false);
  assert.equal(isModelInstalled([{ name: 42 }, null], 'hermes3'), false);
  assert.equal(isModelInstalled([{ name: 'hermes3:latest' }], ''), false);
});

test('a cancelled model pull exits before opening a connection', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await pullOllamaModel('hermes3', () => {}, { signal: controller.signal });
  assert.equal(result.cancelled, true);
  assert.equal(result.success, false);
});

test('checks the running Ollama service and reports the selected model state', async () => {
  await withLocalServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ models: [{ name: 'hermes3:latest' }, { name: 'llama3.2:3b' }] }));
  }, async (endpoint) => {
    const ready = await checkOllamaStatus('hermes3', 1000, endpoint);
    const missing = await checkOllamaStatus('mistral', 1000, endpoint);
    assert.equal(ready.available, true);
    assert.equal(ready.installed, true);
    assert.deepEqual(ready.installedModels, ['hermes3:latest', 'llama3.2:3b']);
    assert.equal(missing.available, true);
    assert.equal(missing.installed, false);
  });
});

test('streams Ollama model download progress and confirms completion', async () => {
  await withLocalServer((request, response) => {
    assert.equal(request.url, '/api/pull');
    response.setHeader('Content-Type', 'application/x-ndjson');
    response.write(JSON.stringify({ status: 'pulling manifest' }) + '\n');
    response.write(JSON.stringify({ status: 'pulling layer', completed: 25, total: 100 }) + '\n');
    response.end(JSON.stringify({ status: 'success' }) + '\n');
  }, async (endpoint) => {
    const progress = [];
    const result = await pullOllamaModel('hermes3', (event) => progress.push(event), endpoint);
    assert.equal(result.success, true);
    assert.equal(progress.some((event) => event.percent === 25), true);
    assert.equal(progress.at(-1).status, 'success');
  });
});

test('aborting a live model pull closes the request and reports cancellation', async () => {
  let receivedRequest;
  const requestReceived = new Promise((resolve) => { receivedRequest = resolve; });
  await withLocalServer(() => {
    receivedRequest();
  }, async (endpoint) => {
    const controller = new AbortController();
    const pulling = pullOllamaModel('hermes3', () => {}, { ...endpoint, signal: controller.signal });
    await requestReceived;
    controller.abort();
    const result = await pulling;
    assert.equal(result.success, false);
    assert.equal(result.cancelled, true);
  });
});
