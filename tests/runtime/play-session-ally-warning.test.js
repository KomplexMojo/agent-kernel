/**
 * #573 (Darren, 2026-10-30): the player's own fire emit killed three minions with no word. The
 * battle log marks a field that hurts one's own side (`ally`), and the ASCII message line warns
 * with the amount the first tick. A restoring field and a foe say nothing; friendly fire stays.
 */
const assert = require("node:assert/strict");
const { createPlaySession } = require("../../packages/runtime/src/runner/play-session.js");
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const TILES = ["############", "#..........#", "#.........E#", "############"];

function level({ kind, allyMotivations = ["escorting", "friendly"], foe = false }) {
  return buildUnifiedLevel({
    id: "ally_warning",
    tiles: TILES,
    actors: [
      { category: "delver", id: "hero", position: { x: 1, y: 1 }, motivations: ["user_controlled"], vitals: viableVitals({ mana: 60 }),
        affinities: [{ kind, expression: "emit", stacks: 3 }], activeAffinityKey: `${kind}:emit` },
      { category: foe ? "warden" : "delver", id: "pal", position: { x: 2, y: 1 }, motivations: foe ? ["stationary"] : allyMotivations,
        vitals: viableVitals(), ...(foe ? {} : { escort: { target: "hero", distance: 1 } }) },
    ],
  });
}

async function after(opts) {
  const session = await createPlaySession({ ...level(opts), fog: false });
  await session.act({ kind: "wait" });
  return session.view();
}

test("a harmful emit that hurts a minion is marked as ally fire on the first tick", async () => {
  const view = await after({ kind: "fire" });
  const lines = view.battleLog.filter((line) => line.ally);
  assert.equal(lines.length, 1, JSON.stringify(view.battleLog));
  assert.equal(lines[0].targetId, "pal");
  assert.match(lines[0].text, /(is hurting|hits, but regen cancels it on) D2 pal: DU/, "#582: the amount and the net, not a bare claim");
  assert.ok(view.vitalChanges.some((change) => change.actorId === "pal" && change.hit < 0));
});

test("a restoring emit says nothing", async () => {
  const view = await after({ kind: "growth" });
  assert.deepEqual(view.battleLog.filter((line) => line.ally), []);
});

test("an enemy in the field is not an ally", async () => {
  const view = await after({ kind: "fire", foe: true });
  assert.deepEqual(view.battleLog.filter((line) => line.ally), []);
});
