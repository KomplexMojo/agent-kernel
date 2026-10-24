/**
 * #412 — a source whose lasting affinity ran out of mana is off until its mana is full
 * (the drained-affinity rule), and the board says so, for every affinity alike: its field
 * is gone, it is drawn dimmed, and the "In sight" line names it `(off until mana is full)`.
 */
const assert = require("node:assert/strict");

const { AFFINITY_KINDS } = require("../../packages/runtime/src/contracts/domain-constants.js");
const { asciiActorCellStyle, asciiRememberedCellStyle } = require("../../packages/runtime/src/render/ascii-cell-style.js");
const { createPlaySession } = require("../../packages/runtime/src/runner/play-session.js");
const { inSightLine } = require("../../packages/ui-ascii/src/screen.js");
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const HALL = ["###########", "S.........E", "###########"];
const PLAYER = { category: "delver", id: "hero", position: { x: 1, y: 1 }, vitals: viableVitals(), motivations: ["user_controlled"] };

// Mana for one turn of upkeep (2 + range 2 + intensity 1) and no regen, so the field runs out
// and, with the pool never full again, stays off.
function trap(kind, manaRegen = 0) {
  return {
    category: "hazard", id: "t", position: { x: 6, y: 1 },
    vitals: { durability: { current: 10, max: 10, regen: 1 }, mana: { current: 5, max: 10, regen: manaRegen } },
    affinities: [{ kind, expression: "emit", stacks: 2 }], activeAffinityKey: `${kind}:emit`,
  };
}

async function drained(kind) {
  const session = await createPlaySession(buildUnifiedLevel({ id: "drain", tiles: HALL, actors: [PLAYER, trap(kind)] }));
  const before = session.view();
  for (let i = 0; i < 3; i += 1) await session.act({ kind: "wait" });
  return { before, after: session.view() };
}

test("a drained source has no field, is dimmed and is named off, for every affinity", async () => {
  for (const kind of AFFINITY_KINDS) {
    const { before, after } = await drained(kind);
    const lit = before.hazards[0];
    assert.equal(lit.affinityOff, undefined, `${kind}: on while it has mana`);
    assert.match(inSightLine(before), /H\d+ t(?! \(off)/, kind);
    const off = after.hazards[0];
    assert.equal(off.affinityOff, true, `${kind}: off once drained`);
    assert.deepEqual(after.field[1][5], [], `${kind}: no field beside a drained source`);
    assert.deepEqual(asciiActorCellStyle(off), {
      ...asciiRememberedCellStyle(asciiActorCellStyle(lit)), affinity: kind,
    }, `${kind}: drawn dimmed`);
    assert.match(inSightLine(after), /t \(off until mana is full\)/, kind);
  }
});

test("a source with one of two lasting slots off is still on", async () => {
  const actor = { ...trap("fire"), affinities: [{ kind: "fire", expression: "emit", stacks: 2 }, { kind: "water", expression: "draw", stacks: 2 }],
    affinitySlots: 2, equippedAffinityKeys: ["fire:emit", "water:draw"], affinityExhausted: true, exhaustedAffinityKeys: ["water:draw"] };
  const { toViewActor } = await import("../../packages/runtime/src/runner/play-session.js");
  assert.equal(toViewActor(actor, {}, new Map()).affinityOff, undefined);
  assert.equal(toViewActor({ ...actor, exhaustedAffinityKeys: undefined }, {}, new Map()).affinityOff, true);
});

// #454: a lasting slot whose upkeep is above max mana never comes back (#441), so it isn't
// named "until mana is full"; the line gives the upkeep and the max instead.
test("a source whose upkeep is above its max mana is named off for good, with the numbers, for every affinity", async () => {
  for (const kind of AFFINITY_KINDS) {
    const poor = { ...trap(kind), vitals: { durability: { current: 10, max: 10, regen: 1 }, mana: { current: 4, max: 4, regen: 1 } } };
    const session = await createPlaySession(buildUnifiedLevel({ id: "poor", tiles: HALL, actors: [PLAYER, poor] }));
    for (let i = 0; i < 3; i += 1) await session.act({ kind: "wait" });
    const view = session.view();
    assert.deepEqual(view.hazards[0].affinityUnpayable, { upkeep: 5, maxMana: 4 }, kind);
    assert.match(inSightLine(view), /t \(off: upkeep 5 > max mana 4\)/, kind);
  }
});

test("the player's own slot that full mana can't pay says so", async () => {
  const hero = { ...PLAYER, vitals: { ...viableVitals(), mana: { current: 4, max: 4, regen: 1 } },
    affinities: [{ kind: "light", expression: "emit", stacks: 2 }], activeAffinityKey: "light:emit" };
  const session = await createPlaySession(buildUnifiedLevel({ id: "poor-hero", tiles: HALL, actors: [hero] }));
  for (let i = 0; i < 3; i += 1) await session.act({ kind: "wait" });
  const { player } = session.view();
  assert.deepEqual(player.unpayableAffinities, [{ key: "light:emit", upkeep: 5, maxMana: 4 }]);
  assert.ok(player.exhaustedAffinityKeys.includes("light:emit"));
  const { renderScreen } = await import("../../packages/ui-ascii/src/screen.js");
  assert.match(renderScreen({ view: session.view(), title: "poor" }), /light emit .*\(off: upkeep 5 > max mana 4\)/);
});

// ## TODO: Test Permutations
// - a drained source comes back on, undimmed, once its mana is full
// - a drained warden (not a trap) is dimmed and named off too
// - without colour the board glyph is unchanged; only the in-sight line says off
