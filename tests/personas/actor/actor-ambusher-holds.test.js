/**
 * #399 — an ambusher holds still until a delver comes into sight, then strikes.
 *
 * `defending` already means "hold position, cast at whatever comes in range" (the Actor's
 * motivation routing: it holds position, and casts at a hostile in its observation and in
 * reach). Observation is sight-scoped by core, so a hidden guard cannot cast at a delver it
 * does not see. This pins that down for the ambush tactic (#398), for every affinity: the guard
 * never moves, never casts while the delver is out of sight, and casts once it is in sight
 * and in reach. A guard whose only kind restores still holds still (a support role, not a gap).
 */
"use strict";

const assert = require("node:assert/strict");

const FIXED = "2026-01-01T00:00:00.000Z";
const HARMFUL = ["fire", "water", "earth", "wind", "decay", "corrode", "dark"];
const RESTORING = ["growth", "fortify", "light"];
const vitals = (manaRegen) => ({
  health: { current: 40, max: 40, regen: 1 },
  mana: { current: 40, max: 40, regen: manaRegen },
  stamina: { current: 40, max: 40, regen: 1 },
  durability: { current: 10, max: 10, regen: 0 },
});

// 13x5 room, exit at the east end; the delver walks east past the guard's corner.
const WIDTH = 13;
const HEIGHT = 5;
function terrain() {
  const cells = [];
  for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
    const edge = x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1;
    cells.push(x === WIDTH - 1 && y === 2 ? "exit" : edge ? "wall" : "floor");
  }
  return cells;
}

async function run(kind, ticks = 16) {
  const [{ createRuntime }, { createCore }, { createConfiguratorPersona }] = await Promise.all([
    import("../../../packages/runtime/src/runner/runtime.js"),
    import("../../../packages/core-ts/src/index.ts"),
    import("../../../packages/runtime/src/personas/configurator/controller.js"),
  ]);
  const configurator = createConfiguratorPersona({ clock: () => FIXED });
  const layout = { width: WIDTH, height: HEIGHT, terrain: terrain(),
    rooms: [{ id: "R1", x: 1, y: 1, width: WIDTH - 2, height: HEIGHT - 2 }] };
  const actors = [
    { id: "hero", category: "delver", position: { x: 1, y: 2 }, motivations: ["exploring"], vitals: vitals(1) },
    { id: "guard", category: "warden", position: { x: 8, y: 1 }, motivations: ["defending"], vitals: vitals(0),
      affinities: [{ kind, expression: "push", stacks: 2 }], activeAffinityKey: `${kind}:push` },
  ];
  const simConfig = configurator.buildSimConfigArtifact({
    meta: { id: "ambusher_sim", runId: "ambusher", createdAt: FIXED },
    planRef: { id: "plan", schema: "agent-kernel/PlanArtifact", schemaVersion: 1 },
    layout,
    movementStamina: { hero: 1, guard: 1 },
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: { id: "ambusher_state", runId: "ambusher", createdAt: FIXED },
    simConfigRef: { id: simConfig.meta.id, schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width: WIDTH, height: HEIGHT },
    terrain: layout.terrain,
    actors,
  });
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState });
  const trail = [];
  for (let i = 0; i < ticks; i += 1) {
    const before = runtime.getActorSnapshot().actors.find((a) => a.id === "hero");
    const sawHero = runtime.readVisibleCells("guard")?.[before.position.y]?.[before.position.x] === 1;
    await runtime.step();
    const byId = Object.fromEntries(runtime.getActorSnapshot().actors.map((a) => [a.id, a]));
    trail.push({ sawHero, hero: { ...before.position }, guard: { ...byId.guard.position }, mana: byId.guard.vitals.mana.current });
  }
  return trail;
}

const gap = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

for (const kind of HARMFUL) {
  test(`a ${kind} ambusher holds until the delver is in sight, then casts`, async () => {
    const trail = await run(kind);
    assert.ok(trail.every((step) => step.guard.x === 8 && step.guard.y === 1), "the guard never moves");
    const casts = trail.map((step, index) => step.mana < (index === 0 ? 40 : trail[index - 1].mana));
    trail.forEach((step, index) => {
      if (!step.sawHero) assert.equal(casts[index], false, `tick ${index + 1}: no cast at a delver out of sight`);
    });
    const first = casts.indexOf(true);
    assert.ok(first >= 0, "the guard strikes once the delver is in sight");
    assert.equal(trail[first].sawHero, true);
    assert.ok(gap(trail[first].hero, { x: 8, y: 1 }) <= 2, "and in reach");
  });
}

for (const kind of RESTORING) {
  test(`a ${kind} (restoring-only) guard still holds still`, async () => {
    const trail = await run(kind);
    assert.ok(trail.every((step) => step.guard.x === 8 && step.guard.y === 1));
  });
}

// ## TODO: Test Permutations
// - a guard behind a wall corner never casts while the delver passes out of line of sight
// - a lit delver is seen from afar: the guard casts as soon as it is in reach, not adjacent
// - two guards hold and both strike once the delver is in sight
