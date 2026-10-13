'use strict';

const https = require('node:https');

const NCALAYER_HOST = '127.0.0.1';
const NCALAYER_PORT = 13579;
const TLS_ERROR_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED'
]);

function classifyNcaLayerError(error) {
  if (error?.code === 'ECONNREFUSED') return 'stopped';
  if (TLS_ERROR_CODES.has(error?.code)) return 'certificate';
  return 'unreachable';
}

function checkNcaLayer({ timeoutMs = 1800, request = https.request } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let req;
    try {
      req = request({
        protocol: 'https:',
        hostname: NCALAYER_HOST,
        port: NCALAYER_PORT,
        path: '/',
        method: 'GET',
        rejectUnauthorized: true,
        timeout: timeoutMs
      }, (response) => {
        response.resume?.();
        finish({ available: true, statusCode: Number(response.statusCode) || 0 });
      });
    } catch {
      finish({ available: false, reason: 'unreachable' });
      return;
    }

    req.on('error', (error) => finish({
      available: false,
      reason: classifyNcaLayerError(error)
    }));
    req.on('timeout', () => {
      const error = new Error('NCALayer local check timed out');
      error.code = 'ETIMEDOUT';
      req.destroy(error);
      finish({ available: false, reason: 'unreachable' });
    });
    req.end();
  });
}

module.exports = {
  NCALAYER_HOST,
  NCALAYER_PORT,
  classifyNcaLayerError,
  checkNcaLayer
};
