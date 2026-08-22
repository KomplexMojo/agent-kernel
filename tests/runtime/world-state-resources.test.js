/**
 * A world-state snapshot carried actors and hazards but never resources, so
 * nothing on disk could distinguish a resource still sitting on the map from one
 * an actor had collected. That is the single observation the execution
 * benchmark's resource gates are built on — `single_consumption` asks whether a
 * resource was taken exactly once — and it was the reason every resource metric
 * reported `evidence_unavailable`.
 *
 * These tests pin the resource half of the snapshot. Placement into the core is
 * covered in tests/runtime/core-setup-resources.test.js.
 */
"use strict";

const assert = require("node:assert/strict");

const META = { id: "ws", runId: "ws", createdAt: "2026-08-14T00:00:00.000Z", producedBy: "annotator" };

function floorGrid(width, height) {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) =>
      x === 0 || x === width - 1 || y === 0 || y === height - 1 ? "#" : ".").join(""));
}

function buildSimConfig({ width = 5, height = 5, resources = [] } = {}) {
  return {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: { id: "ws_sim", runId: "ws", createdAt: "2026-08-14T00:00:00.000Z" },
    seed: 0,
    layout: {
      kind: "grid",
      data: {
        width,
        height,
        tiles: floorGrid(width, height),
        spawn: { x: 1, y: 1 },
        exit: { x: width - 2, y: height - 2 },
        rooms: [{ id: "R1", x: 0, y: 0, width, height }],
        resources,
      },
    },
  };
}

function buildInitialState(actors) {
  return {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: { id: "ws", runId: "ws", createdAt: "2026-08-14T00:00:00.000Z" },
    simConfigRef: { id: "ws_sim", schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1 },
    actors,
  };
}

function actor(id, position, motivationKind = "exploring") {
  return {
    id,
    kind: "ambulatory",
    archetype: id.startsWith("delver") ? "delver" : "warden",
    role: id.startsWith("delver") ? "delver" : "warden",
    position,
    motivation: { kind: motivationKind },
    traits: { affinities: { fire: 1 }, motivations: [{ kind: motivationKind, intensity: 1 }] },
    vitals: {
      health: { current: 4, max: 20, regen: 0 },
      mana: { current: 4, max: 20, regen: 0 },
      stamina: { current: 40, max: 40, regen: 4 },
      durability: { current: 2, max: 2, regen: 0 },
    },
  };
}

async function runScenario({ simConfig, initialState, ticks = 0 }) {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState });
  for (let tick = 0; tick < ticks; tick += 1) await runtime.step();
  return { core, runtime };
}

function key(entry) {
  return `${entry.position.x},${entry.position.y}`;
}

test("the snapshot reports a vital resource with the payload it was authored with", async () => {
  const simConfig = buildSimConfig({
    resources: [{
      id: "resource_health_consumable",
      permanenceMode: "consumable",
      vitals: [{ key: "health", delta: 5, regen: 2 }],
      position: { x: 3, y: 3 },
    }],
  });
  const { runtime } = await runScenario({ simConfig, initialState: buildInitialState([actor("delver_1", { x: 1, y: 1 })]) });
  const snapshot = runtime.captureWorldState({ meta: META });

  assert.ok(Array.isArray(snapshot.resources), "resources must always be present, even when empty");
  assert.equal(snapshot.resources.length, 1);
  const [resource] = snapshot.resources;
  assert.deepEqual(resource.position, { x: 3, y: 3 });
  assert.equal(resource.vital.kind, 0, "health is vital kind 0");
  assert.equal(resource.vital.delta, 5);
  assert.equal(resource.vital.mode, 0, "consumable is mode 0");
  assert.equal(resource.vital.regen, 2);
  assert.equal(resource.affinity, null, "a vital-only resource carries no affinity payload");
});

test("the snapshot reports an affinity resource, including the regen that makes it permanent", async () => {
  const simConfig = buildSimConfig({
    resources: [{
      id: "resource_permanent_fire",
      permanenceMode: "consumable",
      vitals: [],
      affinity: { kind: "fire", expression: "emit", stacks: 2, mana: 12, manaRegen: 3 },
      position: { x: 2, y: 3 },
    }],
  });
  const { runtime } = await runScenario({ simConfig, initialState: buildInitialState([actor("delver_1", { x: 1, y: 1 })]) });
  const [resource] = runtime.captureWorldState({ meta: META }).resources;

  assert.deepEqual(resource.position, { x: 2, y: 3 });
  assert.equal(resource.vital, null, "an affinity-only resource carries no vital payload");
  assert.ok(resource.affinity.kind > 0);
  assert.ok(resource.affinity.expression > 0);
  assert.equal(resource.affinity.stacks, 2);
  assert.equal(resource.affinity.mana, 12);
  assert.equal(resource.affinity.manaRegen, 3, "manaRegen is what makes the grant permanent");
});

test("a resource carrying both payloads reports both at one position", async () => {
  const simConfig = buildSimConfig({
    resources: [{
      permanenceMode: "level",
      vitals: [{ key: "mana", delta: 3 }],
      affinity: { kind: "fire", expression: "push", stacks: 1, mana: 6, manaRegen: 0 },
      position: { x: 2, y: 2 },
    }],
  });
  const { runtime } = await runScenario({ simConfig, initialState: buildInitialState([actor("warden_1", { x: 1, y: 1 })]) });
  const [resource] = runtime.captureWorldState({ meta: META }).resources;

  assert.equal(resource.vital.kind, 1, "mana is vital kind 1");
  assert.equal(resource.vital.mode, 1, "level is mode 1");
  assert.equal(resource.affinity.stacks, 1);
});

// The whole point of putting resources in the snapshot: a collected resource has
// to be observably gone, or `single_consumption` cannot be evidenced at all.
test("collected resources disappear from later snapshots and never come back", async () => {
  const cells = [];
  for (let y = 1; y <= 3; y += 1) for (let x = 1; x <= 3; x += 1) cells.push({ x, y });
  const simConfig = buildSimConfig({
    resources: cells.map((position, index) => ({
      id: `resource_${index}`,
      permanenceMode: "consumable",
      vitals: [{ key: "health", delta: 1 }],
      position,
    })),
  });
  const initialState = buildInitialState([actor("delver_1", { x: 1, y: 1 })]);

  const { runtime } = await runScenario({ simConfig, initialState });
  const series = [runtime.captureWorldState({ meta: META })];
  for (let tick = 0; tick < 8; tick += 1) {
    await runtime.step();
    series.push(runtime.captureWorldState({ meta: META }));
  }

  assert.equal(series[0].resources.length, cells.length, "every authored resource is on the map at the start");

  // Flooding the floor means any accepted move consumes one, so this is not vacuous.
  const last = series[series.length - 1];
  assert.ok(last.resources.length < series[0].resources.length,
    "an actor moving across a fully seeded floor must have collected at least one resource");

  let previous = new Set(series[0].resources.map(key));
  for (const snapshot of series.slice(1)) {
    const current = new Set(snapshot.resources.map(key));
    const reappeared = [...current].filter((cell) => !previous.has(cell));
    assert.deepEqual(reappeared, [], "a consumed resource must not return to the map");
    previous = current;
  }
});

test("a world with no resources reports an empty array, not a missing field", async () => {
  const { runtime } = await runScenario({
    simConfig: buildSimConfig(),
    initialState: buildInitialState([actor("delver_1", { x: 1, y: 1 })]),
  });
  const snapshot = runtime.captureWorldState({ meta: META });

  assert.deepEqual(snapshot.resources, []);
  assert.equal(snapshot.schemaVersion, 2, "resources arrived in v2; absence must be distinguishable from emptiness");
});

// ## TODO: Test Permutations
test.skip("a core lacking the resource getters yields an empty array rather than throwing", async () => {});
test.skip("two resources at the same cell collapse to the one the core actually holds", async () => {});
test.skip("an affinity grant's mana decline is visible across consecutive snapshots", async () => {});
test.skip("a resource outside the configured grid never appears in the snapshot", async () => {});
test.skip("resource ordering is stable across snapshots of the same world", async () => {});
