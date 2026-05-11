'use strict';

// M1 — Contract tests for the VisualizationSnapshot artifact schema.
//
// These tests document the intended shape of the visualization response that
// M2 (runtime module), M3 (ascii flag), and M4 (image flag) must satisfy.
// The runtime import test (test 1) FAILS until M2 creates the module.
// Shape-validator tests (tests 2–6) document the contract and pass immediately.

const assert = require("node:assert/strict");
const { moduleUrl } = require("../helpers/esm-runner");

// ---------------------------------------------------------------------------
// Inline contract validators — define the intended shape
// ---------------------------------------------------------------------------

function validateBase(snap) {
  assert.ok(snap !== null && typeof snap === "object", "snapshot must be an object");
  assert.equal(snap.schema, "agent-kernel/VisualizationSnapshot");
  assert.equal(snap.schemaVersion, 1);
  assert.ok(snap.meta && typeof snap.meta === "object", "meta must be present");
  assert.equal(typeof snap.meta.runId, "string");
  assert.ok(["ascii", "image"].includes(snap.mode), `mode must be ascii or image, got: ${snap.mode}`);
  assert.equal(typeof snap.tick, "number");
  assert.equal(typeof snap.runId, "string");
}

function validateAsciiSnapshot(snap) {
  validateBase(snap);
  assert.equal(snap.mode, "ascii");
  assert.equal(typeof snap.ascii, "string", "ascii field must be a non-empty string");
  assert.ok(snap.layers && typeof snap.layers === "object", "layers must be present");
  assert.equal(typeof snap.layers.layout, "string", "layers.layout must be a string");
  assert.equal(typeof snap.layers.hazards, "string", "layers.hazards must be a string");
  assert.equal(typeof snap.layers.resources, "string", "layers.resources must be a string");
  assert.equal(typeof snap.layers.delvers, "string", "layers.delvers must be a string");
  assert.equal(typeof snap.layers.wardens, "string", "layers.wardens must be a string");
  assert.ok(Array.isArray(snap.actorDetails), "actorDetails must be an array");
}

function validateImageSnapshot(snap) {
  validateBase(snap);
  assert.equal(snap.mode, "image");
  assert.equal(typeof snap.visualizationDataUri, "string", "visualizationDataUri must be a string");
  assert.match(snap.visualizationDataUri, /^data:image\/png;base64,/, "must be a PNG data URI");
  assert.ok(Array.isArray(snap.actorDetails), "actorDetails must be an array");
}

function validateActorDetail(detail) {
  assert.equal(typeof detail.id, "string");
  assert.ok(["delver", "warden"].includes(detail.kind), `kind must be delver or warden`);
  assert.ok(detail.position && typeof detail.position.x === "number" && typeof detail.position.y === "number");
  assert.ok(Array.isArray(detail.affinities), "affinities must be an array");
  assert.ok(detail.vitals && typeof detail.vitals === "object", "vitals must be present");
  assert.equal(typeof detail.motivation, "string", "motivation must be a string");
}

// ---------------------------------------------------------------------------
// FAILING: runtime module does not exist until M2
// ---------------------------------------------------------------------------

test("runtime exports createVisualizationSnapshot", async () => {
  // FAILS until M2 creates packages/runtime/src/render/visualization-snapshot.js
  const mod = await import(moduleUrl("packages/runtime/src/render/visualization-snapshot.js"));
  assert.equal(typeof mod.createVisualizationSnapshot, "function",
    "createVisualizationSnapshot must be a named export");
});

// ---------------------------------------------------------------------------
// Shape contract — these document the intended schema and pass immediately
// ---------------------------------------------------------------------------

test("VisualizationSnapshot ascii shape satisfies contract", () => {
  const snap = {
    schema: "agent-kernel/VisualizationSnapshot",
    schemaVersion: 1,
    meta: { id: "vs1", runId: "run1", createdAt: "2026-01-01T00:00:00.000Z", producedBy: "ak-tick" },
    mode: "ascii",
    tick: 1,
    runId: "run1",
    ascii: "#####\n#...#\n#####",
    layers: {
      layout:    "#####\n#...#\n#####",
      hazards:   "     \n  H  \n     ",
      resources: "     \n   R \n     ",
      delvers:   "     \n D   \n     ",
      wardens:   "     \n   W \n     ",
    },
    actorDetails: [
      {
        id: "actor_delver_1",
        kind: "delver",
        position: { x: 1, y: 1 },
        affinities: [{ name: "fire", stacks: 2, expression: "emit" }],
        vitals: { health: { current: 10, max: 10, regen: 1 } },
        motivation: "exploring",
      },
    ],
  };
  validateAsciiSnapshot(snap);
  validateActorDetail(snap.actorDetails[0]);
});

test("VisualizationSnapshot image shape satisfies contract", () => {
  const snap = {
    schema: "agent-kernel/VisualizationSnapshot",
    schemaVersion: 1,
    meta: { id: "vs2", runId: "run1", createdAt: "2026-01-01T00:00:00.000Z", producedBy: "ak-tick" },
    mode: "image",
    tick: 2,
    runId: "run1",
    visualizationDataUri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==",
    actorDetails: [],
  };
  validateImageSnapshot(snap);
});

test("VisualizationSnapshot rejects unknown mode", () => {
  const snap = {
    schema: "agent-kernel/VisualizationSnapshot",
    schemaVersion: 1,
    meta: { id: "vs3", runId: "run1", createdAt: "2026-01-01T00:00:00.000Z", producedBy: "ak-tick" },
    mode: "video",
    tick: 1,
    runId: "run1",
  };
  assert.throws(() => validateBase(snap), /mode must be ascii or image/);
});

test("ascii snapshot rejects missing layers", () => {
  const snap = {
    schema: "agent-kernel/VisualizationSnapshot",
    schemaVersion: 1,
    meta: { id: "vs4", runId: "run1", createdAt: "2026-01-01T00:00:00.000Z", producedBy: "ak-tick" },
    mode: "ascii",
    tick: 1,
    runId: "run1",
    ascii: "#...#",
  };
  assert.throws(() => validateAsciiSnapshot(snap), /layers must be present/);
});

test("image snapshot rejects file path instead of data URI", () => {
  const snap = {
    schema: "agent-kernel/VisualizationSnapshot",
    schemaVersion: 1,
    meta: { id: "vs5", runId: "run1", createdAt: "2026-01-01T00:00:00.000Z", producedBy: "ak-tick" },
    mode: "image",
    tick: 1,
    runId: "run1",
    visualizationDataUri: "/artifacts/runs/run1/session/tick-1.png",
  };
  assert.throws(() => validateImageSnapshot(snap), /must be a PNG data URI/);
});

test("actorDetail with empty affinities array is valid", () => {
  const detail = {
    id: "actor_warden_1",
    kind: "warden",
    position: { x: 3, y: 2 },
    affinities: [],
    vitals: { health: { current: 15, max: 15, regen: 0 } },
    motivation: "defending",
  };
  validateActorDetail(detail);
});

/*
## TODO: Test Permutations
- ascii snapshot with empty actorDetails array is valid
- ascii snapshot where all layers are identical (no entities) is valid
- image snapshot with null ascii field is valid (ascii not required in image mode)
- actorDetail with unknown kind (e.g. "creature") throws from validateActorDetail
- actorDetail missing motivation field fails validateActorDetail
- actorDetail with fractional position (x:1.5) passes contract (bounds not validated at schema level)
- schemaVersion 0 or undefined fails validateBase
- meta missing runId fails validateBase
*/
