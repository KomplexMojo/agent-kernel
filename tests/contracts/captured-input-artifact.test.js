const assert = require("node:assert/strict");

test("buildLlmCaptureArtifact creates a real CapturedInputArtifact payload", async () => {
  const { buildLlmCaptureArtifact } = await import(
    "../../packages/runtime/src/personas/orchestrator/llm-capture.js"
  );

  const result = buildLlmCaptureArtifact({
    prompt: "Return JSON only.",
    responseText: "{\"ok\":true}",
    responseParsed: { ok: true },
    model: "qwen3-coder",
    baseUrl: "http://localhost:11434",
    options: { temperature: 0 },
    requestId: "req_capture_1",
    runId: "run_capture_source_backed",
    producedBy: "orchestrator",
    clock: () => "2026-06-11T00:00:00.000Z",
  });

  assert.equal(result.errors, undefined);
  assert.equal(result.capture.schema, "agent-kernel/CapturedInputArtifact");
  assert.equal(result.capture.schemaVersion, 1);
  assert.equal(result.capture.source.adapter, "llm");
  assert.equal(result.capture.source.requestId, "req_capture_1");
  assert.equal(result.capture.source.request.model, "qwen3-coder");
  assert.equal(result.capture.contentType, "application/json");
  assert.deepEqual(result.capture.payload.responseParsed, { ok: true });
});

test("orchestrateBuild carries captured input artifacts through unchanged", async () => {
  const [{ buildLlmCaptureArtifact }, { orchestrateBuild }] = await Promise.all([
    import("../../packages/runtime/src/personas/orchestrator/llm-capture.js"),
    import("../../packages/runtime/src/build/orchestrate-build.js"),
  ]);

  const capture = buildLlmCaptureArtifact({
    prompt: "Return JSON only.",
    responseText: "{\"ok\":true}",
    responseParsed: { ok: true },
    model: "qwen3-coder",
    runId: "run_capture_passthrough",
    producedBy: "orchestrator",
    clock: () => "2026-06-11T00:00:00.000Z",
  }).capture;
  const spec = {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: {
      id: "spec_capture_passthrough",
      runId: "run_capture_passthrough",
      createdAt: "2026-06-11T00:00:00.000Z",
      source: "test",
    },
    intent: { goal: "capture passthrough" },
  };

  const result = await orchestrateBuild({ spec, producedBy: "runtime-build", capturedInputs: [capture] });

  assert.deepEqual(result.capturedInputs, [capture]);
});

test("buildLlmCaptureArtifact reports errors for missing required production inputs", async () => {
  const { buildLlmCaptureArtifact } = await import(
    "../../packages/runtime/src/personas/orchestrator/llm-capture.js"
  );

  const result = buildLlmCaptureArtifact({ prompt: "", responseText: "", model: "" });

  assert.equal(result.capture, null);
  assert.deepEqual(result.errors, [
    "LLM capture requires prompt.",
    "LLM capture requires responseText.",
    "LLM capture requires model.",
  ]);
});
