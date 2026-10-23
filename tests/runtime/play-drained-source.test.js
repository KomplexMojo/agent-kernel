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

// ## TODO: Test Permutations
// - a drained source comes back on, undimmed, once its mana is full
// - a drained warden (not a trap) is dimmed and named off too
// - without colour the board glyph is unchanged; only the in-sight line says off
