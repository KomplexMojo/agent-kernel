const test = require("node:test");
const assert = require("node:assert/strict");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const captureModulePath = moduleUrl("packages/runtime/src/personas/orchestrator/llm-capture.js");
const orchestrateBuildPath = moduleUrl("packages/runtime/src/build/orchestrate-build.js");

const script = `
import assert from "node:assert/strict";
import { buildLlmCaptureArtifact } from ${JSON.stringify(captureModulePath)};
import { orchestrateBuild } from ${JSON.stringify(orchestrateBuildPath)};

const spec = {
  schema: "agent-kernel/BuildSpec",
  schemaVersion: 1,
  meta: {
    id: "spec_capture_fixture",
    runId: "run_capture_fixture",
    createdAt: "2025-01-01T00:00:00Z",
    source: "fixture",
  },
  intent: {
    goal: "capture test",
  },
};

const captureResult = buildLlmCaptureArtifact({
  prompt: "Return JSON only.",
  responseText: "{\\"ok\\":true}",
  responseParsed: { ok: true },
  model: "mistral",
  baseUrl: "http://localhost:11434",
  runId: spec.meta.runId,
  producedBy: "orchestrator",
  clock: () => spec.meta.createdAt,
});

assert.equal(captureResult.errors, undefined);
assert.equal(captureResult.capture.schema, "agent-kernel/CapturedInputArtifact");
assert.equal(captureResult.capture.source.adapter, "llm");
assert.equal(captureResult.capture.source.request.model, "mistral");
assert.equal(captureResult.capture.payload.prompt, "Return JSON only.");
assert.equal(captureResult.capture.payload.responseRaw, "{\\"ok\\":true}");

const buildResult = await orchestrateBuild({
  spec,
  producedBy: "runtime-build",
  capturedInputs: [captureResult.capture],
});

assert.ok(Array.isArray(buildResult.capturedInputs));
assert.equal(buildResult.capturedInputs.length, 1);
assert.deepEqual(buildResult.capturedInputs[0], captureResult.capture);
`;

test("orchestrator captures llm prompt/response as artifact", () => {
  runEsm(script);
});
