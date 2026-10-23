/**
 * #409 — an actor's own emit never narrows its own sight (Darren, 2026-10-18: dark obscures
 * everyone else, never the actor emitting it; "own emit never affects self", #336). Checked
 * for every kind against the same lit room: the viewer sees exactly what it sees with nothing
 * equipped. Light is what lights (its own light widens its sight), so for light the view may
 * only grow. Everyone else still sees the viewer's dark.
 */
"use strict";

const assert = require("node:assert/strict");
const { affinityTableRow } = require("../../../packages/core-ts/src/state/affinity-table.ts");

const FIXED = "2026-01-01T00:00:00.000Z";
const KINDS = ["fire", "water", "earth", "wind", "growth", "decay", "corrode", "fortify", "light", "dark"];
const vitals = () => ({
  health: { current: 40, max: 40, regen: 1 },
  mana: { current: 200, max: 200, regen: 20 },
  stamina: { current: 40, max: 40, regen: 1 },
  durability: { current: 40, max: 40, regen: 1 },
});
const WIDTH = 15;
const HEIGHT = 7;
function terrain() {
  const cells = [];
  for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
    const edge = x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1;
    cells.push(x === WIDTH - 2 && y === 3 ? "exit" : edge ? "wall" : "floor");
  }
  return cells;
}

async function sight(kind) {
  const [{ createRuntime }, { createCore }, { createConfiguratorPersona }] = await Promise.all([
    import("../../../packages/runtime/src/runner/runtime.js"),
    import("../../../packages/core-ts/src/index.ts"),
    import("../../../packages/runtime/src/personas/configurator/controller.js"),
  ]);
  const configurator = createConfiguratorPersona({ clock: () => FIXED });
  const layout = { width: WIDTH, height: HEIGHT, terrain: terrain() };
  const still = { capabilities: { canMove: false } };
  const actors = [
    { id: "eye", category: "delver", position: { x: 4, y: 3 }, motivations: ["stationary"], vitals: vitals(), ...still,
      ...(kind ? { affinities: [{ kind, expression: "emit", stacks: 2 }], activeAffinityKey: `${kind}:emit` } : {}) },
    // A lamp lights the room, so sight reaches past the unlit one tile and dark has light to obscure.
    { id: "lamp", category: "warden", position: { x: 10, y: 3 }, motivations: ["stationary"], vitals: vitals(), ...still,
      affinities: [{ kind: "light", expression: "emit", stacks: 6 }], activeAffinityKey: "light:emit" },
  ];
  const simConfig = configurator.buildSimConfigArtifact({
    meta: { id: "own_emit_sim", runId: "own_emit", createdAt: FIXED },
    planRef: { id: "plan", schema: "agent-kernel/PlanArtifact", schemaVersion: 1 },
    layout,
    movementStamina: { eye: 1, lamp: 1 },
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: { id: "own_emit_state", runId: "own_emit", createdAt: FIXED },
    simConfigRef: { id: simConfig.meta.id, schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width: WIDTH, height: HEIGHT },
    terrain: layout.terrain,
    actors,
  });
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState });
  await runtime.step();
  const cells = (grid) => new Set(grid.flatMap((row, y) => row.flatMap((seen, x) => (seen ? [`${x},${y}`] : []))));
  return { eye: cells(runtime.readVisibleCells("eye")), lamp: cells(runtime.readVisibleCells("lamp")) };
}

test("an actor's own emit never narrows what it sees, for every kind", async () => {
  const bare = (await sight(null)).eye;
  assert.ok(bare.size > 9, `the lit room is seen past the unlit one tile (${bare.size} cells)`);
  for (const kind of KINDS) {
    const { eye } = await sight(kind);
    const lost = [...bare].filter((cell) => !eye.has(cell));
    assert.deepEqual(lost, [], `${kind}: own emit hid ${lost.join(" ")}`);
    // Only a kind whose table row illuminates (#416) widens the emitter's own view.
    if (!affinityTableRow(kind).illuminates) assert.equal(eye.size, bare.size, `${kind}: own emit changed the view`);
  }
});

test("everyone else still sees the emitter's dark", async () => {
  const bare = (await sight(null)).lamp;
  const dark = (await sight("dark")).lamp;
  assert.ok(dark.size < bare.size, `the lamp sees less with dark emitted near it (${dark.size} vs ${bare.size})`);
});

// ## TODO: Test Permutations
// - an emitter's own dark never blinds it while another source's dark still does (#284)
// - two dark emitters each see through their own dark but not the other's
