'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { writeJsonAtomic, readJsonFile } = require('./profile-storage');

const ISSUER = 'https://auth.openai.com';
const AUTHORIZATION_ENDPOINT = `${ISSUER}/api/accounts/authorize`;
const TOKEN_ENDPOINT = `${ISSUER}/api/accounts/oauth/token`;
const DISCOVERY_ENDPOINT = `${ISSUER}/.well-known/openid-configuration`;
const JWKS_ENDPOINT = `${ISSUER}/.well-known/jwks.json`;
const API_BASE = 'https://api.openai.com/v1';
const RESOURCE = API_BASE;
const APP_NAME = 'Galamtor';
const CALLBACK_PATH = '/auth/callback';
const REQUIRED_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct'];
const MAX_HTTP_BODY = 2_000_000;
const MAX_TEXT_RESPONSE = 300_000;
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

class ChatGPTPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ChatGPTPlanError';
    this.code = code;
  }
}

function isSecureStorageAvailable(safeStorage) {
  try {
    if (!safeStorage?.isEncryptionAvailable?.()) return false;
    const backend = safeStorage.getSelectedStorageBackend?.();
    return backend !== 'basic_text' && backend !== 'unknown';
  } catch {
    return false;
  }
}

function safeProfile(profile) {
  return {
    id: profile.id,
    email: profile.email || '',
    name: profile.name || '',
    canUsePlan: Array.isArray(profile.scopes) && profile.scopes.includes('chatgpt.tokens.use.direct'),
    connected: !!profile.refreshToken || !!profile.accessToken,
    active: false
  };
}

function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

function normalizeProfile(profile) {
  if (!profile || typeof profile !== 'object' || typeof profile.id !== 'string' ||
      typeof profile.clientId !== 'string' || typeof profile.subject !== 'string' ||
      typeof profile.email !== 'string' || typeof profile.accessToken !== 'string' ||
      typeof profile.idToken !== 'string' || !Array.isArray(profile.scopes)) return null;
  return {
    id: profile.id,
    clientId: profile.clientId,
    subject: profile.subject,
    email: profile.email.slice(0, 320),
    name: typeof profile.name === 'string' ? profile.name.slice(0, 200) : '',
    idToken: profile.idToken,
    accessToken: profile.accessToken,
    refreshToken: typeof profile.refreshToken === 'string' ? profile.refreshToken : '',
    expiresAt: Number.isFinite(profile.expiresAt) ? profile.expiresAt : 0,
    scopes: profile.scopes.filter(scope => typeof scope === 'string').slice(0, 32),
    savedAt: Number.isFinite(profile.savedAt) ? profile.savedAt : Date.now()
  };
}

function extractSseEvents(buffer) {
  const chunks = buffer.split(/\r?\n\r?\n/);
  const remainder = chunks.pop() || '';
  const events = [];
  for (const chunk of chunks) {
    const data = chunk.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') continue;
    try { events.push(JSON.parse(data)); } catch {}
  }
  return { events, remainder };
}

async function verifyOpenAIIdentityToken(token, { clientId, nonce, expectedSubject, jwksResolver, now = Date.now }) {
  let jose;
  try { jose = await import('jose'); } catch {
    throw new ChatGPTPlanError('verification_unavailable', 'Қауіпсіз OpenAI кіруін тексеру модулі қолжетімсіз. Қолданбаны жаңартып, қайта көріңіз.');
  }
  const jwks = jwksResolver || jose.createRemoteJWKSet(new URL(JWKS_ENDPOINT), {
    timeoutDuration: 10000,
    cooldownDuration: 30000,
    cacheMaxAge: 10 * 60 * 1000
  });
  let result;
  try {
    result = await jose.jwtVerify(token, jwks, {
      issuer: ISSUER,
      audience: clientId,
      algorithms: ['RS256', 'PS256', 'ES256'],
      requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat'],
      clockTolerance: 30,
      currentDate: new Date(now())
    });
  } catch {
    throw new ChatGPTPlanError('invalid_identity', 'OpenAI қайтарған жеке куәлікті растау мүмкін болмады. Қайта кіріп көріңіз.');
  }
  const claims = result.payload;
  if (nonce && !constantTimeEqual(claims.nonce, nonce)) {
    throw new ChatGPTPlanError('invalid_nonce', 'Кіру растауы сәйкес келмеді. Қауіпсіздік үшін кіру тоқтатылды.');
  }
  if (expectedSubject && claims.sub !== expectedSubject) {
    throw new ChatGPTPlanError('account_mismatch', 'Таңдалған ChatGPT аккаунты басқа аккаунтпен алмастырылған жоқ. Қажетті аккаунтты таңдап, қайталап көріңіз.');
  }
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 512) {
    throw new ChatGPTPlanError('invalid_identity', 'OpenAI аккаунтының идентификаторы жарамсыз.');
  }
  return claims;
}

function createChatGPTPlanClient(options = {}) {
  const { appDataPath, safeStorage, openExternal, fetchImpl = fetch, now = Date.now } = options;
  if (typeof appDataPath !== 'string' || !appDataPath) throw new TypeError('appDataPath is required');
  if (typeof openExternal !== 'function') throw new TypeError('openExternal is required');

  const credentialPath = path.join(appDataPath, 'chatgpt-connections.json');
  const hostPath = path.join(appDataPath, 'chatgpt-host.json');
  let activeSignIn = null;
  const refreshPromises = new Map();
  const modelCache = new Map();

  function requireEncryption() {
    if (!isSecureStorageAvailable(safeStorage)) {
      throw new ChatGPTPlanError('secure_storage_unavailable', 'Бұл құрылғыда қауіпсіз жүйелік құпиясөз қоймасы қолжетімсіз. ChatGPT токендерін ашық файлға сақтамаймыз. macOS Keychain/Windows Credential Store немесе Linux жүйелік кілтсөз қоймасын іске қосыңыз.');
    }
  }

  function loadStore() {
    requireEncryption();
    if (!fs.existsSync(credentialPath)) return { version: 1, profiles: [], activeProfileId: null };
    try {
      const envelope = readJsonFile(credentialPath, null, value => value && value.version === 1 && typeof value.encrypted === 'string');
      if (!envelope) throw new Error('Invalid encrypted profile envelope');
      const raw = safeStorage.decryptString(Buffer.from(envelope.encrypted, 'base64'));
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.profiles)) throw new Error('Invalid profile data');
      const profiles = parsed.profiles.map(normalizeProfile).filter(Boolean);
      const activeProfileId = profiles.some(item => item.id === parsed.activeProfileId) ? parsed.activeProfileId : (profiles[0]?.id || null);
      return { version: 1, profiles, activeProfileId };
    } catch (error) {
      if (error instanceof ChatGPTPlanError) throw error;
      throw new ChatGPTPlanError('credential_read_failed', 'ChatGPT байланысының шифрланған дерегін оқу мүмкін болмады. Қолданба дерегін өшірмей, Keychain/жүйелік кілтсөз қоймасын тексеріңіз.');
    }
  }

  function saveStore(store) {
    requireEncryption();
    fs.mkdirSync(appDataPath, { recursive: true, mode: 0o700 });
    const encrypted = safeStorage.encryptString(JSON.stringify({
      version: 1,
      profiles: store.profiles,
      activeProfileId: store.activeProfileId
    })).toString('base64');
    writeJsonAtomic(credentialPath, { version: 1, encrypted }, { backup: false, isValid: value => value && value.version === 1 && typeof value.encrypted === 'string' });
    try { fs.chmodSync(credentialPath, 0o600); } catch {}
  }

  function getHostId() {
    fs.mkdirSync(appDataPath, { recursive: true, mode: 0o700 });
    try {
      const saved = readJsonFile(hostPath, null, value => value && typeof value.hostId === 'string' && /^urn:uuid:[0-9a-f-]{36}$/i.test(value.hostId));
      if (saved) return saved.hostId;
    } catch {}
    const hostId = `urn:uuid:${crypto.randomUUID()}`;
    writeJsonAtomic(hostPath, { hostId }, { backup: false, isValid: value => value && typeof value.hostId === 'string' });
    try { fs.chmodSync(hostPath, 0o600); } catch {}
    return hostId;
  }

  function getPublicState() {
    const store = loadStore();
    return {
      connected: store.profiles.length > 0,
      activeProfileId: store.activeProfileId,
      profiles: store.profiles.map(profile => ({ ...safeProfile(profile), active: profile.id === store.activeProfileId }))
    };
  }

  async function postForm(endpoint, values, errorCode, errorMessage) {
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams(values),
        signal: AbortSignal.timeout(20_000)
      });
    } catch {
      throw new ChatGPTPlanError('network_error', 'OpenAI қызметіне қосыла алмадым. Интернетті тексеріп, қайта көріңіз.');
    }
    let body = '';
    try { body = await response.text(); } catch {}
    if (body.length > MAX_HTTP_BODY) throw new ChatGPTPlanError(errorCode, errorMessage);
    let parsed = {};
    try { parsed = body ? JSON.parse(body) : {}; } catch {}
    if (!response.ok) {
      if (parsed.error === 'invalid_grant') throw new ChatGPTPlanError('reauth_required', 'ChatGPT сессиясының мерзімі аяқталды. AI баптауларынан қайта кіріңіз.');
      if (parsed.error === 'access_denied') throw new ChatGPTPlanError('access_denied', 'ChatGPT рұқсаты берілмеді. Қаласаңыз, кейін қайта қосуға болады.');
      throw new ChatGPTPlanError(errorCode, errorMessage);
    }
    return parsed;
  }

  async function waitForLoopbackCallback(authorizationUrl, signal) {
    const state = crypto.randomBytes(32).toString('base64url');
    let callbackUrl;
    let completed = false;
    let server;
    let timeout;
    let onAbort;
    let resolveCallback;
    let rejectCallback;

    const callbackResult = new Promise((resolve, reject) => {
      resolveCallback = resolve;
      rejectCallback = reject;
    });

    const listenerReady = new Promise((resolve, reject) => {
      server = http.createServer((request, response) => {
        let requestUrl;
        try {
          if (request.method !== 'GET' || request.headers.host !== `127.0.0.1:${callbackUrl.port}`) throw new Error('Invalid callback host');
          requestUrl = new URL(request.url, `http://127.0.0.1:${callbackUrl.port}`);
          if (requestUrl.pathname !== CALLBACK_PATH) throw new Error('Invalid callback path');
        } catch {
          response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
          response.end('Бұл Galamtor кіру сұрауына сәйкес келмейді.');
          return;
        }

        if (!constantTimeEqual(requestUrl.searchParams.get('state'), state)) {
          response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
          response.end('Кіру растауы сәйкес келмеді. Galamtor-ға оралып, қайта кіріңіз.');
          return;
        }
        if (completed) {
          response.writeHead(410, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
          response.end('Кіру сұрауы аяқталды. Galamtor-ға оралыңыз.');
          return;
        }
        completed = true;

        const error = requestUrl.searchParams.get('error');
        const code = requestUrl.searchParams.get('code');
        const clientId = requestUrl.searchParams.get('client_id');
        const scope = requestUrl.searchParams.get('scope') || '';
        const safeHtml = error
          ? 'ChatGPT рұқсаты аяқталмады. Galamtor терезесіне оралыңыз.'
          : 'ChatGPT байланысы тексеріліп жатыр. Galamtor терезесіне оралыңыз.';
        response.writeHead(error ? 400 : 200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store, max-age=0',
          'referrer-policy': 'no-referrer',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
        });
        response.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Galamtor</title><p style="font:16px system-ui;margin:48px auto;max-width:520px">${safeHtml}</p>`);
        if (error) resolveCallback({ error: error === 'access_denied' ? 'access_denied' : 'oauth_error' });
        else if (!code || code.length > 4096) resolveCallback({ error: 'missing_code' });
        else resolveCallback({ code, clientId, scope });
      });
      server.once('error', () => reject(new ChatGPTPlanError('callback_server_error', 'Қауіпсіз кіру үшін жергілікті callback серверін іске қоса алмадым. Қолданбаны қайта іске қосып көріңіз.')));
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        callbackUrl = new URL(`http://127.0.0.1:${address.port}${CALLBACK_PATH}`);
        timeout = setTimeout(() => rejectCallback(new ChatGPTPlanError('auth_timeout', 'ChatGPT кіруі 5 минут ішінде аяқталмады. Қайталап көріңіз.')), AUTH_TIMEOUT_MS);
        timeout.unref?.();
        resolve({ state, callbackUrl });
      });
    });

    try {
      const listener = await listenerReady;
      onAbort = () => rejectCallback(new ChatGPTPlanError('cancelled', 'ChatGPT-ке кіру тоқтатылды.'));
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      const nonce = crypto.randomBytes(32).toString('base64url');
      const verifier = crypto.randomBytes(48).toString('base64url');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      const authUrl = new URL(AUTHORIZATION_ENDPOINT);
      const params = new URLSearchParams({
        client_id: authorizationUrl.clientId,
        redirect_uri: listener.callbackUrl.toString(),
        response_type: 'code',
        scope: REQUIRED_SCOPES.join(' '),
        resource: RESOURCE,
        state: listener.state,
        nonce,
        code_challenge_method: 'S256',
        code_challenge: challenge,
        ext_agent_host_id: authorizationUrl.hostId
      });
      if (authorizationUrl.newRegistration) params.set('agent_name_hint', APP_NAME);
      if (authorizationUrl.profile?.idToken) params.set('id_token_hint', authorizationUrl.profile.idToken);
      if (authorizationUrl.profile?.email) params.set('login_hint', authorizationUrl.profile.email);
      authUrl.search = params.toString();

      if (signal?.aborted) throw new ChatGPTPlanError('cancelled', 'ChatGPT-ке кіру тоқтатылды.');
      await openExternal(authUrl.toString());
      const authResult = await callbackResult;
      if (authResult.error) throw new ChatGPTPlanError(authResult.error, authResult.error === 'access_denied'
        ? 'ChatGPT рұқсаты берілмеді. Қаласаңыз, кейін қайта қосуға болады.'
        : 'ChatGPT кіруі аяқталмады. Қайталап көріңіз.');
      if (authorizationUrl.newRegistration && (typeof authResult.clientId !== 'string' || authResult.clientId === 'dynamic_agent_client')) {
        throw new ChatGPTPlanError('registration_incomplete', 'ChatGPT Galamtor тіркеуін аяқтамады. Қайта кіріп көріңіз.');
      }
      const clientId = authorizationUrl.newRegistration ? authResult.clientId : authorizationUrl.profile.clientId;
      if (!clientId || clientId.length > 256 || (authResult.clientId && authResult.clientId !== clientId)) {
        throw new ChatGPTPlanError('registration_mismatch', 'ChatGPT тіркеу идентификаторы сәйкес келмеді. Қауіпсіздік үшін кіру тоқтатылды.');
      }
      return { ...authResult, clientId, callbackUrl: listener.callbackUrl.toString(), verifier, nonce };
    } finally {
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      if (timeout) clearTimeout(timeout);
      if (server?.listening) server.closeAllConnections?.();
      if (server?.listening) await new Promise(resolve => server.close(() => resolve()));
    }
  }

  async function signIn(profileId = null) {
    requireEncryption();
    if (activeSignIn) throw new ChatGPTPlanError('sign_in_in_progress', 'ChatGPT кіруі қазір орындалып жатыр. Аяқталғанша күтіңіз.');
    const store = loadStore();
    const previousProfile = profileId ? store.profiles.find(item => item.id === profileId) : null;
    if (profileId && !previousProfile) throw new ChatGPTPlanError('profile_not_found', 'Таңдалған ChatGPT аккаунты табылмады.');
    const controller = new AbortController();
    const attempt = (async () => {
      const callback = await waitForLoopbackCallback({
        clientId: previousProfile?.clientId || 'dynamic_agent_client',
        hostId: getHostId(),
        profile: previousProfile,
        newRegistration: !previousProfile
      }, controller.signal);
      const token = await postForm(TOKEN_ENDPOINT, {
        grant_type: 'authorization_code',
        client_id: callback.clientId,
        code: callback.code,
        redirect_uri: callback.callbackUrl,
        code_verifier: callback.verifier,
        resource: RESOURCE
      }, 'token_exchange_failed', 'ChatGPT кіру кодын айырбастау мүмкін болмады. Қайта кіріп көріңіз.');
      if (typeof token.id_token !== 'string' || typeof token.access_token !== 'string') {
        throw new ChatGPTPlanError('incomplete_token', 'ChatGPT байланысын растау мүмкін болмады. Қайталап көріңіз.');
      }
      const verify = options.verifyIdentityToken || verifyOpenAIIdentityToken;
      const claims = await verify(token.id_token, { clientId: callback.clientId, nonce: callback.nonce, expectedSubject: previousProfile?.subject, fetchImpl, now });
      if (claims.iss !== ISSUER || claims.aud !== callback.clientId && !(Array.isArray(claims.aud) && claims.aud.includes(callback.clientId))) {
        throw new ChatGPTPlanError('invalid_identity', 'OpenAI қайтарған аккаунт растауы жарамсыз.');
      }
      const scopes = (typeof token.scope === 'string' ? token.scope : callback.scope).split(/\s+/).filter(Boolean);
      const profile = normalizeProfile({
        id: previousProfile?.id || crypto.randomUUID(),
        clientId: callback.clientId,
        subject: claims.sub,
        email: typeof claims.email === 'string' ? claims.email : previousProfile?.email || '',
        name: typeof claims.name === 'string' ? claims.name : previousProfile?.name || '',
        idToken: token.id_token,
        accessToken: token.access_token,
        refreshToken: typeof token.refresh_token === 'string' ? token.refresh_token : previousProfile?.refreshToken || '',
        expiresAt: now() + Math.max(60, Math.min(Number(token.expires_in) || 3600, 86400)) * 1000,
        scopes,
        savedAt: now()
      });
      if (!profile) throw new ChatGPTPlanError('invalid_profile', 'ChatGPT аккаунтының дерегін сақтау мүмкін болмады.');
      const current = loadStore();
      const index = current.profiles.findIndex(item => item.id === profile.id);
      if (index >= 0) current.profiles[index] = profile;
      else current.profiles.push(profile);
      current.activeProfileId = profile.id;
      saveStore(current);
      modelCache.delete(profile.id);
      return getPublicState();
    })();
    activeSignIn = { promise: attempt, controller };
    try { return await attempt; }
    finally { if (activeSignIn?.promise === attempt) activeSignIn = null; }
  }

  function cancelSignIn() {
    if (!activeSignIn) return false;
    activeSignIn.controller.abort();
    return true;
  }

  function setActiveProfile(profileId) {
    const store = loadStore();
    if (!store.profiles.some(item => item.id === profileId)) return false;
    store.activeProfileId = profileId;
    saveStore(store);
    return true;
  }

  async function getDiscovery() {
    let response;
    try { response = await fetchImpl(DISCOVERY_ENDPOINT, { signal: AbortSignal.timeout(10000) }); }
    catch { throw new ChatGPTPlanError('network_error', 'OpenAI жүйесіне қосыла алмадым. Кейінірек көріңіз.'); }
    if (!response.ok) throw new ChatGPTPlanError('network_error', 'OpenAI жүйесінің қауіпсіздік дерегін оқу мүмкін болмады.');
    let discovery;
    try { discovery = await response.json(); } catch { throw new ChatGPTPlanError('invalid_discovery', 'OpenAI кіру ақпараты жарамсыз.'); }
    if (discovery.issuer !== ISSUER || typeof discovery.revocation_endpoint !== 'string' || !discovery.revocation_endpoint.startsWith(`${ISSUER}/`)) {
      throw new ChatGPTPlanError('invalid_discovery', 'OpenAI кіру ақпараты жарамсыз.');
    }
    return discovery;
  }

  async function getUsableProfile() {
    const store = loadStore();
    const profile = store.profiles.find(item => item.id === store.activeProfileId);
    if (!profile || !profile.accessToken) throw new ChatGPTPlanError('not_connected', 'Алдымен AI баптауларынан ChatGPT аккаунтын қосыңыз.');
    if (!profile.scopes.includes('chatgpt.tokens.use.direct') || !profile.scopes.includes('resource.invoke')) {
      throw new ChatGPTPlanError('plan_permission_missing', 'ChatGPT жоспарымен AI қолдануға рұқсат берілмеген. AI баптауларынан ChatGPT аккаунтын қайта қосып, usage рұқсатын таңдаңыз.');
    }
    if (profile.expiresAt > now() + 60_000) return { profile, store };
    if (!profile.refreshToken) throw new ChatGPTPlanError('reauth_required', 'ChatGPT сессиясының мерзімі аяқталды. AI баптауларынан қайта кіріңіз.');
    if (refreshPromises.has(profile.id)) return refreshPromises.get(profile.id);
    const refreshPromise = (async () => {
      const refreshed = await postForm(TOKEN_ENDPOINT, {
        grant_type: 'refresh_token',
        client_id: profile.clientId,
        refresh_token: profile.refreshToken,
        resource: RESOURCE
      }, 'refresh_failed', 'ChatGPT сессиясын жаңарту мүмкін болмады. Қайта кіріңіз.');
      if (typeof refreshed.access_token !== 'string') throw new ChatGPTPlanError('refresh_failed', 'ChatGPT сессиясын жаңарту мүмкін болмады. Қайта кіріңіз.');
      let claims = null;
      if (typeof refreshed.id_token === 'string') {
        const verify = options.verifyIdentityToken || verifyOpenAIIdentityToken;
        claims = await verify(refreshed.id_token, { clientId: profile.clientId, expectedSubject: profile.subject, fetchImpl, now });
        if (claims.iss !== ISSUER || claims.sub !== profile.subject || claims.aud !== profile.clientId && !(Array.isArray(claims.aud) && claims.aud.includes(profile.clientId))) {
          throw new ChatGPTPlanError('invalid_identity', 'Жаңартылған ChatGPT сессиясы расталмады. Қайта кіріңіз.');
        }
      }
      const scopes = typeof refreshed.scope === 'string' ? refreshed.scope.split(/\s+/).filter(Boolean) : profile.scopes;
      if (!scopes.includes('chatgpt.tokens.use.direct') || !scopes.includes('resource.invoke')) {
        throw new ChatGPTPlanError('plan_permission_missing', 'ChatGPT AI рұқсаты өшірілген. Аккаунтты қайта қосыңыз.');
      }
      const updated = {
        ...profile,
        accessToken: refreshed.access_token,
        refreshToken: typeof refreshed.refresh_token === 'string' ? refreshed.refresh_token : profile.refreshToken,
        idToken: typeof refreshed.id_token === 'string' ? refreshed.id_token : profile.idToken,
        email: typeof claims?.email === 'string' ? claims.email : profile.email,
        name: typeof claims?.name === 'string' ? claims.name : profile.name,
        scopes,
        expiresAt: now() + Math.max(60, Math.min(Number(refreshed.expires_in) || 3600, 86400)) * 1000,
        savedAt: now()
      };
      const latest = loadStore();
      const index = latest.profiles.findIndex(item => item.id === profile.id && item.subject === profile.subject && item.clientId === profile.clientId);
      if (index < 0) throw new ChatGPTPlanError('profile_changed', 'ChatGPT аккаунты ауысты. Сұрауды қайта жіберіңіз.');
      latest.profiles[index] = updated;
      saveStore(latest);
      return { profile: updated, store: latest };
    })();
    refreshPromises.set(profile.id, refreshPromise);
    try { return await refreshPromise; }
    finally { if (refreshPromises.get(profile.id) === refreshPromise) refreshPromises.delete(profile.id); }
  }

  async function requestJson(url, profile, init = {}) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...init,
        headers: { ...(init.headers || {}), authorization: `Bearer ${profile.accessToken}` },
        signal: AbortSignal.timeout(120_000)
      });
    } catch {
      throw new ChatGPTPlanError('network_error', 'OpenAI AI қызметіне қосыла алмадым. Интернетті тексеріңіз.');
    }
    return response;
  }

  async function listModels(profile) {
    const cached = modelCache.get(profile.id);
    if (cached && cached.expiresAt > now()) return cached.models;
    const response = await requestJson(`${API_BASE}/models`, profile, { method: 'GET' });
    if (!response.ok) throw new ChatGPTPlanError('model_list_failed', 'ChatGPT аккаунтындағы модельдер тізімін алу мүмкін болмады. Қайта кіріп, кейін қайталап көріңіз.');
    let result;
    try { result = await response.json(); } catch { throw new ChatGPTPlanError('model_list_failed', 'ChatGPT модельдерінің жауабы дұрыс оқылмады.'); }
    const models = Array.isArray(result.models)
      ? result.models.filter(model => model && model.visibility === 'list' && typeof model.slug === 'string').map(model => ({ slug: model.slug, displayName: typeof model.display_name === 'string' ? model.display_name : model.slug }))
      : [];
    if (!models.length) throw new ChatGPTPlanError('no_models', 'Бұл ChatGPT аккаунтында Galamtor қолдана алатын модель табылмады. Аккаунт пен жоспар қолжетімділігін тексеріңіз.');
    modelCache.set(profile.id, { models, expiresAt: now() + 10 * 60 * 1000 });
    return models;
  }

  async function streamResponse({ systemInstruction, userPrompt, chatHistory = [] }) {
    const { profile } = await getUsableProfile();
    const models = await listModels(profile);
    const input = [];
    for (const item of (Array.isArray(chatHistory) ? chatHistory.slice(-12) : [])) {
      if (!item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string') continue;
      const content = item.content.trim().slice(0, 8000);
      if (content) input.push({ role: item.role, content });
    }
    input.push({ role: 'user', content: String(userPrompt || '').slice(0, 24000) });
    const response = await requestJson(`${API_BASE}/responses`, profile, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({
        model: models[0].slug,
        instructions: String(systemInstruction || '').slice(0, 12000),
        input,
        store: false,
        stream: true
      })
    });
    if (!response.ok) {
      let code = '';
      try {
        const body = await response.text();
        if (body.length <= MAX_HTTP_BODY) code = JSON.parse(body).error?.code || '';
      } catch {}
      if (code === 'subscription_sharing_usage_limit_exceeded' || code === 'subscription_sharing_usage_unavailable') {
        throw new ChatGPTPlanError(code, 'ChatGPT жоспарының осы қолданбаға арналған лимиті аяқталды немесе уақытша қолжетімсіз. ChatGPT → Settings → Usage ішінен Galamtor лимитін қараңыз.');
      }
      if (response.status === 401) throw new ChatGPTPlanError('reauth_required', 'ChatGPT сессиясы жарамсыз. AI баптауларынан қайта кіріңіз.');
      throw new ChatGPTPlanError('inference_failed', 'ChatGPT жауабын ала алмадым. Лимит пен аккаунт рұқсатын тексеріп, қайталап көріңіз.');
    }
    if (!response.body?.getReader) throw new ChatGPTPlanError('stream_unavailable', 'ChatGPT жауабының ағынын оқу мүмкін болмады.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let output = '';
    let completed = false;
    let failureCode = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = extractSseEvents(buffer);
        buffer = parsed.remainder;
        for (const event of parsed.events) {
          if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
            output += event.delta;
            if (output.length > MAX_TEXT_RESPONSE) throw new ChatGPTPlanError('response_too_large', 'ChatGPT жауабы өте ұзын болғандықтан тоқтатылды. Қысқарақ сұрақ қойыңыз.');
          } else if (event.type === 'response.completed') {
            completed = true;
          } else if (event.type === 'response.failed' || event.type === 'error') {
            failureCode = event.response?.error?.code || event.error?.code || 'response_failed';
          } else if (event.type === 'response.incomplete') {
            failureCode = event.response?.incomplete_details?.reason || 'response_incomplete';
          }
        }
        if (failureCode) break;
        if (completed) break;
      }
    } finally {
      if (!completed || failureCode) {
        try { await reader.cancel(); } catch {}
      }
    }
    if (failureCode) {
      if (failureCode === 'subscription_sharing_usage_limit_exceeded' || failureCode === 'subscription_sharing_usage_unavailable') {
        throw new ChatGPTPlanError(failureCode, 'ChatGPT жоспарының осы қолданбаға арналған лимиті аяқталды немесе уақытша қолжетімсіз. ChatGPT → Settings → Usage ішінен Galamtor лимитін қараңыз.');
      }
      throw new ChatGPTPlanError('inference_failed', 'ChatGPT жауабы толық аяқталмады. Қысқарақ сұрақпен қайталап көріңіз.');
    }
    if (!completed) throw new ChatGPTPlanError('inference_incomplete', 'ChatGPT жауабы толық келмеді. Қайталап көріңіз.');
    return { text: output.trim() || 'ChatGPT бос жауап қайтарды.' };
  }

  async function disconnect(profileId) {
    const store = loadStore();
    const profile = store.profiles.find(item => item.id === profileId);
    if (!profile) return { removed: false, revoked: true };
    let revoked = false;
    if (profile.refreshToken) {
      try {
        const discovery = await getDiscovery();
        const response = await postForm(discovery.revocation_endpoint, {
          token: profile.refreshToken,
          token_type_hint: 'refresh_token',
          client_id: profile.clientId
        }, 'revoke_failed', 'ChatGPT сессиясын ажырату мүмкін болмады.');
        revoked = response !== null;
      } catch {
        revoked = false;
      }
    } else {
      revoked = true;
    }
    const latest = loadStore();
    latest.profiles = latest.profiles.filter(item => item.id !== profileId);
    if (latest.activeProfileId === profileId) latest.activeProfileId = latest.profiles[0]?.id || null;
    saveStore(latest);
    modelCache.delete(profileId);
    return { removed: true, revoked, state: getPublicState() };
  }

  async function openUsageSettings() {
    await openExternal('https://chatgpt.com/#settings/Usage');
    return true;
  }

  return { getPublicState, signIn, cancelSignIn, setActiveProfile, streamResponse, disconnect, openUsageSettings };
}

module.exports = {
  AUTHORIZATION_ENDPOINT,
  TOKEN_ENDPOINT,
  DISCOVERY_ENDPOINT,
  API_BASE,
  APP_NAME,
  CALLBACK_PATH,
  REQUIRED_SCOPES,
  ChatGPTPlanError,
  createChatGPTPlanClient,
  extractSseEvents,
  isSecureStorageAvailable,
  verifyOpenAIIdentityToken
};
