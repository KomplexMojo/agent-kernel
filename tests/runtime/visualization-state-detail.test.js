'use strict';

// M1 — Runtime tests for the visualization detail renderer.
//
// All tests FAIL until M2 creates packages/runtime/src/render/visualization-snapshot.js
// and exports createVisualizationSnapshot. Tests document the expected behaviour
// of ASCII detail layers (layout, hazards, resources, delvers, wardens) and
// actor detail configuration (affinities, stacks, expressions, vitals, motivations).

const assert = require("node:assert/strict");

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
  hazards: [
    { id: "hazard_1", x: 2, y: 1, affinity: "fire", expression: "emit", stacks: 3, blocking: false },
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
  return import("../../packages/runtime/src/render/visualization-snapshot.js");
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
  // hazard at x=2, y=1 in a 7-wide grid; hazard row is row index 1 (y=1)
  const hazardRow = snap.layers.hazards.split("\n")[1];
  assert.notEqual(hazardRow[2], " ", "hazards layer must mark hazard position at x=2 with a non-space character");
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

test("createVisualizationSnapshot with no hazards produces empty hazards layer", async () => {
  const { createVisualizationSnapshot } = await loadVisualizationModule();
  const snap = await createVisualizationSnapshot({
    mode: "ascii",
    tick: 1,
    runId: "run_viz",
    simConfig: { ...SIM_CONFIG, hazards: [] },
    initialState: INITIAL_STATE,
    tickFrame: TICK_FRAME,
  });
  assert.doesNotMatch(snap.layers.hazards, /H/);
  assert.equal(snap.layers.hazards.replace(/\n/g, "").trim(), "");
});

test("createVisualizationSnapshot with no resources produces empty resources layer", async () => {
  const { createVisualizationSnapshot } = await loadVisualizationModule();
  const snap = await createVisualizationSnapshot({
    mode: "ascii",
    tick: 1,
    runId: "run_viz",
    simConfig: { ...SIM_CONFIG, resources: [] },
    initialState: INITIAL_STATE,
    tickFrame: TICK_FRAME,
  });
  assert.doesNotMatch(snap.layers.resources, /R/);
  assert.equal(snap.layers.resources.replace(/\n/g, "").trim(), "");
});

test("createVisualizationSnapshot with null tickFrame at tick greater than zero uses initial positions", async () => {
  const { createVisualizationSnapshot } = await loadVisualizationModule();
  const snap = await createVisualizationSnapshot({
    mode: "ascii",
    tick: 3,
    runId: "run_viz",
    simConfig: SIM_CONFIG,
    initialState: INITIAL_STATE,
    tickFrame: null,
  });
  const delverRow = snap.layers.delvers.split("\n")[1];
  assert.notEqual(delverRow[1], " ", "delver should remain at initial x=1");
  assert.equal(delverRow[2], " ", "delver should not use tick-frame x=2 without a tickFrame");
});

test("createVisualizationSnapshot in image mode returns visualizationDataUri field and no layers", async () => {
  const { createVisualizationSnapshot } = await loadVisualizationModule();
  const snap = await createVisualizationSnapshot({
    mode: "image",
    tick: 1,
    runId: "run_viz",
    simConfig: SIM_CONFIG,
    initialState: INITIAL_STATE,
    tickFrame: TICK_FRAME,
  });
  assert.equal(snap.mode, "image");
  assert.ok(Object.prototype.hasOwnProperty.call(snap, "visualizationDataUri"));
  assert.equal(Object.prototype.hasOwnProperty.call(snap, "layers"), false);
});

test("actorDetails for stationary warden reflects motivation", async () => {
  const { createVisualizationSnapshot } = await loadVisualizationModule();
  const snap = await createVisualizationSnapshot({
    mode: "ascii",
    tick: 1,
    runId: "run_viz",
    simConfig: SIM_CONFIG,
    initialState: INITIAL_STATE,
    tickFrame: TICK_FRAME,
  });
  const warden = snap.actorDetails.find((actor) => actor.id === "actor_warden_1");
  assert.ok(warden, "warden actor detail must exist");
  assert.equal(warden.kind, "warden");
  assert.equal(warden.motivation, "stationary");
});

test("actorDetails affinities preserve stacks and expression fields", async () => {
  const { createVisualizationSnapshot } = await loadVisualizationModule();
  const snap = await createVisualizationSnapshot({
    mode: "ascii",
    tick: 1,
    runId: "run_viz",
    simConfig: SIM_CONFIG,
    initialState: INITIAL_STATE,
    tickFrame: TICK_FRAME,
  });
  const delver = snap.actorDetails.find((actor) => actor.id === "actor_delver_1");
  assert.deepEqual(delver.affinities[0], { name: "fire", stacks: 2, expression: "emit" });
});

test("actorDetails vitals include stamina and mana when present", async () => {
  const { createVisualizationSnapshot } = await loadVisualizationModule();
  const initialState = {
    ...INITIAL_STATE,
    actors: INITIAL_STATE.actors.map((actor) => actor.id === "actor_delver_1"
      ? { ...actor, vitals: { ...actor.vitals, mana: { current: 3, max: 5, regen: 1 } } }
      : actor),
  };
  const snap = await createVisualizationSnapshot({
    mode: "ascii",
    tick: 1,
    runId: "run_viz",
    simConfig: SIM_CONFIG,
    initialState,
    tickFrame: TICK_FRAME,
  });
  const delver = snap.actorDetails.find((actor) => actor.id === "actor_delver_1");
  assert.ok(delver.vitals.stamina, "stamina vital must be present");
  assert.ok(delver.vitals.mana, "mana vital must be present");
});

test("createVisualizationSnapshot tolerates missing hazards and resources fields", async () => {
  const { createVisualizationSnapshot } = await loadVisualizationModule();
  const { hazards, resources, ...simConfig } = SIM_CONFIG;
  const snap = await createVisualizationSnapshot({
    mode: "ascii",
    tick: 1,
    runId: "run_viz",
    simConfig,
    initialState: INITIAL_STATE,
    tickFrame: TICK_FRAME,
  });
  assert.equal(snap.mode, "ascii");
  assert.equal(snap.layers.hazards.replace(/\n/g, "").trim(), "");
  assert.equal(snap.layers.resources.replace(/\n/g, "").trim(), "");
});
