// CLI Verification Ring (M3): the prompt-required acceptance flow
//
// Encodes deterministic CLI coverage for the full
// `create -> run -> inspect/narrate/replay` and `show` chain in a single test
// file so the M4 repair pass has one authoritative ring to drive against.
//
// This file is intentionally fixture-free: it exercises the real CLI binary
// against authored objects (--room/--delver/--warden) so the artifacts produced
// match what users actually see on disk, then chains them downstream without
// re-reading any fixtures.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd || ROOT,
    encoding: "utf8",
    env: { ...process.env, ...(options.env || {}) },
  });
}

function runCliOk(args, options = {}) {
  const result = runCli(args, options);
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`CLI failed (${result.status}): ${output}`);
  }
  return result;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function makeWorkDir(prefix) {
  return mkdtempSync(join(os.tmpdir(), prefix));
}

test("cli verification ring: create -> run -> inspect/narrate/replay", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH} — run 'pnpm run build:wasm' first.`);
    return;
  }

  const workDir = makeWorkDir("agent-kernel-cli-verify-");
  const createOut = join(workDir, "create");
  const runOut = join(workDir, "run");
  const inspectOut = join(workDir, "inspect");
  const narrateOut = join(workDir, "narrate");
  const replayOut = join(workDir, "replay");

  // Step 1: create — minimal authored objects so artifacts are deterministic.
  runCliOk([
    "create",
    "--room", "size=small;count=1",
    "--delver", "count=1;affinity=fire;motivation=attacking",
    "--warden", "count=1;affinity=dark;motivation=defending",
    "--run-id", "ring_create_run",
    "--created-at", "2026-04-26T00:00:00.000Z",
    "--out-dir", createOut,
  ]);

  const simConfig = join(createOut, "sim-config.json");
  const initialState = join(createOut, "initial-state.json");
  const bundle = join(createOut, "bundle.json");
  assert.ok(existsSync(simConfig), "create must produce sim-config.json");
  assert.ok(existsSync(initialState), "create must produce initial-state.json");
  assert.ok(existsSync(bundle), "create must produce bundle.json");

  const bundlePayload = readJson(bundle);
  assert.equal(typeof bundlePayload.spec, "object", "bundle must have a spec entry");

  // Step 2: run — drive the simulation forward by one tick.
  runCliOk([
    "run",
    "--sim-config", simConfig,
    "--initial-state", initialState,
    "--ticks", "1",
    "--wasm", WASM_PATH,
    "--out-dir", runOut,
  ]);

  const tickFrames = join(runOut, "tick-frames.json");
  const effectsLog = join(runOut, "effects-log.json");
  const runSummary = join(runOut, "run-summary.json");
  assert.ok(existsSync(tickFrames), "run must produce tick-frames.json");
  assert.ok(existsSync(effectsLog), "run must produce effects-log.json");
  assert.ok(existsSync(runSummary), "run must produce run-summary.json");

  // Step 3: inspect — produce an inspect-summary from the run output.
  runCliOk([
    "inspect",
    "--tick-frames", tickFrames,
    "--effects-log", effectsLog,
    "--out-dir", inspectOut,
  ]);
  const inspectSummary = join(inspectOut, "inspect-summary.json");
  assert.ok(existsSync(inspectSummary), "inspect must produce inspect-summary.json");
  const inspectPayload = readJson(inspectSummary);
  // inspect emits a TelemetryRecord scoped to "run" — the per-run summary surface.
  assert.equal(inspectPayload.schema, "agent-kernel/TelemetryRecord");
  assert.equal(inspectPayload.scope, "run");
  assert.ok(inspectPayload.data && typeof inspectPayload.data.ticks === "number");

  // Step 4: narrate — produce a narrative from tick-frames + initial-state.
  runCliOk([
    "narrate",
    "--tick-frames", tickFrames,
    "--initial-state", initialState,
    "--out-dir", narrateOut,
  ]);
  const narrative = join(narrateOut, "narrative.json");
  assert.ok(existsSync(narrative), "narrate must produce narrative.json");

  // Step 5: replay — re-execute the recorded tick-frames and confirm the replay summary lands.
  runCliOk([
    "replay",
    "--sim-config", simConfig,
    "--initial-state", initialState,
    "--tick-frames", tickFrames,
    "--wasm", WASM_PATH,
    "--out-dir", replayOut,
  ]);
  const replaySummary = join(replayOut, "replay-summary.json");
  const replayFrames = join(replayOut, "replay-tick-frames.json");
  assert.ok(existsSync(replaySummary), "replay must produce replay-summary.json");
  assert.ok(existsSync(replayFrames), "replay must produce replay-tick-frames.json");
});

test("cli verification ring: show resolves a default-path run from artifacts/runs/<id>", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH} — run 'pnpm run build:wasm' first.`);
    return;
  }
  const workDir = makeWorkDir("agent-kernel-show-verify-");

  // Use the default --out-dir so artifacts land under artifacts/runs/<id>.
  runCliOk([
    "create",
    "--room", "size=small;count=1",
    "--delver", "count=1;affinity=fire;motivation=attacking",
    "--warden", "count=1;affinity=dark;motivation=defending",
    "--run-id", "ring_show_run",
    "--created-at", "2026-04-26T00:00:00.000Z",
  ], { cwd: workDir });

  const showResult = runCliOk(["show", "--run-id", "ring_show_run"], { cwd: workDir });
  // The CLI prints both human-readable lines and a final JSON envelope.
  // Find the JSON envelope on stdout.
  const lines = showResult.stdout.trim().split("\n");
  const jsonLine = lines.reverse().find((line) => line.startsWith("{"));
  assert.ok(jsonLine, "show must emit a JSON envelope on stdout");
  const payload = JSON.parse(jsonLine);
  assert.equal(payload.ok, true);
  assert.equal(payload.runId, "ring_show_run");
  assert.equal(payload.status, "success");
  assert.ok(Array.isArray(payload.commands) && payload.commands.length >= 1);
  assert.equal(payload.commands[0].command, "create");
});

test("cli verification ring: --from-run chains create into run when default paths are used", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH} — run 'pnpm run build:wasm' first.`);
    return;
  }
  const workDir = makeWorkDir("agent-kernel-from-run-verify-");

  runCliOk([
    "create",
    "--room", "size=small;count=1",
    "--delver", "count=1;affinity=fire;motivation=attacking",
    "--warden", "count=1;affinity=dark;motivation=defending",
    "--run-id", "ring_from_run",
    "--created-at", "2026-04-26T00:00:00.000Z",
  ], { cwd: workDir });

  runCliOk([
    "run",
    "--from-run", "ring_from_run",
    "--wasm", WASM_PATH,
    "--ticks", "1",
  ], { cwd: workDir });

  const tickFrames = join(workDir, "artifacts", "runs", "ring_from_run", "run", "tick-frames.json");
  assert.ok(existsSync(tickFrames), "--from-run must produce tick-frames under artifacts/runs/<id>/run/");
});

test("narrate without --initial-state exits non-zero with a stable error message", () => {
  const result = runCli(["narrate", "--tick-frames", "/dev/null"]);
  assert.notEqual(result.status, 0, "narrate without --initial-state must exit non-zero");
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.command, "narrate");
  assert.ok(typeof output.error === "string" && output.error.length > 0, "error field must name the missing argument");
});

test("show against a non-existent run-id returns ok=false and names the missing directory", () => {
  const result = runCli(["show", "--run-id", "run_does_not_exist_99"]);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.command, "show");
  assert.match(output.error, /run_does_not_exist_99/, "error must name the missing run-id");
});

test("show without --run-id exits non-zero with a stable argument error", () => {
  const result = runCli(["show"]);
  assert.notEqual(result.status, 0, "show without --run-id must exit non-zero");
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.command, "show");
  assert.match(output.error, /--run-id/, "error must reference the missing --run-id flag");
});
