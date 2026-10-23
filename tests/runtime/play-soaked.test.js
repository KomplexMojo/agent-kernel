/**
 * #420 — a soaked actor says so on the board: the seated actor's vitals line ends `soaked N`,
 * an actor in sight is listed `(soaked N)`, and the plain HUD line carries it, for every kind
 * whose table row has the `soak` trait.
 */
const assert = require("node:assert/strict");

const { createPlaySession } = require("../../packages/runtime/src/runner/play-session.js");
const { hudLine, inSightLine, renderScreen } = require("../../packages/ui-ascii/src/screen.js");
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const HALL = ["###########", "S.........E", "###########"];

async function soakers() {
  const { AFFINITY_TABLE } = await import("../../packages/core-ts/src/state/affinity-table.ts");
  return AFFINITY_TABLE.filter((row) => row.trait === "soak").map((row) => row.kind);
}

function level(kind) {
  const player = { category: "delver", id: "hero", position: { x: 2, y: 1 }, vitals: viableVitals(), motivations: ["user_controlled"] };
  const other = { category: "warden", id: "w", position: { x: 4, y: 1 }, vitals: viableVitals(), motivations: ["stationary"] };
  const trap = {
    category: "hazard", id: "t", position: { x: 3, y: 1 },
    vitals: { durability: { current: 10, max: 10, regen: 1 }, mana: { current: 40, max: 40, regen: 10 } },
    affinities: [{ kind, expression: "emit", stacks: 2, intensity: 2 }], activeAffinityKey: `${kind}:emit`,
  };
  return buildUnifiedLevel({ id: "soak", tiles: HALL, actors: [player, other, trap] });
}

test("a soaked player and a soaked actor in sight say so, for every soak-trait kind", async () => {
  for (const kind of await soakers()) {
    const session = await createPlaySession(level(kind));
    await session.act({ kind: "wait" });
    const view = session.view();
    assert.equal(view.player.soaked, 2, kind);
    const warden = view.actors.find((actor) => actor.id === "w");
    assert.equal(warden.soaked, 2, kind);
    assert.match(inSightLine(view), /w[^ ]*( \([^)]*\))* \(soaked 2\)/, kind);
    assert.match(hudLine(view), / soaked 2/, kind);
    assert.match(renderScreen({ view }), /soaked 2/, kind);
  }
});

// ## TODO: Test Permutations
// - a dry actor shows no soaked note
// - the note counts down as the actor dries out of the field
