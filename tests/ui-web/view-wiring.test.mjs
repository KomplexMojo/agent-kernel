import assert from "node:assert/strict";
import { wireDesignView } from "../../packages/ui-web/src/views/design-view.js";
import { wirePreviewView } from "../../packages/ui-web/src/views/preview-view.js";
import { extractLlmCaptures, wireDiagnosticsView } from "../../packages/ui-web/src/views/diagnostics-view.js";
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

    assert.ok(designView);
    assert.ok(previewView);
    assert.ok(diagnosticsView);
    assert.ok(designView.publishPreviewSpec);
    assert.ok(designView.autoGenerateCards);
    assert.ok(previewView.loadBundle);
    assert.ok(previewView.buildAndLoadGame);
    assert.ok(diagnosticsView.runBuild);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
test("design-view module imports cleanly so wireTabs is reachable from main.js", async () => {
  // BUG-1 regression: design-view → design-guidance ESM link failure prevented
  // wireTabs from running, leaving every tab inert. If any view module fails to
  // load, main.js's tab wiring never executes. This guards the import graph.
  const designView = await import("../../packages/ui-web/src/views/design-view.js");
  const previewView = await import("../../packages/ui-web/src/views/preview-view.js");
  const diagnosticsView = await import("../../packages/ui-web/src/views/diagnostics-view.js");
  assert.equal(typeof designView.wireDesignView, "function");
  assert.equal(typeof previewView.wirePreviewView, "function");
  assert.equal(typeof diagnosticsView.wireDiagnosticsView, "function");
});

test("wireDesignView with querySelectorAll returning a non-empty array does not throw", () => {
  const root = {
    querySelector() { return null; },
    querySelectorAll() { return [{ dataset: {} }, { dataset: {} }]; },
  };
  const dv = wireDesignView({ root });
  assert.ok(dv);
  assert.ok(typeof dv.publishPreviewSpec === "function");
});

test("wireDiagnosticsView wired twice on the same root returns valid views both times", () => {
  const root = { querySelector() { return null; }, querySelectorAll() { return []; } };
  const dv1 = wireDiagnosticsView({ root });
  const dv2 = wireDiagnosticsView({ root });
  assert.ok(typeof dv1.runBuild === "function");
  assert.ok(typeof dv2.runBuild === "function");
});

test("extractLlmCaptures with empty captures array sources deduped results from bundle artifacts", () => {
  const llmCapture = {
    schema: "agent-kernel/CapturedInputArtifact",
    schemaVersion: 1,
    meta: { id: "cap_bundle_1", runId: "run_x", createdAt: "2026-01-01T00:00:00.000Z", producedBy: "orchestrator" },
    source: { adapter: "llm", request: { model: "phi4" } },
    contentType: "application/json",
    payload: { prompt: "p", responseRaw: "r" },
  };
  const captures = extractLlmCaptures({
    captures: [],
    snapshot: null,
    bundle: { artifacts: [llmCapture, llmCapture] },
  });
  assert.equal(captures.length, 1, "dedup by meta.id must collapse duplicates from bundle.artifacts");
  assert.equal(captures[0].meta.id, "cap_bundle_1");
  assert.equal(captures[0].source.adapter, "llm");
});
