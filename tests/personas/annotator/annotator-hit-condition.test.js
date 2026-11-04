/**
 * #692 (Darren, 2026-11-02) — hit condition bands. A cast that strikes another says how hurt the
 * target looks after the tick, how hard the hit was and how its slots took it: in words, from
 * core's rules, stamped by the Annotator. No vital, current or max, ever reaches the entry (#497).
 */
const assert = require("node:assert/strict");

const CLOCK = () => "2026-11-02T00:00:00.000Z";
const PERSONAS = "../../../packages/runtime/src/personas/";
const { createPlaySession } = require("../../../packages/runtime/src/runner/play-session.js");
const { buildUnifiedLevel, viableVitals } = require("../../fixtures/ui-ascii/unified-level.mjs");

async function entriesFor(battle) {
  const { createAnnotatorPersona } = await import(`${PERSONAS}annotator/persona.js`);
  const annotator = createAnnotatorPersona({ clock: CLOCK });
  const result = annotator.advance({ phase: "emit", event: "observe", tick: battle.tick,
    payload: { runId: "r", observations: [{ tick: battle.tick, effects: [], battle }] } });
  return result.telemetry.battleLog;
}

test("a struck cast carries a band, a hit word and the reception, and no numbers", async () => {
  const [entry] = await entriesFor({
    tick: 4,
    casts: [{ sourceId: "a", targetId: "b", kind: "fire", expression: "push", reception: "amplified",
      changes: [{ actorId: "a", vital: "mana", delta: -3 }, { actorId: "b", vital: "durability", delta: -6 }, { actorId: "b", vital: "health", delta: -2 }] }],
    lifecycles: { a: "alive", b: "alive" },
    struck: { b: { defeatVital: "health", vitals: { health: { current: 9, max: 20 }, durability: { current: 0, max: 20 } } } },
  });
  assert.equal(entry.meta.producedBy, "annotator");
  assert.equal(entry.condition, "bloodied");
  assert.equal(entry.hit, "crushing");
  assert.equal(entry.reception, "amplified");
  assert.doesNotMatch(JSON.stringify(entry), /current|max|delta|"vitals"/);
});

test("a hit that lands hardest on armour bands that vital too (Darren, 2026-11-02)", async () => {
  const [entry] = await entriesFor({
    tick: 2,
    casts: [{ sourceId: "a", targetId: "b", kind: "fire", expression: "push",
      changes: [{ actorId: "b", vital: "durability", delta: -6 }] }],
    lifecycles: { a: "alive", b: "alive" },
    struck: { b: { defeatVital: "health", vitals: { health: { current: 20, max: 20 }, durability: { current: 4, max: 20 } } } },
  });
  assert.equal(entry.condition, "unhurt");
  assert.equal(entry.struckVital, "durability");
  assert.equal(entry.struckCondition, "near_defeat");
  const { battleLogLine, conditionNote } = await import("../../../packages/runtime/src/render/battle-log-lines.js");
  assert.equal(battleLogLine(entry, { seatId: "a", showCondition: true }),
    "You cast fire push and struck b with a firebolt: a crushing hit; its durability looks nearly gone; it looks unhurt.");
  assert.equal(battleLogLine(entry, { seatId: "z" }), "A cast fire push and struck b with a firebolt.");
  assert.equal(conditionNote({ band: "unhurt", age: 2, struckVital: "durability", struckBand: "hurt" }), "looks unhurt, durability worn, 2 ticks ago");

  // A hit on the defeat vital itself names no second vital.
  const [direct] = await entriesFor({
    tick: 2,
    casts: [{ sourceId: "a", targetId: "b", kind: "decay", expression: "push", changes: [{ actorId: "b", vital: "health", delta: -6 }] }],
    lifecycles: { a: "alive", b: "alive" },
    struck: { b: { defeatVital: "health", vitals: { health: { current: 14, max: 20 } } } },
  });
  assert.equal(direct.struckVital, undefined);
});

test("a cast at oneself or with no reading carries no band", async () => {
  const entries = await entriesFor({
    tick: 1,
    casts: [{ sourceId: "a", targetId: "a", kind: "growth", expression: "push", changes: [] },
      { sourceId: "a", targetId: "b", kind: "fire", expression: "push", changes: [] }],
    lifecycles: { a: "alive", b: "alive" },
  });
  assert.equal(entries[0].condition, undefined);
  assert.equal(entries[1].condition, undefined);
  assert.equal(entries[1].struck, true);
});

const duel = () => buildUnifiedLevel({
  id: "duel",
  tiles: ["#######", "#.....#", "#.....E", "#######"],
  actors: [
    { category: "delver", id: "hero", position: { x: 1, y: 1 }, motivations: ["user_controlled"],
      vitals: viableVitals({ mana: 200 }), affinities: [{ kind: "decay", expression: "push", stacks: 2, intensity: 1 }] },
    { category: "warden", id: "guard", position: { x: 3, y: 1 }, motivations: ["stationary"], vitals: viableVitals() },
  ],
});
const equip = (affinityKey) => ({ kind: "equip_affinity", params: { affinityKey } });
const cast = (targetId) => ({ kind: "cast_affinity", params: { targetId } });

test("the seat's side sees how hurt its target looks, with an age that fades to unknown", async () => {
  const session = await createPlaySession(duel());
  await session.act(equip("decay:push"));
  await session.act(cast("guard"));
  const guard = () => [...session.view().actors, ...session.view().lastSeen].find((actor) => actor.id === "guard");
  const first = guard().condition;
  assert.ok(["unhurt", "hurt", "bloodied", "near_defeat"].includes(first.band), JSON.stringify(first));
  assert.equal(first.age, 0);
  assert.doesNotMatch(JSON.stringify(first), /\d{2,}|current|max/);
  const line = session.view().battleLog.filter((entry) => entry.event === "cast").at(-1).text;
  assert.match(line, /struck .*guard with .+: .*it looks /);

  await session.act({ kind: "wait" });
  assert.equal(guard().condition.age, 1);
  for (let i = 0; i < 5; i += 1) await session.act({ kind: "wait" });
  assert.equal(guard().condition.band, "unknown");

  // A fresh hit reads the band again.
  await session.act(cast("guard"));
  assert.notEqual(guard().condition.band, "unknown");
  assert.equal(guard().condition.age, 0);
});

test("an actor no one on our side has hit carries no condition", async () => {
  const session = await createPlaySession(duel());
  const guard = [...session.view().actors, ...session.view().lastSeen].find((actor) => actor.id === "guard");
  assert.equal(guard?.condition, undefined);
});

// ## TODO: Test Permutations
// - a hostile's hit on another hostile, seen by the party, sets no band and its line carries no condition words.
// - a hit from a party member's escort (minion) sets the band for the whole party.
// - a target that leaves sight keeps its band, aged, in lastSeen; the band fades there too.
// - every harmful kind: an opposite slot reads `amplified`, a same-kind push `resisted`, in the line too.
// - a structure (hazard, resource) bands on durability, its defeat vital.
