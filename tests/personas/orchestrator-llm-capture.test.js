const assert = require("node:assert/strict");



test("orchestrator captures llm prompt/response as artifact", async () => {
const { buildLlmCaptureArtifact } = await import("../../packages/runtime/src/personas/orchestrator/llm-capture.js");
const { orchestrateBuild } = await import("../../packages/runtime/src/build/orchestrate-build.js");

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
  responseText: "{\"ok\":true}",
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
assert.equal(captureResult.capture.payload.responseRaw, "{\"ok\":true}");

const buildResult = await orchestrateBuild({
  spec,
  producedBy: "runtime-build",
  capturedInputs: [captureResult.capture],
});

assert.ok(Array.isArray(buildResult.capturedInputs));
assert.equal(buildResult.capturedInputs.length, 1);
assert.deepEqual(buildResult.capturedInputs[0], captureResult.capture);
});
