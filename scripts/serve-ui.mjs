#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, join, extname, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const port = Number(process.env.PORT) || 8001;
const ipfsApiPort = Number(process.env.IPFS_API_PORT) || 5001;
const ipfsGatewayPort = Number(process.env.IPFS_GATEWAY_PORT) || 8080;
const ipfsProxyPort = Number(process.env.IPFS_PROXY_PORT) || 8088;
const argv = new Set(process.argv.slice(2));
const withIpfs = argv.has("--with-ipfs") || !argv.has("--static-only");
const managedChildren = [];

function uiOrigins() {
  return [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
}

function logChildStream(stream, prefix, writer) {
  const lines = readline.createInterface({ input: stream });
  lines.on("line", (line) => writer(`[${prefix}] ${line}`));
}

function spawnManagedProcess(name, command, args, env = process.env) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.stdout) {
    logChildStream(child.stdout, name, console.log);
  }
  if (child.stderr) {
    logChildStream(child.stderr, name, console.error);
  }
  return child;
}

async function requestStatus(portNumber, path, method = "GET", headers = {}) {
  try {
    const response = await fetch(`http://127.0.0.1:${portNumber}${path}`, {
      method,
      headers,
      signal: AbortSignal.timeout(1000),
    });
    return {
      ok: true,
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
    };
  } catch {
    return { ok: false, statusCode: 0, headers: {} };
  }
}

async function ipfsDaemonReady() {
  const [api, gateway] = await Promise.all([
    requestStatus(ipfsApiPort, "/api/v0/version", "POST"),
    requestStatus(ipfsGatewayPort, "/", "HEAD"),
  ]);
  return api.ok && api.statusCode === 200 && gateway.ok;
}

async function ipfsProxyReady() {
  const response = await requestStatus(
    ipfsProxyPort,
    "/api/v0/version",
    "OPTIONS",
    { Origin: uiOrigins()[1] },
  );
  return response.ok;
}

async function waitForService(name, check, child, timeoutMs = 30000) {
  const startedAt = Date.now();
  let spawnError = null;
  let exitError = null;

  const onError = (error) => {
    spawnError = new Error(`${name} failed to start: ${error.message}`);
  };
  const onExit = (code, signal) => {
    exitError = new Error(`${name} exited before becoming ready (${signal || code})`);
  };

  if (child) {
    child.once("error", onError);
    child.once("exit", onExit);
  }

  try {
    while (Date.now() - startedAt < timeoutMs) {
      if (spawnError) {
        throw spawnError;
      }
      if (exitError) {
        throw exitError;
      }
      if (await check()) {
        return;
      }
      await delay(250);
    }
  } finally {
    if (child) {
      child.off("error", onError);
      child.off("exit", onExit);
    }
  }

  throw new Error(`${name} did not become ready within ${timeoutMs}ms`);
}

function appendAllowedOrigins(existingValue) {
  const origins = [
    ...(existingValue || "").split(","),
    ...uiOrigins(),
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(origins)].join(",");
}

async function ensureIpfsDaemon() {
  if (await ipfsDaemonReady()) {
    console.log(`Using existing IPFS daemon on http://127.0.0.1:${ipfsApiPort}`);
    return;
  }

  console.log("Starting IPFS daemon...");
  const child = spawnManagedProcess("ipfs", "ipfs", ["daemon"]);
  managedChildren.push({ name: "IPFS daemon", child });
  await waitForService("IPFS daemon", ipfsDaemonReady, child);
}

async function ensureIpfsProxy() {
  if (await ipfsProxyReady()) {
    console.log(`Using existing IPFS proxy on http://127.0.0.1:${ipfsProxyPort}`);
    return;
  }

  console.log("Starting IPFS proxy...");
  const child = spawnManagedProcess(
    "ipfs-proxy",
    process.execPath,
    [resolve(root, "scripts/ipfs-local-proxy.mjs")],
    {
      ...process.env,
      IPFS_PROXY_ALLOWED_ORIGINS: appendAllowedOrigins(process.env.IPFS_PROXY_ALLOWED_ORIGINS),
    },
  );
  managedChildren.push({ name: "IPFS proxy", child });
  await waitForService("IPFS proxy", ipfsProxyReady, child);
}

async function stopManagedChildren() {
  await Promise.allSettled(
    managedChildren.map(({ child }) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
          }
        }, 2000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
        child.kill("SIGTERM");
      });
    }),
  );
}

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

let shuttingDown = false;

async function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  if (!server.listening) {
    await stopManagedChildren();
    process.exit(code);
    return;
  }
  server.close(async () => {
    await stopManagedChildren();
    process.exit(code);
  });
}

server.on("error", async (error) => {
  console.error(error.message);
  await stopManagedChildren();
  process.exit(1);
});

process.on("SIGINT", () => {
  void shutdown(0);
});

process.on("SIGTERM", () => {
  void shutdown(0);
});

async function main() {
  if (withIpfs) {
    await ensureIpfsDaemon();
    await ensureIpfsProxy();
    console.log(`IPFS gateway ready at http://127.0.0.1:${ipfsProxyPort}/ipfs`);
  }

  server.listen(port, () => {
    console.log(`Serving UI on http://localhost:${port}`);
    console.log("Open /packages/ui-web/index.html");
  });
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await stopManagedChildren();
  process.exit(1);
});
