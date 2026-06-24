import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..", "..");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// serve-ui.mjs serves index_c.html by default; the entry parameter must match
// what the spawned server actually announces or startServeUi times out.
function parseServeUrl(output, entry = "index_c.html") {
  const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = output.match(
    new RegExp(`Serving UI at:\\s+(http:\\/\\/localhost:\\d+\\/packages\\/ui-web\\/${escaped})`),
  );
  return match ? match[1] : null;
}

export function resolveFixturePath(...parts) {
  return path.resolve(root, ...parts);
}

export async function startServeUi({ port = 0, entry = "index_c.html" } = {}) {
  const args = ["scripts/serve-ui.mjs", "--entry", entry];
  const proc = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  const append = (chunk) => {
    output += String(chunk);
  };
  proc.stdout.on("data", append);
  proc.stderr.on("data", append);

  const url = await new Promise((resolveUrl, reject) => {
    const startedAt = Date.now();
    const timeoutMs = 10_000;
    const interval = setInterval(() => {
      const parsed = parseServeUrl(output, entry);
      if (parsed) {
        clearInterval(interval);
        resolveUrl(parsed);
        return;
      }
      if (proc.exitCode !== null) {
        clearInterval(interval);
        reject(new Error(`serve:ui exited before announcing a URL:\n${output}`));
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(interval);
        reject(new Error(`Timed out waiting for serve:ui URL:\n${output}`));
      }
    }, 50);
  }).catch(async (error) => {
    // A failed startup must not leak the spawned server; orphans hold
    // ports 8001+ and starve every subsequent Playwright run.
    await stopProcess(proc);
    throw error;
  });

  const healthUrl = new URL("/health", url);
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    const health = await fetch(healthUrl).catch(() => null);
    if (health?.ok) {
      const payload = await health.json().catch(() => null);
      if (payload?.status === "ready") {
        return { proc, url, readOutput: () => output };
      }
    }
    await wait(50);
  }

  await stopProcess(proc);
  throw new Error(`Timed out waiting for serve:ui health readiness:\n${output}`);
}

export async function stopProcess(proc) {
  if (!proc || proc.exitCode !== null) return;
  proc.kill("SIGTERM");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (proc.exitCode !== null) return;
    await wait(50);
  }
  if (proc.exitCode === null) {
    proc.kill("SIGKILL");
  }
}
