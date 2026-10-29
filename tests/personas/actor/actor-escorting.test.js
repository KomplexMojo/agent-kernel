/**
 * #251 — `escorting`: a mobility motivation that keeps an actor near one ally and follows
 * it as it moves (Darren, 2026-10-17). The ally is authored per actor (`escorts` beside the
 * roster, `escort=<id>` in `ak create`); with none, it is the playable delver. The escort
 * keeps within 2 tiles unless another distance is authored. It runs the Actor's `follow`
 * goal, so out of sight it walks to where it last saw the ally, and with the ally gone it
 * plays its other motivations. It must behave the same whatever its affinity, or none.
 */
"use strict";

const assert = require("node:assert/strict");

const FIXED = "2026-01-01T00:00:00.000Z";
const KINDS = ["fire", "water", "earth", "wind", "growth", "decay", "corrode", "fortify", "light", "dark"];
const VITALS = {
  health: { current: 20, max: 20, regen: 1 },
  mana: { current: 20, max: 20, regen: 1 },
  stamina: { current: 20, max: 20, regen: 1 },
  durability: { current: 20, max: 20, regen: 1 },
};

// 11x5 room, exit at the east end: the ally walks east and the escort must keep up.
const WIDTH = 13;
const HEIGHT = 5;
function terrain() {
  const cells = [];
  for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
    const edge = x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1;
    cells.push(x === WIDTH - 2 && y === 2 ? "exit" : edge ? "wall" : "floor");
  }
  return cells;
}

async function run({ actors, escorts, ticks }) {
  const [{ createRuntime }, { createCore }, { createConfiguratorPersona }] = await Promise.all([
    import("../../../packages/runtime/src/runner/runtime.js"),
    import("../../../packages/core-ts/src/index.ts"),
    import("../../../packages/runtime/src/personas/configurator/controller.js"),
  ]);
  const configurator = createConfiguratorPersona({ clock: () => FIXED });
  const layout = { width: WIDTH, height: HEIGHT, terrain: terrain(),
    rooms: [{ id: "R1", x: 1, y: 1, width: WIDTH - 2, height: HEIGHT - 2 }] };
  const simConfig = configurator.buildSimConfigArtifact({
    meta: { id: "escort_sim", runId: "escort", createdAt: FIXED },
    planRef: { id: "plan", schema: "agent-kernel/PlanArtifact", schemaVersion: 1 },
    layout,
    movementStamina: Object.fromEntries(actors.map((actor) => [actor.id, 1])),
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: { id: "escort_state", runId: "escort", createdAt: FIXED },
    simConfigRef: { id: simConfig.meta.id, schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width: WIDTH, height: HEIGHT },
    terrain: layout.terrain,
    actors,
    ...(escorts ? { escorts } : {}),
  });
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState });
  const trail = [];
  for (let i = 0; i < ticks; i += 1) {
    await runtime.step();
    trail.push(Object.fromEntries(runtime.getActorSnapshot().actors.map((a) => [a.id, { ...a.position, lifecycle: a.lifecycle }])));
  }
  return { trail, initialState };
}

const gap = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const delver = (id, position, motivations, extra = {}) => ({ id, category: "delver", position, motivations, vitals: VITALS, ...extra });
// Levels are unlit and bare sight is one tile, so the ally carries a light: lit cells are
// seen from afar. The kind is data (light is what lights); the escort's own kind varies.
const LIT = {
  vitals: { ...VITALS, mana: { current: 200, max: 200, regen: 20 } },
  affinities: [{ kind: "light", expression: "emit", stacks: 6 }],
  activeAffinityKey: "light:emit",
};

test("the Configurator carries an authored escort beside the roster, and refuses an unknown ally", async () => {
  const { createConfiguratorPersona } = await import("../../../packages/runtime/src/personas/configurator/controller.js");
  const configurator = createConfiguratorPersona({ clock: () => FIXED });
  const base = {
    meta: { id: "s", runId: "s", createdAt: FIXED },
    simConfigRef: { id: "c", schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1 },
    dimensions: { width: WIDTH, height: HEIGHT },
    terrain: terrain(),
  };
  const actors = [delver("ally", { x: 2, y: 2 }, ["exploring"]),
    delver("pal", { x: 1, y: 2 }, ["escorting"], { escort: { target: "ally", distance: 3 } })];
  assert.deepEqual(configurator.buildInitialStateArtifact({ ...base, actors }).escorts, { pal: { target: "ally", distance: 3 } });
  assert.throws(() => configurator.buildInitialStateArtifact({ ...base, actors: [actors[1]] }), /escort.*ghost|ally/);
  assert.throws(() => configurator.buildInitialStateArtifact({ ...base, actors: [actors[0], delver("pal", { x: 1, y: 2 }, ["escorting"])],
    escorts: { pal: { target: "ally", distance: 0 } } }), /distance/);
});

test("an escort keeps up with its ally as the ally walks to the exit, whatever its affinity", async () => {
  for (const kind of [...KINDS, null]) {
    const affinity = kind ? { affinities: [{ kind, expression: "push", stacks: 1 }], activeAffinityKey: `${kind}:push` } : {};
    const { trail } = await run({
      ticks: 8,
      actors: [delver("ally", { x: 3, y: 2 }, ["exploring"], LIT), delver("pal", { x: 1, y: 2 }, ["escorting"], affinity)],
      escorts: { pal: { target: "ally" } },
    });
    const label = kind ?? "no affinity";
    assert.ok(trail[trail.length - 1].ally.x > 5, `${label}: the ally made progress east`);
    for (const [tick, cells] of trail.entries()) {
      if (cells.ally.lifecycle !== "alive") break;
      // Both move in the same tick, so a walking ally can open the gap by one before the
      // escort answers: within 2 when it decides, never more than 3 after.
      assert.ok(gap(cells.pal, cells.ally) <= 3, `${label} tick ${tick + 1}: pal ${JSON.stringify(cells.pal)} ally ${JSON.stringify(cells.ally)}`);
    }
  }
});

test("an escort stops at its authored distance, and with no ally named keeps to the playable delver", async () => {
  // The playable delver is held in place here, so the escort walks to it
  // from across the room and stops once within reach: 2 tiles by default, else as authored.
  for (const [escorts, distance] of [[undefined, 2], [{ pal: { distance: 1 } }, 1], [{ pal: { target: "hero", distance: 4 } }, 4]]) {
    const { trail } = await run({
      ticks: 10,
      actors: [delver("hero", { x: 9, y: 2 }, ["user_controlled"], { ...LIT, capabilities: { canMove: false } }),
        delver("pal", { x: 1, y: 2 }, ["escorting"])],
      escorts,
    });
    const end = trail.at(-1);
    assert.equal(gap(end.pal, end.hero), distance, `${JSON.stringify(escorts)}: ${JSON.stringify(end)}`);
    assert.deepEqual(trail.at(-2).pal, end.pal, `it holds there: ${JSON.stringify(trail.map((c) => [c.pal.x, c.pal.y]))}`);
  }
});

test("with its ally gone the escort plays its other motivations", async () => {
  // The ally leaves through the exit. `friendly` with no ally in sight walks to the exit too,
  // so the escort keeps moving rather than standing where the ally was last seen.
  const { trail } = await run({
    ticks: 16,
    actors: [delver("ally", { x: 8, y: 2 }, ["exploring"], LIT), delver("pal", { x: 1, y: 2 }, ["escorting", "friendly"])],
    escorts: { pal: { target: "ally", distance: 2 } },
  });
  const gone = trail.findIndex((cells) => cells.ally.lifecycle !== "alive");
  assert.ok(gone >= 0, "the ally left the level");
  assert.ok(trail.at(-1).pal.x > trail[gone].pal.x || trail.at(-1).pal.lifecycle !== "alive",
    `the escort kept going: ${JSON.stringify(trail.slice(gone).map((c) => c.pal))}`);
});

test("in the dark an escort walks to where it last saw its ally", async () => {
  // Unlit: the escort sees one tile. It sees its ally beside it on tick 1, the ally walks
  // off, and the escort goes to that last-seen cell rather than wandering or holding.
  const { trail } = await run({
    ticks: 3,
    actors: [delver("ally", { x: 2, y: 2 }, ["exploring"]), delver("pal", { x: 1, y: 2 }, ["escorting"])],
    escorts: { pal: { target: "ally", distance: 1 } },
  });
  assert.ok(trail.some((cells) => cells.pal.x === 2 && cells.pal.y === 2), JSON.stringify(trail));
});

test("lost in the dark, an escort holds where it last saw its ally instead of wandering off (seed 11)", async () => {
  // Unlit: the ally walks east out of the escort's one-tile sight. `friendly` with no ally in
  // sight would walk to the exit; the escort holds at the last-seen cell and never leaves.
  const { trail } = await run({
    ticks: 20,
    actors: [delver("ally", { x: 2, y: 2 }, ["exploring"]), delver("pal", { x: 1, y: 2 }, ["escorting", "friendly"])],
    escorts: { pal: { target: "ally", distance: 1 } },
  });
  assert.ok(trail.every((cells) => cells.pal.lifecycle === "alive"), `it never exits: ${JSON.stringify(trail.map((c) => c.pal))}`);
  assert.deepEqual(trail.at(-1).pal, trail.at(-2).pal, "it holds still once lost");
});

// ## TODO: Test Permutations
// - an escort of a warden (same behaviour on the other side)
// - two escorts of one ally do not block each other's steps
