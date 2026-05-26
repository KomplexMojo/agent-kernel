#!/usr/bin/env node
import { createServer } from "node:http";
import { stat, readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);
const ts = _require("typescript");

const TS_TRANSPILE_OPTIONS = {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ESNext,
  },
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const DEFAULT_PORT = Number(process.env.PORT) || 8001;

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

  // Transpile TypeScript files on-the-fly so the browser receives valid JavaScript.
  // ts.transpileModule strips TypeScript-specific syntax (type annotations, `as const`, etc.)
  // and preserves ES module import/export statements including .ts import paths.
  if (ext === ".ts" || ext === ".mts") {
    let content;
    try {
      content = await readFile(filePath, "utf8");
    } catch (_err) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    let output;
    try {
      output = ts.transpileModule(content, TS_TRANSPILE_OPTIONS).outputText;
    } catch (err) {
      res.statusCode = 500;
      res.end(`TypeScript transpilation error: ${err.message}`);
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    setCors(res);
    res.end(output);
    return;
  }

  const mime = MIME_TYPES[ext] || "application/octet-stream";
  res.statusCode = 200;
  res.setHeader("Content-Type", mime);
  res.setHeader("Cache-Control", "no-store, max-age=0");
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

function createUiServer() {
  const state = { ready: false };
  const server = createServer((req, res) => {
    // Redirect root to UI
    if (req.url === "/" || req.url === "") {
      res.statusCode = 302;
      res.setHeader("Location", "/packages/ui-web/index.html");
      res.end();
      return;
    }

    // Health check endpoint
    if (req.url === "/health" || req.url === "/health/") {
      setCors(res);
      if (state.ready) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ status: "ready" }));
      } else {
        res.statusCode = 503;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ status: "starting" }));
      }
      return;
    }

    if (req.method === "OPTIONS") {
      setCors(res);
      res.statusCode = 204;
      res.end();
      return;
    }
    handleStatic(req, res);
  });

  return { server, state };
}

export function listenWithPortFallback({ startPort = DEFAULT_PORT, maxAttempts = 10, hostname = "127.0.0.1" } = {}) {
  const initialAttempts = maxAttempts;

  return new Promise((resolvePromise, rejectPromise) => {
    function attempt(portToTry, remainingAttempts) {
      const { server, state } = createUiServer();

      const onError = (err) => {
        if (err.code === "EADDRINUSE" && remainingAttempts > 1) {
          const nextPort = portToTry + 1;
          console.warn(`Port ${portToTry} is in use, trying ${nextPort}...`);
          attempt(nextPort, remainingAttempts - 1);
          return;
        }

        if (err.code === "EADDRINUSE") {
          rejectPromise(new Error(`Could not find an available port after ${initialAttempts} attempts.`));
          return;
        }

        rejectPromise(err);
      };

      server.once("error", onError);
      server.listen(portToTry, hostname, () => {
        server.off("error", onError);
        state.ready = true;
        resolvePromise({
          port: portToTry,
          server,
          url: `http://localhost:${portToTry}/packages/ui-web/index.html`,
        });
      });
    }

    attempt(startPort, maxAttempts);
  });
}

async function main() {
  try {
    const { url } = await listenWithPortFallback();
    console.log(`\nServing UI at: ${url}\n`);
  } catch (error) {
    console.error(error.message || "Server error:", error);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
