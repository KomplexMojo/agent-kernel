'use strict';

const http = require('http');
const https = require('https');

function requestJson(baseUrl, apiPath, body, timeoutMs = 1800000) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiPath, baseUrl);
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(
      url,
      {
        method: payload ? 'POST' : 'GET',
        timeout: timeoutMs,
        headers: payload
          ? {
              'content-type': 'application/json',
              'content-length': String(payload.length)
            }
          : {}
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed = {};
          if (text.trim()) {
            try {
              parsed = JSON.parse(text);
            } catch (error) {
              error.message = `Invalid JSON from ${url}: ${error.message}`;
              error.raw = text;
              reject(error);
              return;
            }
          }
          if (response.statusCode < 200 || response.statusCode >= 300) {
            // This message is the whole account of an infrastructure failure, which aborts a
            // content-gen run outright. Two ways it used to lose that account: Ollama can answer
            // with a structured `error` object, and `new Error(object)` renders "[object Object]";
            // and when any body message existed the status and url were dropped entirely. Keep
            // both, always.
            const detail = typeof parsed.error === 'string'
              ? parsed.error
              : (parsed.error ? JSON.stringify(parsed.error) : '');
            const error = new Error(
              `HTTP ${response.statusCode} from ${url}${detail ? `: ${detail}` : ''}`
            );
            error.statusCode = response.statusCode;
            error.body = parsed;
            reject(error);
            return;
          }
          resolve(parsed);
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(new Error(`Timed out after ${timeoutMs}ms: ${url}`));
    });
    request.on('error', reject);
    if (payload) {
      request.write(payload);
    }
    request.end();
  });
}

async function health(baseUrl) {
  try {
    const version = await requestJson(baseUrl, '/api/version', undefined, 2500);
    return { ok: true, version };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = {
  health,
  requestJson
};
