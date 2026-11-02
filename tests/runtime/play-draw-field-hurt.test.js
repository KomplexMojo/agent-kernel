/**
 * AK-12 / playtest-draw-no-hurt: light+growth draw + fire emit kit.
 *
 * Restoring draws are top-ups (#537), not weapons: at full HP/MP they transfer nothing.
 * Before the fix, fieldHits blamed every co-located draw whenever fire emit took DU, so the
 * battle log said "Your light/growth draw is hurting …" with no vital change from those draws.
 * Contacts now come from core; the seat's own field lines name the vital and amount.
 */
const assert = require("node:assert/strict");
const { createPlaySession } = require("../../packages/runtime/src/runner/play-session.js");
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const equip = (affinityKey) => ({ kind: "equip_affinity", params: { affinityKey } });
const KIT = [
  { kind: "light", expression: "draw", stacks: 3, intensity: 2 },
  { kind: "growth", expression: "draw", stacks: 2, intensity: 2 },
  { kind: "fire", expression: "emit", stacks: 1, intensity: 2 },
];
const FULL = {
  health: { current: 20, max: 20, regen: 1 },
  mana: { current: 50, max: 50, regen: 40 },
  stamina: { current: 12, max: 12, regen: 2 },
  durability: { current: 10, max: 10, regen: 1 },
};

function level(heroVitals, affinities, wardenPos = { x: 2, y: 1 }) {
  return buildUnifiedLevel({
    id: "draw_hurt",
    tiles: ["#######", "#.....#", "#....E#", "#######"],
    actors: [
      { category: "delver", id: "hero", position: { x: 1, y: 1 }, motivations: ["user_controlled"],
        vitals: heroVitals, affinities },
      { category: "warden", id: "warden_1", position: wardenPos, motivations: ["stationary"],
        vitals: viableVitals({ health: 40, mana: 40, durability: 40 }) },
    ],
  });
}

test("playtest kit at full vitals: only fire emit hurts; idle draws are not logged as hurting", async () => {
  const session = await createPlaySession(level(FULL, KIT));
  for (const key of ["light:draw", "growth:draw", "fire:emit"]) await session.act(equip(key));
  const lines = session.view().battleLog.map((line) => line.text);
  assert.ok(lines.some((text) => /Your fire emit is hurting .*warden_1: DU/.test(text)), lines.join(" | "));
  assert.equal(lines.filter((text) => /light draw|growth draw/.test(text)).length, 0,
    `idle restoring draws must not claim hurt: ${lines.join(" | ")}`);
  const du = session.view().vitalChanges.find((change) => change.actorId === "warden_1" && change.vital === "durability");
  assert.ok(du && du.hit < 0, "fire emit still takes durability");
});

test("light draw that tops up mana is logged with MP amount; growth at full HP is not", async () => {
  const midMana = { ...FULL, mana: { current: 30, max: 50, regen: 0 } };
  const session = await createPlaySession(level(midMana, KIT.filter((pair) => pair.expression === "draw")));
  await session.act(equip("light:draw"));
  await session.act(equip("growth:draw"));
  const lines = session.view().battleLog.map((line) => line.text);
  assert.ok(lines.some((text) => /Your light draw is hurting .*warden_1: MP/.test(text)), lines.join(" | "));
  assert.equal(lines.filter((text) => /growth draw/.test(text)).length, 0,
    `growth draw at full HP must stay silent: ${lines.join(" | ")}`);
});

test("growth draw while the source lacks HP steals health and names it", async () => {
  const midHp = { ...FULL, health: { current: 10, max: 20, regen: 0 } };
  const session = await createPlaySession(level(midHp, [{ kind: "growth", expression: "draw", stacks: 2, intensity: 2 }]));
  await session.act(equip("growth:draw"));
  const lines = session.view().battleLog.map((line) => line.text);
  assert.ok(lines.some((text) => /Your growth draw is hurting .*warden_1: HP/.test(text)), lines.join(" | "));
  const hp = session.view().vitalChanges.find((change) => change.actorId === "warden_1" && change.vital === "health");
  assert.ok(hp && hp.hit < 0);
});

// ## TODO: Test Permutations
// - fire emit that spills into health while a full-HP growth draw is co-located must not log growth
// - fortify draw / light draw at full primary vital stay silent next to a damaging emit
// - enemy's draw on the seat still gets amounts via #582 side.has(target)
