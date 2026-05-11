import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..", "..");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseServeUrl(output) {
  const match = output.match(/Serving UI at:\s+(http:\/\/localhost:\d+\/packages\/ui-web\/index\.html)/);
  return match ? match[1] : null;
}

export function resolveFixturePath(...parts) {
  return path.resolve(root, ...parts);
}

export async function startServeUi({ port = 0 } = {}) {
  const proc = spawn(process.execPath, ["scripts/serve-ui.mjs"], {
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
      const parsed = parseServeUrl(output);
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
