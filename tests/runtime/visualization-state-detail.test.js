'use strict';

// M1 — Runtime tests for the visualization detail renderer.
//
// All tests FAIL until M2 creates packages/runtime/src/render/visualization-snapshot.js
// and exports createVisualizationSnapshot. Tests document the expected behaviour
// of ASCII detail layers (layout, hazards, resources, delvers, wardens) and
// actor detail configuration (affinities, stacks, expressions, vitals, motivations).

const assert = require("node:assert/strict");
const { moduleUrl } = require("../helpers/esm-runner");

// ---------------------------------------------------------------------------
// Shared fixture — minimal sim-config + initial-state + tick-frame for testing
// ---------------------------------------------------------------------------

const SIM_CONFIG = {
  schema: "agent-kernel/SimConfigArtifact",
  schemaVersion: 1,
  meta: { id: "sc1", runId: "run_viz", createdAt: "2026-01-01T00:00:00.000Z", producedBy: "fixture" },
  layout: {
    kind: "grid",
    width: 7,
    height: 3,
    data: {
      width: 7,
      height: 3,
      tiles: ["#######", "#.....#", "#######"],
      legend: { "#": { tile: "wall" }, ".": { tile: "floor" } },
    },
  },
  traps: [
    { id: "trap_1", x: 2, y: 1, affinity: "fire", expression: "emit", stacks: 3, blocking: false },
  ],
  resources: [
    { id: "resource_1", x: 4, y: 1, tier: "level", stat: "vitalMax", delta: 10, dropRate: 50 },
  ],
};

const INITIAL_STATE = {
  schema: "agent-kernel/InitialStateArtifact",
  schemaVersion: 1,
  meta: { id: "is1", runId: "run_viz", createdAt: "2026-01-01T00:00:00.000Z", producedBy: "fixture" },
  actors: [
    {
      id: "actor_delver_1",
      kind: "motivated",
      role: "delver",
      position: { x: 1, y: 1 },
      affinity: "fire",
      motivation: "exploring",
      affinities: [{ name: "fire", stacks: 2, expression: "emit" }],
      vitals: { health: { current: 10, max: 10, regen: 1 }, stamina: { current: 7, max: 7, regen: 1 } },
    },
    {
      id: "actor_warden_1",
      kind: "motivated",
      role: "warden",
      position: { x: 5, y: 1 },
      affinity: "dark",
      motivation: "stationary",
      affinities: [{ name: "dark", stacks: 1, expression: "emit" }],
      vitals: { health: { current: 15, max: 15, regen: 0 }, stamina: { current: 5, max: 5, regen: 0 } },
    },
  ],
};

const TICK_FRAME = {
  schema: "agent-kernel/TickFrame",
  schemaVersion: 1,
  meta: { id: "tf1", runId: "run_viz", createdAt: "2026-01-01T00:00:00.000Z", producedBy: "fixture" },
  tick: 1,
  phase: "summarize",
  acceptedActions: [
    { schema: "agent-kernel/Action", schemaVersion: 1, actorId: "actor_delver_1", tick: 1, kind: "move",
      params: { direction: "east", from: { x: 1, y: 1 }, to: { x: 2, y: 1 } } },
    { schema: "agent-kernel/Action", schemaVersion: 1, actorId: "actor_warden_1", tick: 1, kind: "wait",
      params: { reason: "stationary" } },
  ],
};

// ---------------------------------------------------------------------------
// FAILING: module does not exist until M2
// ---------------------------------------------------------------------------

async function loadVisualizationModule() {
  // FAILS until M2 creates packages/runtime/src/render/visualization-snapshot.js
  return import(moduleUrl("packages/runtime/src/render/visualization-snapshot.js"));
}

test("createVisualizationSnapshot is exported from runtime render module", async () => {
  const mod = await loadVisualizationModule();
  assert.equal(typeof mod.createVisualizationSnapshot, "function");
});

test("createVisualizationSnapshot in ascii mode returns a valid snapshot object", async () => {
  const { createVisualizationSnapshot } = await loadVisualizationModule();
  const snap = await createVisualizationSnapshot({
    mode: "ascii",
    tick: 1,
    runId: "run_viz",
    simConfig: SIM_CONFIG,
    initialState: INITIAL_STATE,
    tickFrame: TICK_FRAME,
  });
  assert.equal(snap.schema, "agent-kernel/VisualizationSnapshot");
  assert.equal(snap.schemaVersion, 1);
  assert.equal(snap.mode, "ascii");
  assert.equal(snap.tick, 1);
  assert.equal(snap.runId, "run_viz");
  assert.equal(typeof snap.ascii, "string");
  assert.ok(snap.layers, "layers must be present");
});

test("ascii detail renderer includes layout layer matching sim-config grid", async () => {
  const { createVisualizationSnapshot } = await loadVisualizationModule();
  const snap = await createVisualizationSnapshot({
    mode: "ascii",
    tick: 1,
    runId: "run_viz",
    simConfig: SIM_CONFIG,
    initialState: INITIAL_STATE,
    tickFrame: TICK_FRAME,
  });
  const rows = snap.layers.layout.split("\n");
  assert.equal(rows.length, SIM_CONFIG.layout.data.height, "layout row count must match map height");
  assert.equal(rows[0].length, SIM_CONFIG.layout.data.width, "layout row width must match map width");
  assert.ok(rows[0].startsWith("#"), "first row of layout must start with wall character");
});

test("ascii detail renderer marks hazard position in hazards layer", async () => {
  const { createVisualizationSnapshot } = await loadVisualizationModule();
  const snap = await createVisualizationSnapshot({
    mode: "ascii",
    tick: 1,
    runId: "run_viz",
    simConfig: SIM_CONFIG,
    initialState: INITIAL_STATE,
    tickFrame: TICK_FRAME,
  });
  // trap at x=2, y=1 in a 7-wide grid; hazard row is row index 1 (y=1)
  const hazardRow = snap.layers.hazards.split("\n")[1];
  assert.notEqual(hazardRow[2], " ", "hazards layer must mark trap position at x=2 with a non-space character");
});

test("ascii detail renderer marks resource position in resources layer", async () => {
  const { createVisualizationSnapshot } = await loadVisualizationModule();
  const snap = await createVisualizationSnapshot({
    mode: "ascii",
    tick: 1,
    runId: "run_viz",
    simConfig: SIM_CONFIG,
    initialState: INITIAL_STATE,
    tickFrame: TICK_FRAME,
  });
  // resource at x=4, y=1
  const resourceRow = snap.layers.resources.split("\n")[1];
  assert.notEqual(resourceRow[4], " ", "resources layer must mark resource position at x=4");
});

test("ascii detail renderer marks delver position in delvers layer", async () => {
  const { createVisualizationSnapshot } = await loadVisualizationModule();
  const snap = await createVisualizationSnapshot({
    mode: "ascii",
    tick: 1,
    runId: "run_viz",
    simConfig: SIM_CONFIG,
    initialState: INITIAL_STATE,
    tickFrame: TICK_FRAME,
  });
  // delver starts at x=1,y=1; after move action ends at x=2,y=1
  const delverRow = snap.layers.delvers.split("\n")[1];
  const hasDelverMark = delverRow[1] !== " " || delverRow[2] !== " ";
  assert.ok(hasDelverMark, "delvers layer must mark delver position");
});

test("ascii detail renderer marks warden position in wardens layer", async () => {
  const { createVisualizationSnapshot } = await loadVisualizationModule();
  const snap = await createVisualizationSnapshot({
    mode: "ascii",
    tick: 1,
    runId: "run_viz",
    simConfig: SIM_CONFIG,
    initialState: INITIAL_STATE,
    tickFrame: TICK_FRAME,
  });
  // warden at x=5, y=1
  const wardenRow = snap.layers.wardens.split("\n")[1];
  assert.notEqual(wardenRow[5], " ", "wardens layer must mark warden position at x=5");
});

test("actorDetails includes affinities, vitals, and motivation for each actor", async () => {
  const { createVisualizationSnapshot } = await loadVisualizationModule();
  const snap = await createVisualizationSnapshot({
    mode: "ascii",
    tick: 1,
    runId: "run_viz",
    simConfig: SIM_CONFIG,
    initialState: INITIAL_STATE,
    tickFrame: TICK_FRAME,
  });
  assert.ok(Array.isArray(snap.actorDetails) && snap.actorDetails.length === 2,
    "actorDetails must contain all actors");
  const delver = snap.actorDetails.find((a) => a.id === "actor_delver_1");
  assert.ok(delver, "delver must be in actorDetails");
  assert.equal(delver.kind, "delver");
  assert.equal(delver.motivation, "exploring");
  assert.ok(Array.isArray(delver.affinities) && delver.affinities.length > 0,
    "delver affinities must be populated");
  assert.ok(delver.vitals && typeof delver.vitals.health === "object",
    "delver vitals must include health");
});

test("createVisualizationSnapshot at tick 0 returns ascii with initial positions", async () => {
  const { createVisualizationSnapshot } = await loadVisualizationModule();
  const snap = await createVisualizationSnapshot({
    mode: "ascii",
    tick: 0,
    runId: "run_viz",
    simConfig: SIM_CONFIG,
    initialState: INITIAL_STATE,
    tickFrame: null,
  });
  assert.equal(snap.tick, 0);
  assert.equal(snap.mode, "ascii");
  assert.ok(typeof snap.ascii === "string", "ascii must be present even at tick 0");
});

/*
## TODO: Test Permutations
- createVisualizationSnapshot with no traps in simConfig produces empty hazards layer (all spaces)
- createVisualizationSnapshot with no resources in simConfig produces empty resources layer
- createVisualizationSnapshot with null tickFrame at tick > 0 falls back to initial-state positions
- createVisualizationSnapshot in image mode returns visualizationDataUri and no layers object
- actorDetails for a warden with motivation=stationary correctly reflects stationary
- actorDetails affinities include stacks and expression fields from initialState
- actorDetails vitals include stamina and mana fields when present
- createVisualizationSnapshot with simConfig missing traps/resources field does not throw
*/
