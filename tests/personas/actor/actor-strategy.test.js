/**
 * Strategies (Phase 2b, decision 5): an actor given a strategy follows it on its own
 * turns, as far as its thinking motivation reaches.
 *   none / reflexive   ignores it (reported, never refused)
 *   goal_oriented      follows the goals, in order
 *   strategy_focused   follows the goals and the tactics (first matching tactic wins)
 *   user_controlled    the same, on every turn it is not commanded
 * Progress lives in the Actor's own serializable context, per actor. A goal whose target
 * is out of sight hands the turn back to the actor's motivations ("searching"); one that
 * cannot be met says why ("stalled"). Mid-game orders (`actorStrategies`) replace the
 * strategy and cost the ordered actor that turn (decision 8).
 */
const assert = require("node:assert/strict");

const { createPlaySession } = require("../../../packages/runtime/src/runner/play-session.js");
const {
  actorStrategyDepth,
  normalizeActorStrategy,
} = require("../../../packages/runtime/src/personas/actor/persona.js");
const { createConfiguratorPersona } = require("../../../packages/runtime/src/personas/configurator/controller.js");
const { buildUnifiedLevel, viableVitals } = require("../../fixtures/ui-ascii/unified-level.mjs");

const ROOM = [
  "############",
  "S..........#",
  "#..........#",
  "#..........#",
  "#..........#",
  "#..........E",
  "############",
];

const HERO = { category: "delver", id: "hero", position: { x: 1, y: 1 }, vitals: viableVitals(), motivations: ["user_controlled"] };
const companion = (id, position, motivations, strategy, extra = {}) => ({
  category: "delver", id, position, vitals: viableVitals(), motivations, ...(strategy ? { strategy } : {}), ...extra,
});
// Levels are unlit and an actor sees one tile (#203); a light it emits lets it see further.
const LANTERN = { affinities: [{ kind: "light", expression: "emit", stacks: 9 }], activeAffinityKey: "light:emit",
  vitals: viableVitals({ mana: 2000 }) };
const warden = (id, position, extra = {}) => ({
  category: "warden", id, position, vitals: viableVitals(), motivations: ["stationary"], ...extra,
});

async function play(actors, { fog = false } = {}) {
  return createPlaySession({ ...buildUnifiedLevel({ id: "strategy_room", tiles: ROOM, actors }), fog });
}

function positionOf(session, id) {
  const view = session.view();
  if (view.player?.id === id) return view.player.position;
  return (view.actors || []).find((actor) => actor.id === id)?.position;
}

async function waitTurns(session, turns) {
  for (let i = 0; i < turns; i += 1) await session.act({ kind: "wait" });
}

const configurator = createConfiguratorPersona({ clock: () => "2026-10-14T00:00:00.000Z" });

test("the depth an actor follows is set by its thinking motivation", () => {
  assert.equal(actorStrategyDepth(["exploring"]), "none");
  assert.equal(actorStrategyDepth(["exploring", "reflexive"]), "none");
  assert.equal(actorStrategyDepth(["exploring", "goal_oriented"]), "goals");
  assert.equal(actorStrategyDepth(["strategy_focused"]), "full");
  assert.equal(actorStrategyDepth(["user_controlled"]), "full");
});

test("a strategy's shape is the Actor's: defaults filled, malformed parts refused", () => {
  assert.deepEqual(normalizeActorStrategy({ goals: [{ kind: "follow", target: "hero" }, { kind: "reach", place: "exit" }] }),
    { goals: [{ kind: "follow", target: "hero", distance: 1 }, { kind: "reach", place: "exit" }] });
  assert.deepEqual(normalizeActorStrategy({ tactics: [{ when: { vital: "health", below: 30 }, do: { kind: "retreat" } }] }),
    { goals: [], tactics: [{ when: { vital: "health", below: 30 }, do: { kind: "retreat" } }] });
  assert.throws(() => normalizeActorStrategy({ goals: [{ kind: "dance" }] }), /unknown kind "dance"/);
  assert.throws(() => normalizeActorStrategy({ goals: [{ kind: "reach" }] }), /reach needs a place/);
  assert.throws(() => normalizeActorStrategy({ goals: [] }), /at least one goal or tactic/);
  assert.throws(() => normalizeActorStrategy({ goals: [{ kind: "hold", place: { x: 1, y: 1 } }] }), /hold ticks/);
  assert.throws(() => normalizeActorStrategy({ tactics: [{ when: { hostileWithin: 2 }, do: { kind: "fly" } }] }), /unknown command kind/);
});

test("goal_oriented: goals run in order, and a finished goal hands over to the next", async () => {
  const strategy = { goals: [{ kind: "reach", place: { x: 4, y: 3 } }, { kind: "hold", place: { x: 4, y: 3 }, ticks: 2 }, { kind: "reach", place: { x: 4, y: 1 } }] };
  const session = await play([HERO, companion("pal", { x: 1, y: 3 }, ["stationary", "goal_oriented"], strategy)]);
  const trail = [];
  for (let turn = 0; turn < 12 && session.strategies().pal?.status !== "done"; turn += 1) {
    await session.act({ kind: "wait" });
    trail.push([session.strategies().pal.goal, positionOf(session, "pal")]);
  }
  assert.deepEqual(trail.slice(0, 3).map(([, at]) => at), [{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }], "straight east to the first place");
  const held = trail.filter(([goal]) => goal === 1);
  assert.ok(held.length >= 2 && held.every(([, at]) => at.x === 4 && at.y === 3), "holds its place for the ticks given");
  assert.deepEqual(positionOf(session, "pal"), { x: 4, y: 1 });
  assert.equal(session.strategies().pal.status, "done");
});

test("take on an intact resource beside it takes it unbroken, whatever the taker carries (#435)", async () => {
  for (const kind of [null, "growth", "decay"]) {
    // Levels are unlit and an actor sees one tile, so the resource starts beside it.
    const chest = { category: "resource", id: "chest", position: { x: 3, y: 3 },
      vitals: { durability: { current: 1, max: 1, regen: 0 } },
      holdings: [{ id: "heal", kind: "vital", permanenceMode: "consumable", claimedBy: null, vitals: [{ key: "health", delta: 5 }] }] };
    const carried = kind ? { affinities: [{ kind, expression: "push", stacks: 1 }], activeAffinityKey: `${kind}:push` } : {};
    const strategy = { goals: [{ kind: "take", target: "chest" }] };
    const session = await play([HERO, chest, companion("pal", { x: 2, y: 3 }, ["stationary", "goal_oriented"], strategy, carried)]);
    const label = kind ?? "no affinity";
    for (let turn = 0; turn < 8 && session.strategies().pal?.status !== "done"; turn += 1) await session.act({ kind: "wait" });
    assert.equal(session.strategies().pal.status, "done", label);
    // Emptied, the resource leaves the player's view (Darren, 2026-10-30); unbroken, it is still alive.
    const left = session.debugView().actors.find((actor) => actor.id === "chest");
    assert.ok(left && left.lifecycle === "alive", `${label}: the resource is unbroken`);
  }
});

test("follow keeps a companion beside its ally as the ally moves", async () => {
  const strategy = { goals: [{ kind: "follow", target: "hero", distance: 1 }] };
  const session = await play([HERO, companion("pal", { x: 6, y: 4 }, ["exploring", "goal_oriented"], strategy, LANTERN)]);
  for (let i = 0; i < 6; i += 1) await session.act({ kind: "move", params: { direction: "east" } });
  const hero = positionOf(session, "hero");
  const pal = positionOf(session, "pal");
  assert.ok(Math.max(Math.abs(hero.x - pal.x), Math.abs(hero.y - pal.y)) <= 1, `pal ${JSON.stringify(pal)} stays by hero ${JSON.stringify(hero)}`);
  assert.equal(session.strategies().pal.status, "active");
});

test("without a thinking motivation the strategy is ignored, and the Configurator reports it", async () => {
  const strategy = { goals: [{ kind: "reach", place: { x: 4, y: 3 } }] };
  const actors = [HERO, companion("idle", { x: 1, y: 3 }, ["stationary"], strategy)];
  const session = await play(actors);
  await waitTurns(session, 2);
  assert.deepEqual(positionOf(session, "idle"), { x: 1, y: 3 }, "a stationary actor with no thinking stays put");
  assert.equal(session.strategies().idle.status, "ignored");
  const { initialState } = buildUnifiedLevel({ id: "strategy_room", tiles: ROOM, actors });
  assert.deepEqual(configurator.authorCandidates.reportActorStrategies(initialState),
    [{ actorId: "idle", depth: "none", ignored: ["goals"] }]);
});

test("tactics need strategy_focused: goal_oriented reports them ignored, strategy_focused acts on them", async () => {
  const strategy = {
    goals: [{ kind: "hold", place: { x: 5, y: 3 }, ticks: 50 }],
    tactics: [{ when: { hostileWithin: 2 }, do: { kind: "retreat" } }],
  };
  const actors = [HERO,
    companion("plain", { x: 5, y: 3 }, ["stationary", "goal_oriented"], strategy, LANTERN),
    companion("sharp", { x: 5, y: 1 }, ["stationary", "strategy_focused"], { ...strategy, goals: [{ kind: "hold", place: { x: 5, y: 1 }, ticks: 50 }] }, LANTERN),
    warden("guard", { x: 7, y: 2 })];
  const { initialState } = buildUnifiedLevel({ id: "strategy_room", tiles: ROOM, actors });
  assert.deepEqual(configurator.authorCandidates.reportActorStrategies(initialState),
    [{ actorId: "plain", depth: "goals", ignored: ["tactics"] }]);

  const session = await play(actors);
  await waitTurns(session, 1);
  assert.deepEqual(positionOf(session, "plain"), { x: 5, y: 3 }, "goal_oriented keeps holding");
  assert.deepEqual(session.strategies().plain.ignored, ["tactics"]);
  const sharp = positionOf(session, "sharp");
  assert.ok(Math.max(Math.abs(sharp.x - 7), Math.abs(sharp.y - 2)) > 2, `sharp retreats out of reach, at ${JSON.stringify(sharp)}`);
  assert.equal(session.strategies().sharp.tactic, 0);
});

test("defeat closes in and casts until the target is defeated, then the goal is done", async () => {
  const armed = { affinities: [{ kind: "fire", expression: "push", stacks: 2, intensity: 2 }, { kind: "light", expression: "emit", stacks: 9 }],
    activeAffinityKey: "fire:push", equippedAffinityKeys: ["fire:push", "light:emit"], vitals: viableVitals({ mana: 2000 }) };
  const actors = [HERO,
    companion("hunter", { x: 1, y: 4 }, ["stationary", "goal_oriented"], { goals: [{ kind: "defeat", target: "prey" }] }, armed),
    warden("prey", { x: 6, y: 4 }, { vitals: viableVitals({ health: 10 }) })];
  const session = await play(actors);
  let turns = 0;
  while (session.strategies().hunter?.status !== "done" && turns < 40) {
    await session.act({ kind: "wait" });
    turns += 1;
  }
  assert.equal(session.strategies().hunter.status, "done", "prey is defeated");
  assert.ok(turns < 40);
});

test("an unknown target stalls the goal and hands the turn to the actor's motivations", async () => {
  const session = await play([HERO, companion("pal", { x: 1, y: 3 }, ["stationary", "goal_oriented"], { goals: [{ kind: "follow", target: "nobody" }] })]);
  await waitTurns(session, 1);
  assert.deepEqual(session.strategies().pal, { goal: 0, status: "stalled", reason: "unknown_target" });
  assert.deepEqual(positionOf(session, "pal"), { x: 1, y: 3 });
});

test("a target out of sight is searched for with the actor's own motivations", async () => {
  const WALLED = [
    "############",
    "S....#.....#",
    "#....#.....#",
    "#....#.....#",
    "#..........#",
    "#..........E",
    "############",
  ];
  const actors = [HERO, companion("pal", { x: 1, y: 2 }, ["stationary", "goal_oriented"], { goals: [{ kind: "defeat", target: "far" }] }),
    warden("far", { x: 9, y: 1 })];
  const session = await createPlaySession(buildUnifiedLevel({ id: "walled", tiles: WALLED, actors }));
  await waitTurns(session, 1);
  assert.equal(session.strategies().pal.status, "searching");
  assert.equal(session.strategies().pal.reason, "target_out_of_sight");
});

test("a mid-game order replaces the strategy and costs the ordered actor its turn", async () => {
  const session = await play([HERO, companion("pal", { x: 1, y: 3 }, ["stationary", "friendly", "goal_oriented"], { goals: [{ kind: "reach", place: { x: 8, y: 3 } }] })]);
  await waitTurns(session, 1);
  assert.deepEqual(positionOf(session, "pal"), { x: 2, y: 3 });
  const ordered = await session.order("pal", { goals: [{ kind: "reach", place: { x: 2, y: 1 } }] });
  assert.equal(ordered.ok, true);
  assert.deepEqual(positionOf(session, "pal"), { x: 2, y: 3 }, "taking the order is the turn");
  assert.deepEqual(session.strategies().pal.order, { goals: [{ kind: "reach", place: { x: 2, y: 1 } }] });
  await waitTurns(session, 2);
  assert.deepEqual(positionOf(session, "pal"), { x: 2, y: 1 }, "the new order is followed");
});

test("user_controlled follows its own strategy only on turns it is not commanded", async () => {
  const strategy = { goals: [{ kind: "reach", place: { x: 1, y: 5 } }] };
  const session = await play([{ ...HERO, motivations: ["user_controlled"] }, companion("pal", { x: 6, y: 1 }, ["user_controlled"], strategy)]);
  await session.act({ kind: "move", params: { direction: "east" } }, { actorId: "pal" });
  assert.deepEqual(positionOf(session, "pal"), { x: 7, y: 1 }, "a command wins over the strategy");
  await session.act({ kind: "wait" });
  assert.notDeepEqual(positionOf(session, "pal"), { x: 7, y: 1 }, "unseated and uncommanded, it follows its strategy");
});

// ## TODO: Test Permutations
// - guard: a hostile entering the radius around the guarded ally is engaged; with none, the guard returns to the ally.
// - lead: the leader waits for an ally more than `distance` behind, and walks on when it catches up.
// - take: a living target that can move is defeated first, then each unclaimed holding is taken in id order; done when none are left.
// - survive: a hostile within `distance` makes the actor step to the neighbour farthest from it.
// - tactics: vital/below, defeated, tickAtLeast conditions; a cast_affinity at "nearest_hostile"; the first matching tactic wins.
// - a stalled "no_route" goal (a place walled off) and a "target_gone" follow (the ally exits).
// - two actors under orders keep separate progress in one Actor context; a replay reaches the same progress.
