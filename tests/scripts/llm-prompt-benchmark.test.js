const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts/llm-prompt-benchmark.mjs");
const CAPTURE_SCHEMA = "agent-kernel/CapturedInputArtifact";

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function writeRun(rootDir, { runId, trace, captures }) {
  const runDir = join(rootDir, runId, "llm-plan");
  mkdirSync(runDir, { recursive: true });

  writeJson(join(runDir, "telemetry.json"), {
    schema: "agent-kernel/TelemetryRecord",
    schemaVersion: 1,
    meta: {
      id: `${runId}_telemetry`,
      runId,
      createdAt: "2025-01-01T00:00:00Z",
      producedBy: "cli-llm-plan",
    },
    scope: "run",
    data: {
      llm: {
        budgetLoop: true,
        trace,
      },
    },
  });

  const manifestArtifacts = [];
  captures.forEach((capture, index) => {
    const filename = `capture_llm_${runId}_${String(index + 1).padStart(2, "0")}_${capture.phase}.json`;
    const path = join(runDir, filename);
    writeJson(path, {
      schema: CAPTURE_SCHEMA,
      schemaVersion: 1,
      meta: {
        id: `capture_${runId}_${index + 1}`,
        runId,
        createdAt: "2025-01-01T00:00:00Z",
        producedBy: "orchestrator",
      },
      contentType: "application/json",
      source: { adapter: "llm", request: { model: "fixture", prompt: "prompt" } },
      payload: {
        phase: capture.phase,
        responseRaw: "{}",
        summary: {},
        errors: capture.errors,
        phaseTiming: {
          startedAt: "2025-01-01T00:00:00Z",
          endedAt: "2025-01-01T00:00:00Z",
          durationMs: capture.durationMs || 0,
        },
      },
    });
    manifestArtifacts.push({
      id: `capture_${runId}_${index + 1}`,
      schema: CAPTURE_SCHEMA,
      schemaVersion: 1,
      path: filename,
    });
  });

  writeJson(join(runDir, "manifest.json"), {
    specPath: "spec.json",
    correlation: { runId, source: "cli-llm-plan" },
    schemas: [{ schema: CAPTURE_SCHEMA, schemaVersion: 1 }],
    artifacts: manifestArtifacts,
  });
}

test("llm prompt benchmark script ranks cleaner runs above repaired runs", () => {
  const tmpRoot = mkdtempSync(join(os.tmpdir(), "agent-kernel-prompt-bench-"));

  writeRun(tmpRoot, {
    runId: "promptA_strict_rep1",
    trace: [
      { phase: "layout_only", durationMs: 100 },
      {
        phase: "actors_only",
        durationMs: 200,
        validationWarnings: [{ field: "actors", code: "insufficient_walkable_tiles" }],
      },
    ],
    captures: [
      { phase: "layout_only", errors: [], durationMs: 100 },
      { phase: "actors_only", errors: [{ field: "summary", code: "invalid_json" }], durationMs: 180 },
      { phase: "actors_only", errors: [], durationMs: 190 },
    ],
  });

  writeRun(tmpRoot, {
    runId: "promptA_resilient_rep1",
    trace: [
      { phase: "layout_only", durationMs: 80 },
      { phase: "actors_only", durationMs: 120 },
    ],
    captures: [
      { phase: "layout_only", errors: [], durationMs: 80 },
      { phase: "actors_only", errors: [], durationMs: 120 },
    ],
  });

  const noiseDir = join(tmpRoot, "noise-run");
  mkdirSync(noiseDir, { recursive: true });
  writeJson(join(noiseDir, "telemetry.json"), {
    schema: "agent-kernel/TelemetryRecord",
    schemaVersion: 1,
    meta: { id: "noise", runId: "noise", createdAt: "2025-01-01T00:00:00Z", producedBy: "cli" },
    scope: "run",
    data: {},
  });

  const result = spawnSync(process.execPath, [SCRIPT, "--root", tmpRoot, "--json"], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.analyzedRuns, 2);
  assert.ok(Array.isArray(output.leaderboard));
  assert.equal(output.leaderboard.length, 2);

  const strict = output.leaderboard.find((entry) => entry.mode === "strict");
  const resilient = output.leaderboard.find((entry) => entry.mode === "resilient");
  assert.ok(strict);
  assert.ok(resilient);
  assert.equal(strict.avgRepairsPerRun, 1);
  assert.equal(strict.avgParseErrorsPerRun, 1);
  assert.equal(strict.avgValidationWarningsPerRun, 1);
  assert.equal(resilient.avgRepairsPerRun, 0);
  assert.equal(resilient.avgParseErrorsPerRun, 0);
  assert.equal(resilient.avgValidationWarningsPerRun, 0);
  assert.ok(resilient.score > strict.score);
});

