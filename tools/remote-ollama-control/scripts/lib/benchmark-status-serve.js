'use strict';

/**
 * Local HITL front-door for the benchmark status page.
 *
 * Opening the HTML as file:// cannot talk to Ollama: browsers treat file origins as opaque and
 * Ollama's CORS defaults refuse them. Serving the page from 127.0.0.1 and proxying /ollama/* onto
 * the local Ollama host keeps the replay button same-origin from the page's point of view.
 */

const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const { URL } = require('url');

function proxyToOllama(req, res, ollamaBase, pathAndQuery) {
  const target = new URL(pathAndQuery, ollamaBase);
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const headers = { host: target.host };
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    if (body.length) headers['content-length'] = String(body.length);

    const upstream = http.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 80,
        path: `${target.pathname}${target.search}`,
        method: req.method,
        headers,
      },
      (up) => {
        res.writeHead(up.statusCode || 502, {
          'content-type': up.headers['content-type'] || 'application/json',
          'cache-control': 'no-store',
        });
        up.pipe(res);
      },
    );
    upstream.on('error', (error) => {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    });
    if (body.length) upstream.write(body);
    upstream.end();
  });
}

/**
 * Serve `htmlPath` and proxy `/ollama/*` to `ollamaHost`. Returns when the server is listening.
 * Caller owns lifetime (SIGINT / close).
 */
function serveStatusPage({
  htmlPath,
  ollamaHost = 'http://127.0.0.1:11434',
  openBrowser = true,
  port = 0,
} = {}) {
  if (!htmlPath || !fs.existsSync(htmlPath)) {
    throw new Error(`status page not found: ${htmlPath}`);
  }
  const html = fs.readFileSync(htmlPath);
  const ollamaBase = String(ollamaHost).replace(/\/$/, '');

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(html);
      return;
    }
    if (url.pathname.startsWith('/ollama/')) {
      const rest = url.pathname.slice('/ollama'.length) + url.search;
      proxyToOllama(req, res, ollamaBase, rest);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const pageUrl = `http://127.0.0.1:${address.port}/`;
      if (openBrowser) {
        spawn('open', [pageUrl], { stdio: 'ignore', detached: true }).unref();
      }
      resolve({ server, pageUrl, ollamaBase });
    });
    server.on('error', reject);
  });
}

module.exports = { serveStatusPage };
