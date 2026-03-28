import { test } from "node:test";
import assert from "node:assert/strict";
import { wireDesignView } from "../../packages/ui-web/src/views/design-view.js";
import { wirePreviewView } from "../../packages/ui-web/src/views/preview-view.js";
import { extractLlmCaptures, wireDiagnosticsView } from "../../packages/ui-web/src/views/diagnostics-view.js";
import { wireSimulationView } from "../../packages/ui-web/src/views/simulation-view.js";

function makeRoot() {
  return {
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

function makeSimulationRoot() {
  const elements = {
    "#frame-buffer": { textContent: "" },
    "#status-message": { textContent: "", dataset: {} },
  };
  return {
    elements,
    querySelector(selector) {
      return elements[selector] || null;
    },
    querySelectorAll() {
      return [];
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
    const previewView = wirePreviewView({ root });
    const diagnosticsView = wireDiagnosticsView({ root });
    const simulationView = wireSimulationView({ root, autoBoot: false });

    assert.ok(designView);
    assert.ok(previewView);
    assert.ok(diagnosticsView);
    assert.ok(simulationView);
    assert.ok(designView.publishPreviewSpec);
    assert.ok(designView.autoGenerateCards);
    assert.ok(previewView.loadBundle);
    assert.ok(previewView.buildAndLoadGame);
    assert.ok(diagnosticsView.runBuild);
    assert.ok(simulationView.startRunFromArtifacts);
    assert.ok(simulationView.performGameAction);
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

test("simulation view clear resets the game board shell", () => {
  const root = makeSimulationRoot();
  const simulationView = wireSimulationView({ root, autoBoot: false });

  simulationView.clear("Bundle has no actors. Use Preview to inspect the layout-only result.");

  assert.equal(root.elements["#frame-buffer"].textContent, "No game loaded.");
  assert.equal(root.elements["#status-message"].textContent, "Bundle has no actors. Use Preview to inspect the layout-only result.");
  assert.equal(root.elements["#status-message"].dataset.level, "info");
});

test("simulation view clear uses the shared Run help text by default", () => {
  const root = makeSimulationRoot();
  const simulationView = wireSimulationView({ root, autoBoot: false });

  simulationView.clear();

  assert.equal(root.elements["#frame-buffer"].textContent, "No game loaded.");
  assert.equal(
    root.elements["#status-message"].textContent,
    "Build and load a game from Preview, then select a room, delver, or warden to inspect and control it here.",
  );
  assert.equal(root.elements["#status-message"].dataset.level, "info");
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
