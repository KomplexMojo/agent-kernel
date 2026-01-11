#!/usr/bin/env node
import { createServer } from "node:http";
import { stat, readFile, writeFile, mkdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, join, extname, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

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
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, payload) {
  setCors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0] || "/");
  const target = resolve(root, "." + decoded);
  if (!target.startsWith(root)) {
    return null;
  }
  return target;
}

function resolveWithinRoot(pathValue) {
  if (!pathValue) return null;
  const resolved = resolve(root, pathValue);
  if (!resolved.startsWith(root)) {
    return null;
  }
  return resolved;
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

async function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const parsed = raw ? JSON.parse(raw) : {};
        resolveBody(parsed);
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function runCliBuild({ specPath, outDir }) {
  return new Promise((resolveBuild, rejectBuild) => {
    const cmd = process.execPath;
    const args = ["packages/adapters-cli/src/cli/ak.mjs", "build", "--spec", specPath, "--out-dir", outDir];
    const child = spawn(cmd, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => rejectBuild(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolveBuild({ stdout, stderr });
      } else {
        const error = new Error(`build exited with code ${code}${stderr ? `: ${stderr}` : ""}`);
        rejectBuild(error);
      }
    });
  });
}

async function readJsonFile(path) {
  const text = await readFile(path, "utf8");
  return JSON.parse(text);
}

async function handleBridgeBuild(req, res) {
  if (req.method === "OPTIONS") {
    setCors(res);
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  try {
    const body = await readBody(req);
    const { specPath: rawSpecPath, specJson, outDir: rawOutDir } = body || {};
    if (!rawSpecPath && !specJson) {
      sendJson(res, 400, { error: "specPath or specJson is required." });
      return;
    }
    if (rawSpecPath && specJson) {
      sendJson(res, 400, { error: "Provide specPath or specJson, not both." });
      return;
    }

    let specPath = null;
    if (rawSpecPath) {
      specPath = resolveWithinRoot(rawSpecPath);
      if (!specPath) {
        sendJson(res, 400, { error: "specPath must be inside the repo." });
        return;
      }
    }

    const runId = specJson?.meta?.runId || (rawSpecPath ? "" : `bridge_${Date.now()}`);
    const desiredOutDir = rawOutDir || (runId ? `artifacts/build_${runId}` : "");
    const outDir = resolveWithinRoot(desiredOutDir);
    if (!outDir) {
      sendJson(res, 400, { error: "outDir must be inside the repo." });
      return;
    }
    await mkdir(outDir, { recursive: true });

    if (specJson && !specPath) {
      specPath = join(outDir, "spec.json");
      await writeFile(specPath, JSON.stringify(specJson, null, 2), "utf8");
    }

    await runCliBuild({ specPath, outDir });

    let manifest = null;
    let bundle = null;
    let telemetry = null;
    let spec = null;
    try {
      manifest = await readJsonFile(join(outDir, "manifest.json"));
    } catch (error) {
      manifest = null;
    }
    try {
      bundle = await readJsonFile(join(outDir, "bundle.json"));
    } catch (error) {
      bundle = null;
    }
    try {
      telemetry = await readJsonFile(join(outDir, "telemetry.json"));
    } catch (error) {
      telemetry = null;
    }
    try {
      spec = await readJsonFile(join(outDir, "spec.json"));
    } catch (error) {
      spec = specJson || null;
    }

    sendJson(res, 200, {
      specPath: specPath ? relative(root, specPath) : null,
      outDir: relative(root, outDir),
      manifest,
      bundle,
      telemetry,
      spec,
    });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || String(error) });
  }
}

const server = createServer((req, res) => {
  const urlPath = (req.url || "").split("?")[0];
  if (urlPath === "/bridge/build") {
    handleBridgeBuild(req, res);
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

server.listen(port, () => {
  console.log(`Serving UI + build bridge on http://localhost:${port}`);
  console.log("Open /packages/ui-web/index.html");
});
