import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listen(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, resolve);
  });
  return server.address();
}

async function closeServer(server) {
  if (!server || !server.listening) return;
  await new Promise((resolve) => server.close(resolve));
}

async function isPortFree(portToCheck) {
  const probe = createServer();
  try {
    await listen(probe, portToCheck);
    return true;
  } catch {
    return false;
  } finally {
    await closeServer(probe);
  }
}

async function findBusyPortWithFreeSuccessor() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const blocker = createServer((req, res) => res.end("occupied"));
    const address = await listen(blocker);
    const occupiedPort = Number(address?.port);
    const fallbackPort = occupiedPort + 1;
    if (Number.isFinite(occupiedPort) && fallbackPort < 65535 && await isPortFree(fallbackPort)) {
      return { blocker, occupiedPort, fallbackPort };
    }
    await closeServer(blocker);
  }
  throw new Error("Could not find a busy port with an available successor.");
}

function parseServeUrl(output) {
  const match = output.match(/Serving UI at:\s+(http:\/\/localhost:\d+\/packages\/ui-web\/index\.html)/);
  return match ? match[1] : null;
}

async function startServeUi({ port }) {
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

  const url = await new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timeoutMs = 10_000;
    const interval = setInterval(() => {
      const parsed = parseServeUrl(output);
      if (parsed) {
        clearInterval(interval);
        resolve(parsed);
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

async function stopProcess(proc) {
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

function parsePlaywrightJson(rawOutput) {
  const trimmed = String(rawOutput || "").trim();
  const jsonText = trimmed.startsWith("\"") ? JSON.parse(trimmed) : trimmed;
  return JSON.parse(jsonText);
}

test("serve-ui announces the actual fallback port and serves the current ui-web index", async () => {
  const { blocker, occupiedPort, fallbackPort } = await findBusyPortWithFreeSuccessor();
  let served;
  try {
    served = await startServeUi({ port: occupiedPort });
    const url = new URL(served.url);

    assert.equal(url.port, String(fallbackPort));
    assert.match(served.readOutput(), new RegExp(`Port ${occupiedPort} is in use, trying ${fallbackPort}...`));

    const res = await fetch(served.url);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /id="runtime-move-up-left"/);
    assert.match(html, /id="runtime-affinity-choice-fire"[^>]*disabled/);
  } finally {
    await closeServer(blocker);
    await stopProcess(served?.proc);
  }
});

test("served Run tab keeps diagonal controls and disabled affinity placeholders after bundle load", async (t) => {
  const playwrightCheck = spawnSync("playwright-cli", ["--help"], { cwd: root, stdio: "ignore" });
  if (playwrightCheck.status !== 0) {
    t.skip("playwright-cli is unavailable in this environment");
    return;
  }

  const served = await startServeUi({ port: 0 });
  const session = `rt-${process.pid}-${Date.now().toString(36)}`;

  try {
    execFileSync("playwright-cli", [`-s=${session}`, "open", served.url], {
      cwd: root,
      stdio: "pipe",
    });

    const rawState = execFileSync(
      "playwright-cli",
      [
        `-s=${session}`,
        "--raw",
        "run-code",
        `async page => {
          await page.waitForFunction(() => Boolean(document.querySelector('[data-tab="diagnostics"]')));
          await page.evaluate(() => document.querySelector('[data-tab="diagnostics"]').click());
          await page.waitForFunction(() => document.querySelector('[data-tab-panel="diagnostics"]')?.hidden === false);
          await page.setInputFiles('#bundle-file', 'bundle.json');
          await page.waitForFunction(() => document.querySelector('#bundle-status')?.textContent?.includes('Bundle loaded'));
          await page.evaluate(() => document.querySelector('[data-tab="simulation"]').click());
          await page.waitForFunction(() => document.querySelector('[data-tab-panel="simulation"]')?.hidden === false);
          return await page.evaluate(() => JSON.stringify({
            movementIds: Array.from(document.querySelectorAll('.runtime-controls button')).map((el) => el.id),
            affinityButtons: Array.from(document.querySelectorAll('.runtime-affinity-placeholders button')).map((el) => ({
              id: el.id,
              disabled: el.disabled,
            })),
          }));
        }`,
      ],
      {
        cwd: root,
        encoding: "utf8",
      },
    );

    const state = parsePlaywrightJson(rawState);
    assert.deepEqual(state.movementIds, [
      "runtime-move-up-left",
      "runtime-move-up",
      "runtime-move-up-right",
      "runtime-move-left",
      "runtime-cast",
      "runtime-move-right",
      "runtime-move-down-left",
      "runtime-move-down",
      "runtime-move-down-right",
    ]);
    assert.deepEqual(state.affinityButtons, [
      { id: "runtime-affinity-choice-fire", disabled: true },
      { id: "runtime-affinity-choice-water", disabled: true },
      { id: "runtime-affinity-choice-earth", disabled: true },
      { id: "runtime-affinity-expression-expand", disabled: true },
      { id: "runtime-affinity-expression-focus", disabled: true },
      { id: "runtime-affinity-expression-shift", disabled: true },
    ]);
  } finally {
    try {
      execFileSync("playwright-cli", [`-s=${session}`, "close"], {
        cwd: root,
        stdio: "pipe",
      });
    } catch {}
    await stopProcess(served.proc);
  }
});
