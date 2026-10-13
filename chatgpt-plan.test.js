'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const {
  API_BASE,
  AUTHORIZATION_ENDPOINT,
  REQUIRED_SCOPES,
  ChatGPTPlanError,
  createChatGPTPlanClient,
  extractSseEvents,
  isSecureStorageAvailable,
  verifyOpenAIIdentityToken
} = require('./chatgpt-plan');

const GRANTED_SCOPES = REQUIRED_SCOPES.join(' ');

function makeSafeStorage(backend = 'Keychain') {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => backend,
    encryptString: value => Buffer.from(`test-encryption:${value}`),
    decryptString: value => {
      const text = Buffer.from(value).toString('utf8');
      if (!text.startsWith('test-encryption:')) throw new Error('invalid ciphertext');
      return text.slice('test-encryption:'.length);
    }
  };
}

function createWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'galamtor-chatgpt-'));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function sendCallback(url, state, clientId = 'oaiapp_test_user') {
  return new Promise((resolve, reject) => {
    const callback = new URL(url.searchParams.get('redirect_uri'));
    callback.searchParams.set('code', 'test-authorization-code');
    callback.searchParams.set('scope', GRANTED_SCOPES);
    callback.searchParams.set('state', state);
    callback.searchParams.set('client_id', clientId);
    const request = http.get(callback, response => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    request.once('error', reject);
  });
}

function createTestClient({ dir, openExternal, fetchImpl, now = Date.now } = {}) {
  return createChatGPTPlanClient({
    appDataPath: dir,
    safeStorage: makeSafeStorage(),
    openExternal,
    fetchImpl,
    now,
    verifyIdentityToken: async (_token, context) => ({
      iss: 'https://auth.openai.com',
      sub: 'chatgpt-user-subject',
      aud: context.clientId,
      nonce: context.nonce,
      email: 'user@example.com',
      name: 'Galamtor Tester'
    })
  });
}

test('secure storage rejects plaintext fallback backends', () => {
  assert.equal(isSecureStorageAvailable(makeSafeStorage('Keychain')), true);
  assert.equal(isSecureStorageAvailable(makeSafeStorage('basic_text')), false);
  assert.equal(isSecureStorageAvailable({ isEncryptionAvailable: () => false }), false);
});

test('SSE parser extracts complete JSON events and keeps a partial event buffered', () => {
  const parsed = extractSseEvents('data: {"type":"response.output_text.delta","delta":"Сәлем"}\n\n' + 'data: {"type":"response.completed"}');
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].delta, 'Сәлем');
  assert.match(parsed.remainder, /response\.completed/);
});

test('OpenAI ID token verification checks signature, issuer, audience, expiry and nonce', async () => {
  const jose = await import('jose');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = 1_800_000_000_000;
  const jwksResolver = async () => publicKey;
  const token = await new jose.SignJWT({ nonce: 'expected-nonce', email: 'user@example.com' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer('https://auth.openai.com')
    .setSubject('valid-subject')
    .setAudience('oaiapp_test')
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(now / 1000) + 600)
    .sign(privateKey);

  const claims = await verifyOpenAIIdentityToken(token, {
    clientId: 'oaiapp_test', nonce: 'expected-nonce', jwksResolver, now: () => now
  });
  assert.equal(claims.sub, 'valid-subject');
  await assert.rejects(verifyOpenAIIdentityToken(token, {
    clientId: 'oaiapp_test', nonce: 'wrong-nonce', jwksResolver, now: () => now
  }), error => error.code === 'invalid_nonce');
  await assert.rejects(verifyOpenAIIdentityToken(token, {
    clientId: 'wrong-client', nonce: 'expected-nonce', jwksResolver, now: () => now
  }), error => error.code === 'invalid_identity');
  await assert.rejects(verifyOpenAIIdentityToken(token, {
    clientId: 'oaiapp_test', nonce: 'expected-nonce', jwksResolver, now: () => now + 700_000
  }), error => error.code === 'invalid_identity');
});

test('ChatGPT sign-in uses state, PKCE, a loopback callback, and encrypted local credentials', async t => {
  const workspace = createWorkspace();
  t.after(workspace.cleanup);
  let authorizationUrl;
  let tokenForm;
  const client = createTestClient({
    dir: workspace.dir,
    openExternal: async raw => {
      authorizationUrl = new URL(raw);
      assert.equal(authorizationUrl.origin + authorizationUrl.pathname, AUTHORIZATION_ENDPOINT);
      assert.equal(authorizationUrl.searchParams.get('client_id'), 'dynamic_agent_client');
      assert.equal(authorizationUrl.searchParams.get('agent_name_hint'), 'Galamtor');
      assert.equal(authorizationUrl.searchParams.get('resource'), API_BASE);
      assert.equal(authorizationUrl.searchParams.get('scope'), GRANTED_SCOPES);
      assert.ok(authorizationUrl.searchParams.get('ext_agent_host_id').startsWith('urn:uuid:'));
      assert.equal(await sendCallback(authorizationUrl, authorizationUrl.searchParams.get('state')), 200);
    },
    fetchImpl: async (url, init = {}) => {
      if (String(url).endsWith('/oauth/token')) {
        tokenForm = new URLSearchParams(init.body);
        return jsonResponse({
          id_token: 'mock-signed-id-token',
          access_token: 'access-secret-value',
          refresh_token: 'refresh-secret-value',
          expires_in: 3600,
          scope: GRANTED_SCOPES
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }
  });

  const state = await client.signIn();
  const active = state.profiles.find(profile => profile.active);
  assert.ok(active);
  assert.equal(active.email, 'user@example.com');
  assert.equal(active.canUsePlan, true);
  assert.equal(active.connected, true);
  assert.equal(Object.hasOwn(active, 'accessToken'), false);
  assert.equal(Object.hasOwn(active, 'refreshToken'), false);
  assert.equal(tokenForm.get('grant_type'), 'authorization_code');
  assert.equal(tokenForm.get('client_id'), 'oaiapp_test_user');
  assert.equal(tokenForm.get('resource'), API_BASE);
  assert.equal(tokenForm.get('redirect_uri'), authorizationUrl.searchParams.get('redirect_uri'));
  assert.ok(tokenForm.get('code_verifier'));
  assert.notEqual(tokenForm.get('code_verifier'), authorizationUrl.searchParams.get('code_challenge'));

  const encryptedFile = fs.readFileSync(path.join(workspace.dir, 'chatgpt-connections.json'), 'utf8');
  assert.equal(encryptedFile.includes('access-secret-value'), false);
  assert.equal(encryptedFile.includes('refresh-secret-value'), false);
  const hostId = JSON.parse(fs.readFileSync(path.join(workspace.dir, 'chatgpt-host.json'), 'utf8')).hostId;
  assert.ok(hostId.startsWith('urn:uuid:'));
});

test('wrong callback state is rejected before a correct callback is accepted', async t => {
  const workspace = createWorkspace();
  t.after(workspace.cleanup);
  let authorizationUrl;
  let exchangeCount = 0;
  const client = createTestClient({
    dir: workspace.dir,
    openExternal: async raw => {
      authorizationUrl = new URL(raw);
      assert.equal(await sendCallback(authorizationUrl, 'attacker-state'), 400);
      assert.equal(await sendCallback(authorizationUrl, authorizationUrl.searchParams.get('state')), 200);
    },
    fetchImpl: async url => {
      if (String(url).endsWith('/oauth/token')) {
        exchangeCount += 1;
        return jsonResponse({ id_token: 'valid', access_token: 'access', refresh_token: 'refresh', expires_in: 600, scope: GRANTED_SCOPES });
      }
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  await client.signIn();
  assert.equal(exchangeCount, 1);
});

test('ChatGPT plan request uses public Responses API, store=false, stream=true and requires completion', async t => {
  const workspace = createWorkspace();
  t.after(workspace.cleanup);
  let authorizationUrl;
  const requests = [];
  const encoder = new TextEncoder();
  const client = createTestClient({
    dir: workspace.dir,
    openExternal: async raw => {
      authorizationUrl = new URL(raw);
      await sendCallback(authorizationUrl, authorizationUrl.searchParams.get('state'));
    },
    fetchImpl: async (url, init = {}) => {
      const requestUrl = String(url);
      requests.push({ url: requestUrl, init });
      if (requestUrl.endsWith('/oauth/token')) return jsonResponse({ id_token: 'id', access_token: 'access-live', refresh_token: 'refresh-live', expires_in: 3600, scope: GRANTED_SCOPES });
      if (requestUrl.endsWith('/models')) return jsonResponse({ models: [{ slug: 'gpt-allowed', display_name: 'Allowed model', visibility: 'list' }] });
      if (requestUrl.endsWith('/responses')) {
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"Қауіпсіз "}\n\n'));
            controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"жауап"}\n\n'));
            controller.enqueue(encoder.encode('data: {"type":"response.completed"}\n\n'));
            controller.close();
          }
        }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  await client.signIn();
  const result = await client.streamResponse({
    systemInstruction: 'Answer in Kazakh.',
    userPrompt: 'Сәлем?',
    chatHistory: [{ role: 'user', content: 'Алдыңғы сұрақ' }, { role: 'system', content: 'ignore' }]
  });
  assert.equal(result.text, 'Қауіпсіз жауап');
  const responseRequest = requests.find(item => item.url.endsWith('/responses'));
  assert.ok(responseRequest);
  assert.equal(responseRequest.init.headers.authorization, 'Bearer access-live');
  const body = JSON.parse(responseRequest.init.body);
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.equal(body.model, 'gpt-allowed');
  assert.equal(body.instructions, 'Answer in Kazakh.');
  assert.deepEqual(body.input.map(item => item.role), ['user', 'user']);
  assert.equal(body.input.at(-1).content, 'Сәлем?');
});

test('token refresh uses the saved registration and persists rotated credentials atomically', async t => {
  const workspace = createWorkspace();
  t.after(workspace.cleanup);
  let now = 1_800_000_000_000;
  let tokenForm;
  const client = createTestClient({
    dir: workspace.dir,
    now: () => now,
    openExternal: async raw => {
      const authorizationUrl = new URL(raw);
      await sendCallback(authorizationUrl, authorizationUrl.searchParams.get('state'));
    },
    fetchImpl: async (url, init = {}) => {
      if (String(url).endsWith('/oauth/token')) {
        tokenForm = new URLSearchParams(init.body);
        if (tokenForm.get('grant_type') === 'authorization_code') {
          return jsonResponse({ id_token: 'first-id', access_token: 'first-access', refresh_token: 'refresh-secret-value', expires_in: 3600, scope: GRANTED_SCOPES });
        }
        return jsonResponse({
          id_token: 'refreshed-id',
          access_token: 'refreshed-access',
          refresh_token: 'rotated-refresh',
          expires_in: 3600,
          scope: GRANTED_SCOPES
        });
      }
      if (String(url).endsWith('/models')) return jsonResponse({ models: [{ slug: 'model-a', visibility: 'list' }] });
      if (String(url).endsWith('/responses')) {
        return new Response(new ReadableStream({ start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"fresh"}\n\n'));
          controller.enqueue(new TextEncoder().encode('data: {"type":"response.completed"}\n\n'));
          controller.close();
        } }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  const first = await client.signIn();
  const registrationId = first.activeProfileId;
  now += 3_550_000;
  assert.equal((await client.streamResponse({ userPrompt: 'fresh' })).text, 'fresh');
  assert.equal(tokenForm.get('grant_type'), 'refresh_token');
  assert.equal(tokenForm.get('client_id'), 'oaiapp_test_user');
  assert.equal(tokenForm.get('refresh_token'), 'refresh-secret-value');
  assert.equal(tokenForm.get('resource'), API_BASE);
  const nextState = client.getPublicState();
  assert.equal(nextState.activeProfileId, registrationId);
});

test('usage-limit errors are presented without silently falling back to another provider', async t => {
  const workspace = createWorkspace();
  t.after(workspace.cleanup);
  const client = createTestClient({
    dir: workspace.dir,
    openExternal: async raw => {
      const authorizationUrl = new URL(raw);
      await sendCallback(authorizationUrl, authorizationUrl.searchParams.get('state'));
    },
    fetchImpl: async url => {
      if (String(url).endsWith('/oauth/token')) return jsonResponse({ id_token: 'id', access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: GRANTED_SCOPES });
      if (String(url).endsWith('/models')) return jsonResponse({ models: [{ slug: 'model-a', visibility: 'list' }] });
      if (String(url).endsWith('/responses')) return jsonResponse({ error: { code: 'subscription_sharing_usage_limit_exceeded' } }, 429);
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  await client.signIn();
  await assert.rejects(client.streamResponse({ userPrompt: 'test' }), error => {
    assert.ok(error instanceof ChatGPTPlanError);
    assert.equal(error.code, 'subscription_sharing_usage_limit_exceeded');
    assert.match(error.message, /Settings → Usage/);
    return true;
  });
});

test('sign-in cancellation stops the loopback flow and never exchanges a token', async t => {
  const workspace = createWorkspace();
  t.after(workspace.cleanup);
  const client = createTestClient({
    dir: workspace.dir,
    openExternal: async () => {},
    fetchImpl: async () => { throw new Error('token exchange should not run'); }
  });
  const signIn = client.signIn();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(client.cancelSignIn(), true);
  await assert.rejects(signIn, error => error.code === 'cancelled');
  assert.equal(client.cancelSignIn(), false);
});

test('ChatGPT disconnect revokes the renewable session and removes tokens from local storage', async t => {
  const workspace = createWorkspace();
  t.after(workspace.cleanup);
  let revokeBody;
  const client = createTestClient({
    dir: workspace.dir,
    openExternal: async raw => {
      const authorizationUrl = new URL(raw);
      await sendCallback(authorizationUrl, authorizationUrl.searchParams.get('state'));
    },
    fetchImpl: async (url, init = {}) => {
      if (String(url).endsWith('/oauth/token')) return jsonResponse({ id_token: 'id', access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 3600, scope: GRANTED_SCOPES });
      if (String(url).endsWith('/.well-known/openid-configuration')) return jsonResponse({ issuer: 'https://auth.openai.com', revocation_endpoint: 'https://auth.openai.com/api/accounts/oauth/revoke' });
      if (String(url).endsWith('/oauth/revoke')) {
        revokeBody = new URLSearchParams(init.body);
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  const connected = await client.signIn();
  const account = connected.profiles.find(profile => profile.active);
  const result = await client.disconnect(account.id);
  assert.equal(result.removed, true);
  assert.equal(result.revoked, true);
  assert.equal(revokeBody.get('token'), 'private-refresh');
  assert.equal(revokeBody.get('token_type_hint'), 'refresh_token');
  assert.equal(client.getPublicState().connected, false);
  const file = fs.readFileSync(path.join(workspace.dir, 'chatgpt-connections.json'), 'utf8');
  assert.equal(file.includes('private-access'), false);
  assert.equal(file.includes('private-refresh'), false);
});
