/**
 * #757: the play session hands out sound cues as data on each turn result: one per battle-log
 * entry the seat may read (the same fog rule, #497), naming the event, its affinity and the
 * seat's part in it, never a sound file. A client maps each cue to its own audio.
 */
const assert = require("node:assert/strict");
const { createPlaySession } = require("../../packages/runtime/src/runner/play-session.js");
const { SOUND_CUE_EVENTS, SOUND_CUE_SEAT_ROLES } = require("../../packages/runtime/src/contracts/sound-cues.js");
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const ROOM = ["##########", "S........#", "#........E", "##########"];

const hero = (extra = {}) => ({ category: "delver", id: "hero", position: { x: 1, y: 1 }, motivations: ["user_controlled"],
  affinities: [{ kind: "fire", expression: "push", stacks: 3, intensity: 1 }], activeAffinityKey: "fire:push",
  vitals: viableVitals({ health: 30, mana: 60, stamina: 100 }), ...extra });
const warden = (x, y, extra = {}) => ({ category: "warden", id: "guard", position: { x, y }, motivations: ["stationary"],
  vitals: viableVitals({ health: 40, mana: 10 }), ...extra });

async function session(actors, fog = false) {
  return createPlaySession({ ...buildUnifiedLevel({ id: "cue_room", tiles: ROOM, actors }), fog });
}

test("a cast that strikes a warden gives the seat a cast cue as its source", async () => {
  const play = await session([hero(), warden(3, 1)]);
  const result = await play.act({ kind: "cast_affinity", params: { targetId: "guard" } });
  const cast = result.cues.find((cue) => cue.event === "cast");
  assert.deepEqual(cast, { tick: result.tick, event: "cast", seat: "source", kind: "fire", expression: "push", struck: true,
    ...(cast.hit ? { hit: cast.hit } : {}), ...(cast.reception ? { reception: cast.reception } : {}) });
  for (const cue of result.cues) {
    assert.ok(SOUND_CUE_EVENTS.includes(cue.event), cue.event);
    assert.ok(SOUND_CUE_SEAT_ROLES.includes(cue.seat), cue.seat);
    assert.equal(cue.sourceId, undefined, "a cue names no actor");
  }
});

test("a turn where nothing happens has no cues", async () => {
  const play = await session([hero()]);
  assert.deepEqual((await play.act({ kind: "wait" })).cues, []);
});

test("reaching the exit gives an exit cue with the seat as its target", async () => {
  const play = await session([hero({ position: { x: 7, y: 2 } })]);
  await play.order(play.playerActorId, { goals: [{ kind: "reach", place: "exit" }] });
  const result = await play.advance({ ticks: 6 });
  assert.ok(result.status.exited, JSON.stringify(result.status));
  assert.deepEqual(result.cues.filter((cue) => cue.event === "exit"), [{ tick: result.tick, event: "exit", seat: "target" }]);
});

test("advance gathers the cues of every tick it ran", async () => {
  const play = await session([hero(), warden(3, 1)]);
  await play.order(play.playerActorId, { tactics: [{ when: { tickAtLeast: 0 }, do: { kind: "cast_affinity", params: { targetId: "guard" } } }] });
  const result = await play.advance({ ticks: 4 });
  const ticks = new Set(result.cues.filter((cue) => cue.event === "cast" && cue.seat === "source").map((cue) => cue.tick));
  assert.ok(ticks.size >= 2, `casts on several ticks: ${JSON.stringify(result.cues)}`);
});

test("under fog, what no one on the party could see gives no cue", async () => {
  // A wall between them: the warden's own cast at a third actor out of sight is not heard.
  const tiles = ["#########", "S...#...#", "#...#...E", "#########"];
  const level = buildUnifiedLevel({ id: "cue_fog", tiles, actors: [
    hero({ affinities: [], activeAffinityKey: undefined }),
    { ...warden(6, 1), affinities: [{ kind: "fire", expression: "push", stacks: 2, intensity: 1 }], activeAffinityKey: "fire:push",
      motivations: ["attacking"], vitals: viableVitals({ health: 40, mana: 60 }) },
    { category: "delver", id: "stray", position: { x: 6, y: 2 }, motivations: ["stationary"], vitals: viableVitals() },
  ] });
  const cuesWith = async (fog) => (await (await createPlaySession({ ...level, fog })).advance({ ticks: 3 })).cues;
  assert.ok((await cuesWith(false)).some((cue) => cue.event === "cast" && cue.seat === "none"), "without fog the seat hears the warden's casts");
  assert.deepEqual(await cuesWith(true), [], "with fog, nothing it could not see");
});

test("the terminal client's state carries the cues of the last command that ran a tick", async () => {
  const { createGame } = await import("../../packages/ui-ascii/src/game.js");
  const level = { name: "cue_room", ...buildUnifiedLevel({ id: "cue_room", tiles: ROOM, actors: [hero(), warden(3, 1)] }) };
  const game = await createGame({ levels: [level], fog: false, showHelp: false });
  await game.command({ kind: "cast_affinity", params: { targetId: "guard" } });
  assert.ok(game.state().cues.some((cue) => cue.event === "cast" && cue.seat === "source"), JSON.stringify(game.state().cues));
  await game.command({ kind: "switch", actorId: "hero" });
  assert.deepEqual(game.state().cues, [], "a command that runs no tick clears them");
});

// ## TODO: Test Permutations
// - a cast at the seat gives a cue with seat "target" and the attacker's affinity
// - a take from a resource gives a take cue with seat "source"
// - a defeat by the seat's cast gives a defeat cue with seat "source" and the cast's kind
// - an emit that hurts an escort gives a field cue marked friendly
// - order and actTick results carry cues too
