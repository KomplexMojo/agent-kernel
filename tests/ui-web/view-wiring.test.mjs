import { test } from "node:test";
import assert from "node:assert/strict";
import { wireDesignView } from "../../packages/ui-web/src/views/design-view.js";
import { extractLlmCaptures, wireDiagnosticsView } from "../../packages/ui-web/src/views/diagnostics-view.js";
import { wireSimulationView } from "../../packages/ui-web/src/views/simulation-view.js";
import { wireRuntimeView } from "../../packages/ui-web/src/views/runtime-view.js";

function makeRoot() {
  return {
    querySelector() {
      return null;
    },
  };
}

test("view wiring tolerates missing DOM nodes", () => {
  const root = makeRoot();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({}),
  });

  try {
    const designView = wireDesignView({ root });
    const diagnosticsView = wireDiagnosticsView({ root });
    const simulationView = wireSimulationView({ root, autoBoot: false });
    const runtimeView = wireRuntimeView({ root });

    assert.ok(designView);
    assert.ok(diagnosticsView);
    assert.ok(simulationView.startRun);
    assert.ok(runtimeView.updateFromSimulation);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("simulation view exposes level regeneration from runtime tile rows", async () => {
  const root = makeRoot();
  const simulationView = wireSimulationView({ root, autoBoot: false });
  const result = await simulationView.regenerateLevelArtifacts({
    tiles: ["S.E", ".#."],
  });
  assert.equal(result?.ok, true);
  assert.equal(result.width, 3);
  assert.equal(result.height, 2);
  assert.equal(result.walkableTiles, 5);
  assert.ok(result.ascii?.text);
  assert.ok(result.image?.pixels instanceof Uint8ClampedArray);
});

test("diagnostics llm capture extraction deduplicates and filters non-llm captures", () => {
  const llmCapture = {
    schema: "agent-kernel/CapturedInputArtifact",
    schemaVersion: 1,
    meta: { id: "capture_trace_1", runId: "run_x", createdAt: "2026-02-08T00:00:00.000Z", producedBy: "orchestrator" },
    source: { adapter: "llm", request: { model: "phi4" } },
    contentType: "application/json",
    payload: { prompt: "p", responseRaw: "r" },
  };
  const ipfsCapture = {
    schema: "agent-kernel/CapturedInputArtifact",
    schemaVersion: 1,
    meta: { id: "capture_other", runId: "run_x", createdAt: "2026-02-08T00:00:01.000Z", producedBy: "orchestrator" },
    source: { adapter: "ipfs" },
    contentType: "application/json",
    payload: {},
  };

  const captures = extractLlmCaptures({
    captures: [llmCapture, ipfsCapture],
    snapshot: {
      response: {
        capturedInputs: [llmCapture, ipfsCapture],
        bundle: {
          artifacts: [llmCapture],
        },
      },
    },
    bundle: {
      artifacts: [ipfsCapture, llmCapture],
    },
  });

  assert.equal(captures.length, 1);
  assert.equal(captures[0].meta.id, "capture_trace_1");
  assert.equal(captures[0].source.adapter, "llm");
});
