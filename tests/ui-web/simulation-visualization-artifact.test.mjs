import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// M1 — UI tests for consuming visualization snapshots produced by CLI/MCP.
//
// Tests for applyVisualizationSnapshot and related UI helpers FAIL until M5
// adds the visualization consumption layer to simulation-view.js.
// The PNG data URI encoding test and validator tests PASS immediately.

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Helper — build a minimal VisualizationSnapshot fixture
// ---------------------------------------------------------------------------

function makeAsciiSnapshot(overrides = {}) {
  return {
    schema: "agent-kernel/VisualizationSnapshot",
    schemaVersion: 1,
    meta: { id: "vs1", runId: "run_ui", createdAt: "2026-01-01T00:00:00.000Z", producedBy: "ak-tick" },
    mode: "ascii",
    tick: 1,
    runId: "run_ui",
    ascii: "#######\n#.D.R.#\n#######",
    layers: {
      layout:    "#######\n#.....#\n#######",
      hazards:   "       \n  H    \n       ",
      resources: "       \n    R  \n       ",
      delvers:   "       \n  D    \n       ",
      wardens:   "       \n      W\n       ",
    },
    actorDetails: [
      { id: "actor_delver_1", kind: "delver", position: { x: 2, y: 1 },
        affinities: [{ name: "fire", stacks: 2, expression: "emit" }],
        vitals: { health: { current: 10, max: 10, regen: 1 } },
        motivation: "exploring" },
    ],
    ...overrides,
  };
}

function makeImageSnapshot(overrides = {}) {
  return {
    schema: "agent-kernel/VisualizationSnapshot",
    schemaVersion: 1,
    meta: { id: "vs2", runId: "run_ui", createdAt: "2026-01-01T00:00:00.000Z", producedBy: "ak-tick" },
    mode: "image",
    tick: 1,
    runId: "run_ui",
    // Minimal valid 1×1 transparent PNG encoded as base64
    visualizationDataUri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    actorDetails: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PASSING — PNG data URI encoding and basic contract checks
// ---------------------------------------------------------------------------

test("PNG data URI in image snapshot starts with correct mime prefix", () => {
  const snap = makeImageSnapshot();
  assert.ok(snap.visualizationDataUri.startsWith("data:image/png;base64,"),
    "visualizationDataUri must use PNG mime type and base64 encoding");
});

test("PNG data URI base64 payload decodes to bytes starting with PNG magic number", () => {
  const snap = makeImageSnapshot();
  const base64 = snap.visualizationDataUri.replace("data:image/png;base64,", "");
  const bytes = Buffer.from(base64, "base64");
  assert.equal(bytes[0], 0x89, "byte 0 must be 0x89");
  assert.equal(bytes[1], 0x50, "byte 1 must be P");
  assert.equal(bytes[2], 0x4e, "byte 2 must be N");
  assert.equal(bytes[3], 0x47, "byte 3 must be G");
});

test("ascii snapshot layers have equal row count matching ascii field", () => {
  const snap = makeAsciiSnapshot();
  const rows = snap.ascii.split("\n");
  assert.equal(snap.layers.layout.split("\n").length, rows.length);
  assert.equal(snap.layers.hazards.split("\n").length, rows.length);
  assert.equal(snap.layers.resources.split("\n").length, rows.length);
  assert.equal(snap.layers.delvers.split("\n").length, rows.length);
  assert.equal(snap.layers.wardens.split("\n").length, rows.length);
});

// ---------------------------------------------------------------------------
// FAILING — simulation-view.js does not yet export applyVisualizationSnapshot
// ---------------------------------------------------------------------------

test("simulation-view exports applyVisualizationSnapshot function", async () => {
  // FAILS until M5 adds applyVisualizationSnapshot to simulation-view.js
  const simView = await import(
    pathToFileURL(path.resolve(ROOT, "packages/ui-web/src/views/simulation-view.js")).href
  );
  assert.equal(typeof simView.applyVisualizationSnapshot, "function",
    "simulation-view must export applyVisualizationSnapshot");
});

test("applyVisualizationSnapshot in ascii mode sets text content on a target element", async () => {
  // FAILS until M5 implements applyVisualizationSnapshot
  const { applyVisualizationSnapshot } = await import(
    pathToFileURL(path.resolve(ROOT, "packages/ui-web/src/views/simulation-view.js")).href
  );
  const snap = makeAsciiSnapshot();
  // Minimal DOM-like target element for testing without a real browser
  let textContent = null;
  const fakeEl = {
    get textContent() { return textContent; },
    set textContent(v) { textContent = v; },
    setAttribute() {},
  };
  applyVisualizationSnapshot(fakeEl, snap);
  assert.equal(typeof textContent, "string", "textContent must be set for ascii mode");
  assert.ok(textContent.length > 0, "textContent must not be empty");
});

test("applyVisualizationSnapshot in image mode sets src attribute on an img element", async () => {
  // FAILS until M5 implements applyVisualizationSnapshot
  const { applyVisualizationSnapshot } = await import(
    pathToFileURL(path.resolve(ROOT, "packages/ui-web/src/views/simulation-view.js")).href
  );
  const snap = makeImageSnapshot();
  let srcValue = null;
  const fakeImg = {
    setAttribute(name, value) { if (name === "src") srcValue = value; },
    textContent: null,
  };
  applyVisualizationSnapshot(fakeImg, snap);
  assert.equal(srcValue, snap.visualizationDataUri,
    "img src must be set to visualizationDataUri for image mode");
});

test("applyVisualizationSnapshot in image mode data URI is suitable for IPFS pinning", async () => {
  // FAILS until M5 implements applyVisualizationSnapshot
  const { applyVisualizationSnapshot } = await import(
    pathToFileURL(path.resolve(ROOT, "packages/ui-web/src/views/simulation-view.js")).href
  );
  const snap = makeImageSnapshot();
  let capturedUri = null;
  const fakeImg = {
    setAttribute(name, value) { if (name === "src") capturedUri = value; },
    textContent: null,
  };
  applyVisualizationSnapshot(fakeImg, snap);
  // Decode base64 to verify bytes are recoverable for ipfs.add(bytes)
  const base64 = capturedUri.replace("data:image/png;base64,", "");
  const bytes = Buffer.from(base64, "base64");
  assert.ok(bytes.length > 0, "decoded PNG bytes must be non-empty and suitable for IPFS upload");
});

test("tick state JSON response with visualization field is consumable by applyVisualizationSnapshot", async () => {
  // FAILS until M5 implements applyVisualizationSnapshot
  const { applyVisualizationSnapshot } = await import(
    pathToFileURL(path.resolve(ROOT, "packages/ui-web/src/views/simulation-view.js")).href
  );
  // Simulate a tick state response that includes the visualization field (as M3/M4 will produce)
  const tickStateResponse = {
    ok: true,
    command: "tick",
    action: "state",
    runId: "run_ui",
    tick: 1,
    maxTick: 5,
    ascii: "#######\n#.D...#\n#######",
    tickFrame: { tick: 1, acceptedActions: [] },
    visualization: makeAsciiSnapshot(),
  };
  let applied = null;
  const fakeEl = {
    set textContent(v) { applied = v; },
    setAttribute() {},
  };
  applyVisualizationSnapshot(fakeEl, tickStateResponse.visualization);
  assert.ok(applied !== null, "applyVisualizationSnapshot must process the visualization field");
});

/*
## TODO: Test Permutations
- applyVisualizationSnapshot with null snapshot does not throw (graceful degradation)
- applyVisualizationSnapshot with ascii mode and empty layers does not throw
- applyVisualizationSnapshot with image mode and null visualizationDataUri does not throw
- simulation-view renders existing canvas path unchanged when no visualization snapshot provided
- actorDetails from ascii snapshot can be used to render a detail panel with affinity/vital/motivation fields
- multiple consecutive applyVisualizationSnapshot calls overwrite the previous state cleanly
*/
