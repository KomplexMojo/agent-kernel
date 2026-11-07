// #720: each strategy recipe, driven through its trigger. The turn is the Actor's own
// `followStrategy` over a context shaped like the controller's (own record, scoped view, own hits),
// so each recipe's first matching tactic is checked against what it proposes, and a quiet turn
// hands back to the actor's motivations (proposals null).
const assert = require("node:assert/strict");

const { actorStrategyRecipe } = require("../../../packages/runtime/src/personas/actor/persona.js");

let followStrategy;
let FULL;
beforeAll(async () => {
  const strategy = await import("../../../packages/runtime/src/personas/actor/strategy.js");
  followStrategy = strategy.followStrategy;
  FULL = strategy.STRATEGY_DEPTH.FULL;
});

const SIZE = 12;
const open = () => Array.from({ length: SIZE }, (_, y) => Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 1 : 0)));
const vital = (current, max = 100) => ({ current, max, regen: 1 });

/** A delver at (5, 5) holding `affinities` (all equipped unless `equipped` says otherwise). */
function turn(name, { affinities = ["fire:push:4"], equipped, vitals = {}, actors = [], received = [], tileKinds = open(), goalEntry = {} } = {}) {
  const held = affinities.map((text) => {
    const [kind, expression, stacks] = text.split(":");
    return { kind, expression, stacks: Number(stacks ?? 1), intensity: 1 };
  });
  const record = { id: "me", position: { x: 5, y: 5 }, lifecycle: "alive", alignment: "party", defeatVital: "health",
    vitals: { health: vital(100), mana: vital(100), stamina: vital(100), durability: vital(100), ...vitals },
    capabilities: { canMove: true, canCast: true }, affinities: held,
    equippedAffinityKeys: equipped ?? held.map((entry) => `${entry.kind}:${entry.expression}`), holdings: [] };
  const hostiles = actors.filter((actor) => actor.hostile);
  const nearest = [...hostiles].sort((a, b) => Math.max(Math.abs(a.position.x - 5), Math.abs(a.position.y - 5))
    - Math.max(Math.abs(b.position.x - 5), Math.abs(b.position.y - 5)))[0] ?? null;
  const view = { actors: [record, ...actors] };
  const context = {
    actorId: "me", self: record, record, view, hostiles, nearestHostile: nearest, received, tick: 4,
    configuredIds: new Set(view.actors.map((actor) => actor.id)), tileKinds, baseTiles: null, reservedTargets: [],
    // The controller's castAt: the first equipped push or pull that reaches, never a restoring one.
    castAt: (target, distance) => {
      const slot = held.find((entry) => ["push", "pull"].includes(entry.expression) && entry.stacks >= distance
        && record.equippedAffinityKeys.includes(`${entry.kind}:${entry.expression}`) && !["growth", "fortify", "light"].includes(entry.kind));
      return slot ? { kind: "cast_affinity", params: { targetId: target.id, affinityKey: `${slot.kind}:${slot.expression}` } } : null;
    },
    exitStep: () => [{ kind: "move", params: { target: { x: 6, y: 5 } } }],
    exitPlace: () => ({ x: 10, y: 5 }),
    onExit: () => false,
    commandProposal: (command) => command,
  };
  const recipe = actorStrategyRecipe(name);
  return followStrategy({ strategy: recipe.strategy, depth: FULL, entry: goalEntry, context });
}

const hostile = (id, x, y, extra = {}) => ({ id, position: { x, y }, lifecycle: "alive", alignment: "dungeon", defeatVital: "health",
  capabilities: { canMove: true }, hostile: true, ...extra });
const ally = (id, x, y) => ({ id, position: { x, y }, lifecycle: "alive", alignment: "party", defeatVital: "health", capabilities: { canMove: true } });
const hit = (event, kind, expression, sourceId) => ({ tick: 3, event, kind, expression, ...(sourceId ? { sourceId } : {}) });
const isRetreat = (result) => result.proposals?.[0]?.kind === "move"
  && Math.max(Math.abs(result.proposals[0].params.target.x - 5), Math.abs(result.proposals[0].params.target.y - 5)) === 1;

test("attack-alignment: a water field equips the water draw it carries; a cast is answered at the caster", () => {
  const field = turn("attack-alignment", { affinities: ["fire:push:3", "water:draw:2"], equipped: ["fire:push"],
    received: [hit("field", "water", "emit", "w")], actors: [hostile("w", 7, 5)] });
  assert.deepEqual(field.proposals, [{ kind: "equip_affinity", params: { affinityKey: "water:draw" } }]);
  const emit = turn("attack-alignment", { affinities: ["fire:push:3", "water:emit:2"], equipped: ["fire:push"],
    received: [hit("field", "water", "emit", "w")] });
  assert.deepEqual(emit.proposals, [{ kind: "equip_affinity", params: { affinityKey: "water:emit" } }], "the emit when it has no draw");
  const cast = turn("attack-alignment", { received: [hit("cast", "water", "push", "w")], actors: [hostile("w", 7, 5)] });
  assert.deepEqual(cast.proposals, [{ kind: "cast_affinity", params: { targetId: "w", affinityKey: "fire:push" } }]);
  assert.equal(turn("attack-alignment", { received: [hit("field", "water", "emit")] }).proposals, null, "nothing to equip: its motivations play");
});

test("break-off: under half stamina it steps away before a pin; under a quarter mana it waits", () => {
  assert.ok(isRetreat(turn("break-off", { vitals: { stamina: vital(40) }, actors: [hostile("w", 6, 5)] })));
  assert.deepEqual(turn("break-off", { vitals: { mana: vital(20) } }).proposals, [{ kind: "wait" }]);
  assert.equal(turn("break-off", { actors: [hostile("w", 6, 5)] }).proposals, null, "healthy: no break-off");
});

// #758: a retreat is a move and stamina recovers only on turns it does not move, so with no one
// close it stops instead; and a stop that recovers nothing (fields eat the regen) is let go.
test("break-off: under half stamina with no hostile within two tiles it waits, not retreats", () => {
  assert.deepEqual(turn("break-off", { vitals: { stamina: vital(40) }, actors: [hostile("w", 9, 5)] }).proposals, [{ kind: "wait" }]);
  assert.deepEqual(turn("break-off", { vitals: { stamina: vital(40) } }).proposals, [{ kind: "wait" }]);
});

test("break-off: a wait that did not raise the vital is passed over until the vital rises", () => {
  const first = turn("break-off", { vitals: { mana: vital(8, 48) } });
  assert.deepEqual(first.proposals, [{ kind: "wait" }]);
  assert.deepEqual(first.entry.waited, { vital: "mana", value: 8, tick: 4 });
  const stuck = turn("break-off", { vitals: { mana: vital(8, 48) }, goalEntry: { ...first.entry, waited: { ...first.entry.waited, tick: 3 } } });
  assert.equal(stuck.proposals, null, "mana did not rise: the wait no longer recovers, so it goes on");
  assert.deepEqual(stuck.entry.waitStalled, { mana: 8 });
  const still = turn("break-off", { vitals: { mana: vital(6, 48) }, goalEntry: stuck.entry });
  assert.equal(still.proposals, null, "still at or below where waiting stalled");
  const rising = turn("break-off", { vitals: { mana: vital(10, 48) }, goalEntry: stuck.entry });
  assert.deepEqual(rising.proposals, [{ kind: "wait" }], "once the vital rises the stop works again");
  assert.equal(rising.entry.waitStalled, undefined);
  const recovering = turn("break-off", { vitals: { mana: vital(9, 48) }, goalEntry: { waited: { vital: "mana", value: 8, tick: 3 } } });
  assert.deepEqual(recovering.proposals, [{ kind: "wait" }], "a wait that raised it keeps waiting");
});

test("mana-discipline: under half mana it switches off a draw, keeps its light emit, and waits under a quarter", () => {
  const draw = turn("mana-discipline", { affinities: ["light:emit:5", "decay:draw:2"], vitals: { mana: vital(40) } });
  assert.deepEqual(draw.proposals, [{ kind: "unequip_affinity", params: { affinityKey: "decay:draw" } }]);
  assert.equal(turn("mana-discipline", { affinities: ["light:emit:5"], vitals: { mana: vital(40) } }).proposals, null, "light stays on");
  assert.deepEqual(turn("mana-discipline", { vitals: { mana: vital(10) } }).proposals, [{ kind: "wait" }]);
});

test("focus-fire: it answers whoever struck it, else casts at the nearest it can reach", () => {
  const actors = [hostile("near", 6, 5), hostile("shooter", 8, 5)];
  assert.equal(turn("focus-fire", { actors, received: [hit("cast", "fire", "push", "shooter")] }).proposals[0].params.targetId, "shooter");
  assert.equal(turn("focus-fire", { actors }).proposals[0].params.targetId, "near");
  assert.equal(turn("focus-fire", { actors: [hostile("far", 10, 10)] }).proposals, null, "out of reach: no wasted cast");
});

test("kite: a hostile beside it, it steps away; at range, it casts", () => {
  assert.ok(isRetreat(turn("kite", { actors: [hostile("w", 6, 5)] })));
  assert.equal(turn("kite", { actors: [hostile("w", 8, 5)] }).proposals[0].kind, "cast_affinity");
});

test("ambush-from-the-dark: opens on a hostile in reach; under half mana it breaks off", () => {
  const kit = ["dark:emit:3", "fire:push:4"];
  assert.equal(turn("ambush-from-the-dark", { affinities: kit, actors: [hostile("w", 8, 5)] }).proposals[0].kind, "cast_affinity");
  assert.ok(isRetreat(turn("ambush-from-the-dark", { affinities: kit, vitals: { mana: vital(40) }, actors: [hostile("w", 8, 5)] })));
  assert.equal(turn("ambush-from-the-dark", { affinities: kit }).proposals, null, "no one near: it keeps waiting in the dark");
});

test("read-before-engaging: reads from afar with a light push, fights within two tiles", () => {
  const kit = ["light:push:5", "fire:push:2"];
  assert.deepEqual(turn("read-before-engaging", { affinities: kit, actors: [hostile("w", 9, 5)] }).proposals,
    [{ kind: "cast_affinity", params: { targetId: "w", affinityKey: "light:push" } }]);
  assert.deepEqual(turn("read-before-engaging", { affinities: kit, actors: [hostile("w", 7, 5)] }).proposals,
    [{ kind: "cast_affinity", params: { targetId: "w", affinityKey: "fire:push" } }]);
});

test("hold-the-chokepoint: casts at a hostile within four, ignores one further off", () => {
  assert.equal(turn("hold-the-chokepoint", { actors: [hostile("w", 8, 5)] }).proposals[0].kind, "cast_affinity");
  assert.equal(turn("hold-the-chokepoint", { actors: [hostile("w", 10, 5)] }).proposals, null);
});

test("guard-the-leader: casts at a hostile within two; otherwise its escort keeps it near", () => {
  assert.equal(turn("guard-the-leader", { actors: [hostile("w", 7, 5)] }).proposals[0].kind, "cast_affinity");
  assert.equal(turn("guard-the-leader", { actors: [hostile("w", 9, 5)] }).proposals, null);
});

test("triage-heal: during a fight it heals the nearest ally with its restoring push", () => {
  const result = turn("triage-heal", { affinities: ["growth:push:4"], actors: [ally("friend", 7, 5), hostile("w", 9, 9)] });
  assert.deepEqual(result.proposals, [{ kind: "cast_affinity", params: { targetId: "friend", affinityKey: "growth:push" } }]);
  assert.ok(isRetreat(turn("triage-heal", { affinities: ["growth:push:4"], vitals: { health: vital(20) }, actors: [hostile("w", 6, 5)] })));
  assert.equal(turn("triage-heal", { affinities: ["growth:push:4"], actors: [ally("friend", 7, 5)] }).proposals, null, "no fight: no heal");
});

test("loot-run: any vital under a quarter and it steps away", () => {
  assert.ok(isRetreat(turn("loot-run", { vitals: { stamina: vital(20) }, actors: [hostile("w", 6, 5)] })));
  assert.equal(turn("loot-run", { actors: [hostile("w", 6, 5)] }).proposals, null, "it explores and takes on its motivations");
});

test("hit-and-fade: casts until under half mana, then steps away", () => {
  assert.equal(turn("hit-and-fade", { actors: [hostile("w", 7, 5)] }).proposals[0].kind, "cast_affinity");
  assert.ok(isRetreat(turn("hit-and-fade", { vitals: { mana: vital(40) }, actors: [hostile("w", 7, 5)] })));
});

test("structure-breaker: a barrier closing its way to the exit is cast at; a clear way walks on", () => {
  const wall = open();
  for (let y = 1; y < SIZE - 1; y += 1) wall[y][7] = 1;
  wall[5][7] = 1;
  const barrier = { id: "plug", position: { x: 7, y: 5 }, lifecycle: "alive", defeatVital: "durability", capabilities: { canMove: false } };
  const blocked = turn("structure-breaker", { tileKinds: wall, actors: [barrier] });
  assert.deepEqual(blocked.proposals, [{ kind: "cast_affinity", params: { targetId: "plug", affinityKey: "fire:push" } }]);
  const clear = turn("structure-breaker", {});
  assert.equal(clear.proposals[0].kind, "move", "no structure: the reach goal walks to the exit");
});

test("leech-loop: low health pulls with decay, low stamina with water; otherwise it casts as usual", () => {
  const kit = ["decay:pull:3", "water:pull:3", "fire:push:4"];
  const target = [hostile("w", 7, 5)];
  assert.equal(turn("leech-loop", { affinities: kit, vitals: { health: vital(40) }, actors: target }).proposals[0].params.affinityKey, "decay:pull");
  assert.equal(turn("leech-loop", { affinities: kit, vitals: { stamina: vital(40) }, actors: target }).proposals[0].params.affinityKey, "water:pull");
  assert.equal(turn("leech-loop", { affinities: kit, actors: target }).proposals[0].params.affinityKey, "decay:pull", "first castable slot");
});

test("silence-the-caster: struck by a cast it dark-pushes the caster; without a dark push that reaches it steps away", () => {
  const actors = [hostile("mage", 8, 5)];
  const received = [hit("cast", "fire", "push", "mage")];
  assert.deepEqual(turn("silence-the-caster", { affinities: ["dark:push:4"], actors, received }).proposals,
    [{ kind: "cast_affinity", params: { targetId: "mage", affinityKey: "dark:push" } }]);
  assert.ok(isRetreat(turn("silence-the-caster", { affinities: ["dark:push:1"], actors, received })));
  assert.equal(turn("silence-the-caster", { affinities: ["dark:push:4"], actors }).proposals, null, "not struck: nothing to answer");
});

// ## TODO: Test Permutations
// - each recipe through a play session (createPlaySession) with the spec's strategy-recipe=, not only followStrategy.
// - attack-alignment with each kind's field; mana-discipline with several upkeep slots (drops in table order).
// - triage-heal never targets a hostile; leech-loop with each vital's pulls.
