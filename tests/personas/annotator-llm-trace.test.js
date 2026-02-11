const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const llmTraceModulePath = moduleUrl("packages/runtime/src/personas/annotator/llm-trace.js");

const script = `
import assert from "node:assert/strict";
import {
  isLlmCaptureArtifact,
  buildLlmTraceTurns,
  summarizeLlmTrace,
  buildLlmTraceTelemetryRecord,
} from ${JSON.stringify(llmTraceModulePath)};

const llmCaptureB = {
  schema: "agent-kernel/CapturedInputArtifact",
  schemaVersion: 1,
  meta: {
    id: "capture_b",
    runId: "run_test",
    createdAt: "2026-02-08T10:00:01.000Z",
    producedBy: "orchestrator",
  },
  source: {
    adapter: "ollama",
    request: {
      model: "phi4",
      baseUrl: "http://localhost:11434",
      prompt: "phase layout",
    },
  },
  contentType: "application/json",
  payload: {
    prompt: "phase layout",
    responseRaw: "{\\"layout\\":{\\"wallTiles\\":12}}",
    phase: "layout_only",
    phaseTiming: {
      durationMs: 100,
    },
  },
};

const llmCaptureA = {
  schema: "agent-kernel/CapturedInputArtifact",
  schemaVersion: 1,
  meta: {
    id: "capture_a",
    runId: "run_test",
    createdAt: "2026-02-08T10:00:02.000Z",
    producedBy: "orchestrator",
  },
  source: {
    adapter: "llm",
    request: {
      model: "phi4",
      baseUrl: "http://localhost:11434",
      prompt: "phase actors",
    },
  },
  contentType: "application/json",
  payload: {
    prompt: "phase actors",
    responseRaw: "{\\"actors\\":[]}",
    responseParsed: { actors: [] },
    phase: "actors_only",
    phaseTiming: {
      durationMs: 250,
    },
    errors: [{ code: "missing_actors" }],
  },
};

const nonLlmCapture = {
  schema: "agent-kernel/CapturedInputArtifact",
  schemaVersion: 1,
  meta: {
    id: "capture_other",
    runId: "run_test",
    createdAt: "2026-02-08T10:00:00.000Z",
    producedBy: "orchestrator",
  },
  source: {
    adapter: "ipfs",
  },
  contentType: "application/json",
  payload: {},
};

assert.equal(isLlmCaptureArtifact(llmCaptureA), true);
assert.equal(isLlmCaptureArtifact(llmCaptureB), true);
assert.equal(isLlmCaptureArtifact(nonLlmCapture), false);

const turns = buildLlmTraceTurns([llmCaptureA, nonLlmCapture, llmCaptureB]);
assert.equal(turns.length, 2);
assert.equal(turns[0].id, "capture_b");
assert.equal(turns[1].id, "capture_a");
assert.equal(turns[0].status, "ok");
assert.equal(turns[1].status, "error");
assert.equal(turns[1].errorCount, 1);

const summary = summarizeLlmTrace([llmCaptureA, nonLlmCapture, llmCaptureB]);
assert.equal(summary.turnCount, 2);
assert.equal(summary.errorTurns, 1);
assert.equal(summary.errorCount, 1);
assert.equal(summary.phases.layout_only, 1);
assert.equal(summary.phases.actors_only, 1);
assert.deepEqual(summary.models, ["phi4"]);
assert.deepEqual(summary.baseUrls, ["http://localhost:11434"]);
assert.equal(summary.durationMs.total, 350);
assert.equal(summary.durationMs.samples, 2);
assert.equal(summary.durationMs.min, 100);
assert.equal(summary.durationMs.max, 250);

const telemetry = buildLlmTraceTelemetryRecord({
  captures: [llmCaptureA, nonLlmCapture, llmCaptureB],
  runId: "run_test",
  createdAt: "2026-02-08T10:00:10.000Z",
});
assert.equal(telemetry.schema, "agent-kernel/TelemetryRecord");
assert.equal(telemetry.meta.runId, "run_test");
assert.equal(telemetry.data.kind, "llm_trace");
assert.equal(telemetry.data.summary.turnCount, 2);
assert.equal(telemetry.data.turns.length, 2);
assert.equal(telemetry.data.turns[0].id, "capture_b");
assert.equal(telemetry.data.turns[1].id, "capture_a");
`;

test("annotator llm trace helper summarizes orchestrator captures", () => {
  runEsm(script);
});
