'use strict';

const http = require('node:http');

const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;
const MAX_STATUS_BYTES = 1_000_000;
const MAX_PULL_LINE_BYTES = 1_000_000;

function normalizeModelReference(modelName) {
  const value = typeof modelName === 'string' ? modelName.trim() : '';
  if (!value) return '';
  return value.includes(':') ? value : value + ':latest';
}

function isModelInstalled(models, modelName) {
  const target = normalizeModelReference(modelName);
  if (!target || !Array.isArray(models)) return false;
  return models.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    return [entry.name, entry.model].some((candidate) =>
      typeof candidate === 'string' && normalizeModelReference(candidate) === target
    );
  });
}

function checkOllamaStatus(modelName, timeoutMs = 2200, endpoint = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let responseBody = '';
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let request;
    try {
      request = http.get({
        hostname: endpoint.host || OLLAMA_HOST,
        port: Number.isInteger(endpoint.port) ? endpoint.port : OLLAMA_PORT,
        path: '/api/tags',
        timeout: timeoutMs
      }, (response) => {
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
          if (responseBody.length > MAX_STATUS_BYTES) {
            request.destroy(new Error('Ollama response too large'));
          }
        });
        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            finish({ available: false, installed: false, reason: 'unavailable' });
            return;
          }
          try {
            const payload = JSON.parse(responseBody);
            const models = Array.isArray(payload.models) ? payload.models : [];
            finish({
              available: true,
              installed: isModelInstalled(models, modelName),
              modelName,
              installedModels: models
                .map((entry) => entry && (entry.name || entry.model))
                .filter((name) => typeof name === 'string')
                .slice(0, 30)
            });
          } catch {
            finish({ available: false, installed: false, reason: 'invalid-response' });
          }
        });
      });
    } catch {
      finish({ available: false, installed: false, reason: 'unavailable' });
      return;
    }

    request.on('timeout', () => request.destroy(new Error('Ollama status timed out')));
    request.on('error', () => finish({ available: false, installed: false, reason: 'unavailable' }));
  });
}

function pullOllamaModel(modelName, onProgress = () => {}, options = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let buffer = '';
    let sawSuccess = false;
    let streamError = '';
    const payload = JSON.stringify({ name: modelName, stream: true });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    if (options.signal?.aborted) {
      finish({ success: false, cancelled: true, error: 'Модель жүктеуі тоқтатылды.' });
      return;
    }
    const emit = (entry) => {
      try { onProgress(entry); } catch {}
    };
    const parseLine = (line) => {
      if (!line.trim()) return;
      let entry;
      try { entry = JSON.parse(line); } catch { return; }
      if (entry.error) {
        streamError = String(entry.error).slice(0, 300);
        emit({ status: 'error', error: streamError });
        return;
      }
      const total = Number.isFinite(entry.total) ? entry.total : null;
      const completed = Number.isFinite(entry.completed) ? entry.completed : null;
      const status = typeof entry.status === 'string' ? entry.status.slice(0, 100) : '';
      const percent = total > 0 && completed !== null
        ? Math.max(0, Math.min(100, Math.round(completed / total * 100)))
        : null;
      if (status === 'success') sawSuccess = true;
      emit({ status, completed, total, percent });
    };
    const consumeBuffer = (flush = false) => {
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        parseLine(buffer.slice(0, newlineIndex));
        buffer = buffer.slice(newlineIndex + 1);
      }
      if (flush && buffer.trim()) {
        parseLine(buffer);
        buffer = '';
      }
      if (buffer.length > MAX_PULL_LINE_BYTES) {
        streamError = 'Ollama жауабының көлемі күтілгеннен үлкен.';
        buffer = '';
      }
    };

    let request;
    try {
      request = http.request({
        hostname: options.host || OLLAMA_HOST,
        port: Number.isInteger(options.port) ? options.port : OLLAMA_PORT,
        path: '/api/pull',
        method: 'POST',
        signal: options.signal,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (response) => {
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          buffer += chunk;
          consumeBuffer();
        });
        response.on('end', () => {
          consumeBuffer(true);
          if (response.statusCode < 200 || response.statusCode >= 300) {
            finish({ success: false, error: streamError || 'Ollama модельді жүктей алмады.' });
          } else if (streamError) {
            finish({ success: false, error: streamError });
          } else if (sawSuccess) {
            finish({ success: true });
          } else {
            finish({ success: false, error: 'Жүктеу аяқталды, бірақ модельдің орнатылғаны расталмады.' });
          }
        });
      });
    } catch {
      finish({ success: false, error: 'Ollama серверіне қосылу мүмкін болмады.' });
      return;
    }

    request.setTimeout(30 * 60 * 1000, () => request.destroy(new Error('Ollama pull timed out')));
    request.on('error', (error) => {
      if (options.signal?.aborted || error.name === 'AbortError') {
        finish({ success: false, cancelled: true, error: 'Модель жүктеуі тоқтатылды.' });
      } else {
        finish({ success: false, error: 'Ollama серверіне қосылу үзілді. Қайта тексеріңіз.' });
      }
    });
    request.write(payload);
    request.end();
  });
}

module.exports = {
  normalizeModelReference,
  isModelInstalled,
  checkOllamaStatus,
  pullOllamaModel
};
