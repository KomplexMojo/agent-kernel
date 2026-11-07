/**
 * #758: an unnamed cast at a hostile passes over a slot the actor saw do nothing to that target:
 * nothing off its health or durability (core's readActorDealtCasts, from how the cast landed).
 * With no useful slot left the tactic hands the turn to the goal. lantern-bearer's light pull only
 * drained the warden's mana, and leech's decay pull was resisted while its growth pull left the
 * warden unhurt, so each cast at the warden every turn and never reached the exit.
 */
const assert = require("node:assert/strict");

const { createPlaySession } = require("../../../packages/runtime/src/runner/play-session.js");
const { normalizeActorStrategy } = require("../../../packages/runtime/src/personas/actor/persona.js");
const { buildUnifiedLevel, viableVitals } = require("../../fixtures/ui-ascii/unified-level.mjs");

let followStrategy;
let FULL;
beforeAll(async () => {
  const strategy = await import("../../../packages/runtime/src/personas/actor/strategy.js");
  followStrategy = strategy.followStrategy;
  FULL = strategy.STRATEGY_DEPTH.FULL;
});

const FIGHT = Object.freeze({
  goals: [{ kind: "reach", place: "exit" }],
  tactics: [{ when: { hostileWithin: 2 }, do: { kind: "cast_affinity", params: { targetId: "nearest_hostile" } } }],
});

const vital = (current, max = 100) => ({ current, max, regen: 1 });
const SLOTS = ["light:pull", "fire:push"];

/** A turn at (5, 5) beside a warden at (6, 5); castAt picks the first slot not skipped. */
function turn({ dealt = [], entry = {} } = {}) {
  const record = { id: "me", position: { x: 5, y: 5 }, lifecycle: "alive", alignment: "party",
    vitals: { health: vital(100), mana: vital(100), stamina: vital(100), durability: vital(100) } };
  const warden = { id: "w", position: { x: 6, y: 5 }, lifecycle: "alive", alignment: "dungeon", capabilities: { canMove: true } };
  const skipped = [];
  const context = {
    actorId: "me", self: record, record, view: { actors: [record, warden] }, hostiles: [warden], nearestHostile: warden,
    received: [], dealt, tick: 4, configuredIds: new Set(["me", "w"]), tileKinds: null, baseTiles: null, reservedTargets: [],
    castAt: (target, distance, skip = []) => {
      skipped.push(skip);
      const key = SLOTS.find((slot) => !skip.includes(slot));
      return key ? { kind: "cast_affinity", params: { targetId: target.id, affinityKey: key } } : null;
    },
    exitStep: () => [{ kind: "move", params: { target: { x: 5, y: 4 } } }],
    exitPlace: () => ({ x: 5, y: 1 }),
    onExit: () => false,
    commandProposal: (command) => command,
  };
  return { ...followStrategy({ strategy: normalizeActorStrategy(FIGHT), depth: FULL, entry, context }), skipped };
}

const dealt = (kind, expression, harmed) => ({ tick: 3, targetId: "w", kind, expression, harmed });

test("a slot seen to leave the target unhurt is skipped at that target, and remembered", () => {
  const first = turn({ dealt: [dealt("light", "pull", false)] });
  assert.equal(first.proposals[0].params.affinityKey, "fire:push");
  assert.deepEqual(first.entry.futileCasts, { w: ["light:pull"] });
  const later = turn({ entry: first.entry });
  assert.equal(later.proposals[0].params.affinityKey, "fire:push", "remembered on later turns with nothing new seen");
});

test("with every slot seen to do nothing, the tactic hands the turn to the goal", () => {
  const result = turn({ dealt: [dealt("light", "pull", false), dealt("fire", "push", false)] });
  assert.deepEqual(result.proposals, [{ kind: "move", params: { target: { x: 5, y: 4 } } }]);
});

test("a harmful cast of a slot clears it; a slot that harmed is never skipped", () => {
  const cleared = turn({ dealt: [dealt("light", "pull", true)], entry: { futileCasts: { w: ["light:pull"] } } });
  assert.equal(cleared.entry.futileCasts, undefined);
  assert.equal(cleared.proposals[0].params.affinityKey, "light:pull");
});

test("in play, a delver whose only cast drains a warden's mana walks on to the exit", async () => {
  const room = [
    "##########",
    "S........#",
    "#........#",
    "#........E",
    "##########",
  ];
  const hero = { category: "delver", id: "hero", position: { x: 1, y: 1 }, motivations: ["user_controlled"],
    affinities: [{ kind: "light", expression: "pull", stacks: 2 }], activeAffinityKey: "light:pull",
    vitals: viableVitals({ health: 30, mana: 400, stamina: 100 }) };
  const warden = { category: "warden", id: "guard", position: { x: 8, y: 2 }, motivations: ["stationary"],
    affinities: [{ kind: "water", expression: "emit", stacks: 1 }], activeAffinityKey: "water:emit",
    vitals: viableVitals({ health: 200, mana: 40 }) };
  const session = await createPlaySession({ ...buildUnifiedLevel({ id: "futile_room", tiles: room, actors: [hero, warden] }), fog: false });
  const ordered = await session.order(session.playerActorId, FIGHT);
  assert.equal(ordered.ok, true, ordered.reason);
  const status = (await session.advance({ ticks: 30 })).status;
  assert.equal(status.exited, true, "the light pull only drains mana, so after one cast it stops casting and leaves");
});

// ## TODO: Test Permutations
// - the memory is per target: a slot futile at one warden is still cast at another
// - a named cast (affinityKey given) is never skipped, even when seen to do nothing
// - a defeat goal's attack also passes over a futile slot and closes in instead
