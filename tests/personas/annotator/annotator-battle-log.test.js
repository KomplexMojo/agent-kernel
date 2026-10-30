/**
 * G1 annotator/battle-log (A2 + A5) — #554.
 *
 * The battle log is the Annotator's: entries are derived from what the tick applied, stamped
 * `producedBy: "annotator"`, and carry no vitals (#497). ABLATION: with the Annotator silent the
 * session's log is empty — play-session keeps no fallback that words casts itself (it holds them).
 */
const assert = require("node:assert/strict");

const CLOCK = () => "2026-10-29T00:00:00.000Z";
const PERSONAS = "../../../packages/runtime/src/personas/";
const { createPlaySession } = require("../../../packages/runtime/src/runner/play-session.js");
const { buildUnifiedLevel, viableVitals } = require("../../fixtures/ui-ascii/unified-level.mjs");

const duel = () => buildUnifiedLevel({
  id: "duel",
  tiles: ["#####", "#..##", "#...E", "#####"],
  actors: [
    { category: "delver", id: "delver_1", position: { x: 1, y: 1 }, motivations: ["user_controlled"],
      vitals: viableVitals({ mana: 200 }), affinities: [{ kind: "decay", expression: "push", stacks: 3, intensity: 2 }] },
    { category: "warden", id: "warden_1", position: { x: 2, y: 1 }, motivations: ["stationary"],
      vitals: viableVitals(), affinities: [{ kind: "fire", expression: "push", stacks: 1 }] },
  ],
});
async function silentRegistry(annotator) {
  const { createAllocatorPersona } = await import(`${PERSONAS}allocator/persona.js`);
  const { createActorPersona } = await import(`${PERSONAS}actor/persona.js`);
  const { createModeratorPersona } = await import(`${PERSONAS}moderator/persona.js`);
  const allocator = createAllocatorPersona({ clock: CLOCK });
  return { allocator, actor: createActorPersona({ clock: CLOCK, admitProposals: allocator.admitProposals }),
    moderator: createModeratorPersona({ clock: CLOCK }), annotator };
}
const equip = (affinityKey) => ({ kind: "equip_affinity", params: { affinityKey } });
const cast = (targetId) => ({ kind: "cast_affinity", params: { targetId } });

async function fight(level) {
  const session = await createPlaySession(level);
  await session.act(equip("decay:push"));
  for (let i = 0; i < 8 && !session.view().departures.length; i += 1) await session.act(cast("warden_1"));
  return session;
}

test("cast and defeat entries are derived by the Annotator and stamped by it", async () => {
  const { createAnnotatorPersona } = await import(`${PERSONAS}annotator/persona.js`);
  const annotator = createAnnotatorPersona({ clock: CLOCK });
  const battle = {
    tick: 3,
    casts: [{ sourceId: "a", targetId: "b", kind: "decay", expression: "push", changes: [{ actorId: "b", vital: "health", delta: -9 }] }],
    takes: [{ actorId: "a", targetId: "c" }],
    lifecycles: { a: "alive", b: "defeated" },
    exitedActorIds: ["z"],
  };
  const result = annotator.advance({ phase: "emit", event: "observe", tick: 3,
    payload: { runId: "r", observations: [{ tick: 3, effects: [], battle }] } });
  const entries = result.telemetry.battleLog;
  assert.deepEqual(entries.map((e) => e.event), ["cast", "take", "defeat", "exit"]);
  assert.deepEqual(entries[0], { schema: "agent-kernel/BattleLogEntry", schemaVersion: 1,
    meta: { id: "battlelog_3_0", runId: "r", createdAt: CLOCK(), producedBy: "annotator" },
    tick: 3, event: "cast", sourceId: "a", targetId: "b", kind: "decay", expression: "push", struck: true });
  assert.deepEqual(entries[2], { ...entries[2], event: "defeat", targetId: "b", sourceId: "a", kind: "decay", expression: "push" });
  assert.ok(entries.every((e) => e.meta.producedBy === "annotator"));
  assert.ok(!JSON.stringify(entries).includes("delta"), "no vitals in an entry (#497)");
});

test("the session exposes the log as words, from the Annotator's entries", async () => {
  const session = await fight(duel());
  const lines = session.view().battleLog;
  assert.ok(lines.length >= 2, "casts and the defeat are logged");
  assert.match(lines[0].text, /^You cast decay push and struck D?\w* ?warden_1\.$|^You cast decay push and struck .*warden_1\.$/);
  assert.match(lines.at(-1).text, /warden_1 was defeated by your decay push\.$/);
  assert.ok(lines.every((line) => Number.isInteger(line.tick)));
  assert.ok(!lines.some((line) => /\d+\/\d+|[−-]\d/.test(line.text.replace(/warden_1|delver_1/g, ""))), "no vitals in the words");
});

test("a resource worn down in the seat's emit field is logged as destroyed by that emit (playtest 2026-10-29)", async () => {
  const level = buildUnifiedLevel({
    id: "aura", tiles: ["######", "#...E#", "######"],
    actors: [
      { category: "delver", id: "delver_1", position: { x: 1, y: 1 }, motivations: ["user_controlled"],
        vitals: viableVitals({ mana: 40 }), affinities: [{ kind: "decay", expression: "emit", stacks: 2 }] },
      { category: "resource", id: "resource_1", position: { x: 2, y: 1 },
        vitals: { durability: { current: 1, max: 1, regen: 0 } } },
    ],
  });
  const session = await createPlaySession(level);
  await session.act(equip("decay:emit"));
  for (let i = 0; i < 8 && !session.view().departures.length; i += 1) await session.act({ kind: "wait" });
  const lines = session.view().battleLog.map((line) => line.text);
  assert.ok(lines.some((line) => /resource_1 was destroyed by your decay emit\.$/.test(line)), lines.join(" | "));
});

// Playtest 2026-10-30 (Darren): a lasting field doing damage is reported, once, when it starts.
const DAMAGING = ["fire", "water", "earth", "wind", "decay", "corrode", "dark"];
for (const kind of DAMAGING) {
  test(`the seat's ${kind} emit hurting a warden is logged once, when it starts`, async () => {
    const level = buildUnifiedLevel({
      id: "aura", tiles: ["#######", "#.....#", "#....E#", "#######"],
      actors: [
        { category: "delver", id: "delver_1", position: { x: 1, y: 1 }, motivations: ["user_controlled"],
          vitals: viableVitals({ mana: 60 }), affinities: [{ kind, expression: "emit", stacks: 2 }] },
        { category: "warden", id: "warden_1", position: { x: 2, y: 1 }, motivations: ["stationary"],
          vitals: viableVitals({ health: 60, durability: 60 }) },
      ],
    });
    const session = await createPlaySession(level);
    await session.act(equip(`${kind}:emit`));
    for (let i = 0; i < 3; i += 1) await session.act({ kind: "wait" });
    const lines = session.view().battleLog.map((line) => line.text).filter((text) => /is hurting/.test(text));
    assert.deepEqual(lines.map((text) => text.replace(/W\d+ /, "")), [`Your ${kind} emit is hurting warden_1.`]);
  });
}

test("field entries: a restoring emit is not logged, a draw is, and a contact that ends and restarts is logged again", async () => {
  const { buildBattleLogEntries, fieldHitsOf, fieldHitKey } = await import(`${PERSONAS}annotator/battle-log.js`);
  const battle = (fields) => ({ tick: 1, casts: [], takes: [], lifecycles: {}, fieldHits: [{ targetId: "t", fields }] });
  const events = (b, previousFieldHits = []) => buildBattleLogEntries({ battle: b, previousFieldHits, clock: CLOCK })
    .filter((entry) => entry.event === "field").map((entry) => `${entry.sourceId}:${entry.kind}:${entry.expression}`);
  for (const kind of ["growth", "fortify", "light"]) assert.deepEqual(events(battle([{ sourceId: "a", kind, expression: "emit" }])), []);
  const draw = battle([{ sourceId: "a", kind: "growth", expression: "draw" }]);
  assert.deepEqual(events(draw), ["a:growth:draw"]);
  assert.deepEqual(events(draw, fieldHitsOf(draw).map(fieldHitKey)), [], "ongoing: not repeated");
  assert.deepEqual(events(draw, []), ["a:growth:draw"], "after a tick without it, it starts again");
  const [entry] = buildBattleLogEntries({ battle: draw, clock: CLOCK });
  assert.equal(entry.meta.producedBy, "annotator");
});

test("words: a field that starts hurting someone names whose emit or draw it is", async () => {
  const { battleLogLine } = await import("../../../packages/runtime/src/render/battle-log-lines.js");
  const field = (extra) => battleLogLine({ event: "field", sourceId: "me", targetId: "w", kind: "wind", expression: "emit", ...extra },
    { seatId: "me", labelOf: (id) => (id === "w" ? "W1" : null) });
  assert.equal(field({}), "Your wind emit is hurting W1 w.");
  assert.equal(field({ sourceId: "w", targetId: "me", kind: "dark", expression: "draw" }), "W1 w's dark draw is hurting you.");
});

test("words: a defeat says whose attack, and what lives on durability is destroyed", async () => {
  const { battleLogLine } = await import("../../../packages/runtime/src/render/battle-log-lines.js");
  const entry = (extra) => ({ event: "defeat", targetId: "t", sourceId: "me", kind: "fire", expression: "push", ...extra });
  assert.equal(battleLogLine(entry({}), { seatId: "me" }), "T was defeated by your fire push.");
  assert.equal(battleLogLine(entry({ defeatVital: "durability" }), { seatId: "other" }), "T was destroyed by me's fire push.");
  assert.equal(battleLogLine(entry({ defeatVital: "health", sourceId: "w" }), { seatId: "me", labelOf: (id) => (id === "w" ? "W1" : null) }),
    "T was defeated by W1 w's fire push.");
  assert.equal(battleLogLine({ event: "defeat", targetId: "t", defeatVital: "durability" }), "T was destroyed.");
});

test("a take names what it gave (playtest 2026-10-29)", async () => {
  const { battleLogLine } = await import("../../../packages/runtime/src/render/battle-log-lines.js");
  const take = (taken) => battleLogLine({ event: "take", sourceId: "me", targetId: "r", taken }, { seatId: "me", labelOf: () => "R1" });
  assert.equal(take({ kind: "vital", permanenceMode: "consumable", vitals: [{ key: "health", delta: 10 }] }), "You took +10 health from R1 r.");
  assert.equal(take({ kind: "vital", permanenceMode: "permanent", vitals: [{ key: "mana", delta: 5, regen: 1 }] }), "You took +5 max mana, +1 mana regen from R1 r.");
  assert.equal(take({ kind: "affinity", affinity: "fire", expression: "push" }), "You took fire push from R1 r.");
  assert.equal(take(undefined), "You took from R1 r.");
});

test("a take in a played level carries the holding core granted", async () => {
  const level = buildUnifiedLevel({
    id: "loot", tiles: ["######", "#...E#", "######"],
    actors: [
      { category: "delver", id: "delver_1", position: { x: 1, y: 1 }, motivations: ["user_controlled"], vitals: viableVitals() },
      { category: "resource", id: "resource_1", position: { x: 2, y: 1 }, vitals: { durability: { current: 5, max: 5, regen: 0 } },
        holdings: [{ id: "heal", kind: "vital", permanenceMode: "consumable", vitals: [{ key: "health", delta: 10 }], claimedBy: null }] },
    ],
  });
  const session = await createPlaySession(level);
  await session.act({ kind: "take", params: { targetId: "resource_1", holdingId: "heal" } });
  assert.ok(session.view().battleLog.some((line) => /^You took \+10 health from .*resource_1\.$/.test(line.text)), JSON.stringify(session.view().battleLog));
});

test("fog: a cast out of sight and out of the party is not logged", async () => {
  const level = buildUnifiedLevel({
    id: "far", tiles: ["###########", "#.........E", "###########"],
    actors: [
      { category: "delver", id: "delver_1", position: { x: 1, y: 1 }, motivations: ["user_controlled"], vitals: viableVitals() },
      { category: "warden", id: "warden_1", position: { x: 9, y: 1 }, motivations: ["stationary"], vitals: viableVitals(),
        affinities: [{ kind: "fire", expression: "push", stacks: 1 }] },
    ],
  });
  const session = await createPlaySession({ ...level, fog: true });
  await session.act({ kind: "wait" });
  assert.deepEqual(session.view().battleLog, []);
});

test("G1 annotator/battle-log ABLATION: a silent Annotator leaves the log empty", async () => {
  const { createAnnotatorPersona } = await import(`${PERSONAS}annotator/persona.js`);
  const real = createAnnotatorPersona({ clock: CLOCK });
  const silent = { subscribePhases: real.subscribePhases, view: real.view,
    advance: (input) => ({ ...real.advance(input), telemetry: null }) };
  // Control: the real persona logs the fight.
  assert.ok((await fight(duel())).view().battleLog.length > 0, "precondition: the fight logs something");
  const session = await createPlaySession({ ...duel(), personas: await silentRegistry(silent) });
  await session.act(equip("decay:push"));
  await session.act(cast("warden_1"));
  assert.equal(session.view().casts.length, 1, "precondition: a cast happened");
  assert.deepEqual(session.view().battleLog, []);
});

// ## TODO: Test Permutations
// - take entries (loot) and exit entries through a played level
// - an Annotator restored from view() mid-fight keeps the lifecycle memory (no phantom defeats)
// - companion kills seen by the seat vs out of sight

// #582: a field hit states the vital and amount with regen's share; it says "hurting" only when the vital ends lower.
test("words: a field hit that regen cancels says so; a stronger one says hurting, with the net", async () => {
  const { battleLogLine } = await import("../../../packages/runtime/src/render/battle-log-lines.js");
  const line = (effect) => battleLogLine({ event: "field", sourceId: "h", targetId: "me", kind: "wind", expression: "emit" },
    { seatId: "me", labelOf: (id) => (id === "h" ? "H2" : null), effect });
  assert.equal(line({ vital: "stamina", hit: -2, regen: 3 }), "H2 h's wind emit hits, but regen cancels it on you: ST \u22122, regen +3 (net 0).");
  assert.equal(line({ vital: "stamina", hit: -5, regen: 3 }), "H2 h's wind emit is hurting you: ST \u22125, regen +3 (net \u22122).");
  assert.equal(line({ vital: "durability", hit: -2, regen: 0 }), "H2 h's wind emit is hurting you: DU \u22122.");
  assert.equal(line(null), "H2 h's wind emit is hurting you.", "no reading, no claim about amounts");
});

// #582, through the session: a warden's wind emit on the seat. Regen cancelling the hit reads as cancelled.
for (const [regen, expected] of [[5, /hits, but regen cancels it on you: ST −\d+, regen \+\d+ \(net 0\)\./], [0, /is hurting you: ST −\d+\./]]) {
  test(`a field on the seat with stamina regen ${regen} is worded by its net`, async () => {
    const level = buildUnifiedLevel({
      id: "net", tiles: ["#######", "#.....#", "#....E#", "#######"],
      actors: [
        { category: "delver", id: "delver_1", position: { x: 1, y: 1 }, motivations: ["user_controlled"],
          vitals: { ...viableVitals({ stamina: 20 }), stamina: { current: 20, max: 20, regen } } },
        { category: "warden", id: "warden_1", position: { x: 2, y: 1 }, motivations: ["stationary"],
          vitals: viableVitals({ mana: 60 }), affinities: [{ kind: "wind", expression: "emit", stacks: 1 }], activeAffinityKey: "wind:emit" },
      ],
    });
    const session = await createPlaySession(level);
    for (let i = 0; i < 3; i += 1) await session.act({ kind: "wait" });
    const lines = session.view().battleLog.map((line) => line.text).filter((text) => /wind emit/.test(text));
    assert.equal(lines.length, 1, lines.join(" | "));
    assert.match(lines[0], expected);
  });
}
