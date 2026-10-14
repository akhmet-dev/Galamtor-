const { timingSafeEqual } = require('node:crypto');

function validateAuthState(receivedState, expectedState) {
  return typeof expectedState === 'string' && typeof receivedState === 'string' &&
    /^[a-f0-9]{64}$/.test(expectedState) && /^[a-f0-9]{64}$/.test(receivedState) &&
    timingSafeEqual(Buffer.from(receivedState, 'utf8'), Buffer.from(expectedState, 'utf8'));
}

function validateAuthCallback(payload, expectedState) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { status: 400, message: 'Invalid callback payload' };
  }
  const receivedState = payload.state;
  if (!validateAuthState(receivedState, expectedState)) {
    return { status: 403, message: 'Invalid login state' };
  }
  const token = value => typeof value === 'string' && value.length > 0 && value.length <= 16384 ? value : null;
  const googleIdToken = token(payload.googleIdToken);
  const googleAccessToken = token(payload.googleAccessToken);
  if (!googleIdToken && !googleAccessToken) return { status: 422, message: 'Missing credential tokens' };
  return { status: 200, payload: { googleIdToken, googleAccessToken } };
}

module.exports = { validateAuthCallback, validateAuthState };
