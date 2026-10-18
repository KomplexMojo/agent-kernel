/**
 * #297 — one route rule for both placement paths (Darren, 2026-10-17, option B): a
 * blocking object counts against the spawn-to-exit route only if it can't be destroyed
 * (no durability to lose). A destroyable trap is passable and never causes a rejection.
 * The legacy fallback (what `ak create` uses when no solver answers) takes the first free
 * cell in reading order and used to emit a level whose only corridor an indestructible
 * blocker had sealed; it now refuses that level, as the solver path does.
 */
"use strict";

const assert = require("node:assert/strict");

const CLOCK = () => "2026-10-18T00:00:00.000Z";
const W = "wall";
const F = "floor";
// One corridor from spawn (1,1) to exit (5,1), plus a dead-end pocket at (1,2).
const LAYOUT = Object.freeze({
  width: 7,
  height: 4,
  spawnApproach: { x: 1, y: 1 },
  exitApproach: { x: 5, y: 1 },
  rooms: [],
  terrain: [
    W, W, W, W, W, W, W,
    W, F, F, F, F, F, W,
    W, F, W, W, W, W, W,
    W, W, W, W, W, W, W,
  ],
});

const pointKey = ({ x, y }) => `${x},${y}`;
const CORRIDOR = new Set(["2,1", "3,1", "4,1"]);

async function configurator() {
  const { createConfiguratorPersona } = await import("../../../packages/runtime/src/personas/configurator/controller.js");
  return createConfiguratorPersona({ clock: CLOCK });
}

function hazard(id, { durabilityMax, position } = {}) {
  return {
    id,
    blocking: true,
    affinity: { kind: "earth", expression: "emit", stacks: 1 },
    ...(durabilityMax !== undefined ? { vitals: { durability: { current: durabilityMax, max: durabilityMax, regen: 0 } } } : {}),
    ...(position ? { position, x: position.x, y: position.y } : {}),
  };
}

const placed = (result, id) => result.actors.find((actor) => actor.id === id)?.position;

test("the fallback refuses with path_obstruction when its first-fit cell would seal the route", async () => {
  const persona = await configurator();
  const result = persona.completeObjectPlacement({ layout: LAYOUT, hazards: [hazard("wall_trap", { durabilityMax: 0 })] });

  assert.deepEqual({ ok: result.ok, status: result.status, reason: result.reason },
    { ok: false, status: "unsat", reason: "path_obstruction" });
});

test("the fallback places an indestructible blocker whose cell leaves the route open", async () => {
  const persona = await configurator();
  const result = persona.completeObjectPlacement({
    layout: LAYOUT, hazards: [hazard("wall_trap", { durabilityMax: 0, position: { x: 1, y: 2 } })],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(placed(result, "wall_trap"), { x: 1, y: 2 });
});

test("a destroyable blocking trap may stand on the only corridor in the fallback", async () => {
  const persona = await configurator();
  const result = persona.completeObjectPlacement({ layout: LAYOUT, hazards: [hazard("trap")] });

  assert.equal(result.ok, true);
  assert.ok(CORRIDOR.has(pointKey(placed(result, "trap"))), "reading order puts it on the corridor and nothing rejects it");
});

test("the solver path applies the same test: a destroyable trap on the corridor is not an obstruction", async () => {
  const persona = await configurator();
  const destroyable = persona.prepareObjectPlacement({ layout: LAYOUT, hazards: [hazard("trap", { position: { x: 3, y: 1 } })] });
  assert.notEqual(destroyable.reason, "path_obstruction");

  const sealing = persona.prepareObjectPlacement({
    layout: LAYOUT, hazards: [hazard("wall_trap", { durabilityMax: 0, position: { x: 3, y: 1 } })],
  });
  assert.deepEqual({ status: sealing.status, reason: sealing.reason }, { status: "unsat", reason: "path_obstruction" });
});
