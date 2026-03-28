#!/usr/bin/env node
import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const port = Number(process.env.PORT) || 8001;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".txt": "text/plain; charset=utf-8",
};

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0] || "/");
  const target = resolve(root, `.${decoded}`);
  if (!target.startsWith(root)) {
    return null;
  }
  return target;
}

async function handleStatic(req, res) {
  const target = safePath(req.url || "/");
  if (!target) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  let filePath = target;
  let stats;
  try {
    stats = await stat(filePath);
  } catch (error) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }

  if (stats.isDirectory()) {
    filePath = join(filePath, "index.html");
  }

  const ext = extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || "application/octet-stream";
  res.statusCode = 200;
  res.setHeader("Content-Type", mime);
  setCors(res);

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  const stream = createReadStream(filePath);
  stream.on("error", () => {
    res.statusCode = 500;
    res.end("Failed to read file");
  });
  stream.pipe(res);
}

const server = createServer((req, res) => {
  if (req.method === "OPTIONS") {
    setCors(res);
    res.statusCode = 204;
    res.end();
    return;
  }
  handleStatic(req, res);
});

function tryListen(portToTry, maxAttempts = 10) {
  server.listen(portToTry, () => {
    const url = `http://localhost:${portToTry}/packages/ui-web/index.html`;
    console.log(`\nServing UI at: ${url}\n`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      const nextPort = portToTry + 1;
      const remainingAttempts = maxAttempts - 1;

      if (remainingAttempts > 0) {
        console.warn(`Port ${portToTry} is in use, trying ${nextPort}...`);
        server.close();
        tryListen(nextPort, remainingAttempts);
      } else {
        console.error(`Could not find an available port after ${maxAttempts} attempts.`);
        process.exit(1);
      }
    } else {
      console.error("Server error:", err);
      process.exit(1);
    }
  });
}

tryListen(port);
