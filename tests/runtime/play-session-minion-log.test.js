/**
 * Seed-11 playtest (Darren, 2026-10-29): a delver's minions were struck and defeated out of
 * its sight and its battle log said nothing. A party member's escorts report to it, so what
 * happens to them is in its log even under fog; strangers' events out of sight stay hidden.
 */
const assert = require("node:assert/strict");
const { createPlaySession } = require("../../packages/runtime/src/runner/play-session.js");
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const TILES = ["############", "#..........#", "#.........E#", "############"];
const hit = { kind: "fire", expression: "push", stacks: 1 };

function level({ escorts }) {
  return buildUnifiedLevel({
    id: "minion_log",
    tiles: TILES,
    actors: [
      { category: "delver", id: "hero", position: { x: 1, y: 1 }, motivations: ["user_controlled"], vitals: viableVitals() },
      { category: "delver", id: "pal", position: { x: 7, y: 1 }, motivations: escorts ? ["escorting", "friendly"] : ["stationary"],
        vitals: viableVitals(), ...(escorts ? { escort: { target: "hero", distance: 1 } } : {}) },
      { category: "warden", id: "foe", position: { x: 8, y: 1 }, motivations: ["attacking"],
        vitals: viableVitals({ mana: 40 }), affinities: [hit], activeAffinityKey: "fire:push" },
    ],
  });
}

async function logAfter(levelArtifacts, turns = 3) {
  const session = await createPlaySession({ ...levelArtifacts, fog: true });
  for (let i = 0; i < turns; i += 1) await session.act({ kind: "wait" });
  return session.view().battleLog.map((line) => line.text);
}

test("a hit on your minion out of your sight is in your battle log", async () => {
  const lines = await logAfter(level({ escorts: true }));
  assert.ok(lines.some((text) => /foe/.test(text) && /pal/.test(text)), JSON.stringify(lines));
});

test("the same hit on a stranger out of sight stays hidden", async () => {
  const lines = await logAfter(level({ escorts: false }));
  assert.deepEqual(lines.filter((text) => /pal/.test(text)), []);
});

// ## TODO: Test Permutations
// - a minion's defeat and take are logged for its leader, with every affinity kind
// - a second party member does not read another member's minions out of its sight
