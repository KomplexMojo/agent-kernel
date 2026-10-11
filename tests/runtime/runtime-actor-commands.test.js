/**
 * Player turns — `runtime.step({ actorCommands })` commands ONE actor while every
 * other actor still decides through the Actor persona in the same tick.
 *
 * `personaPayloads.actor` cannot do this: buildPersonaPayloads spreads it into every
 * actor's payload in the DECIDE loop, so a command meant for the player would reach
 * the wardens too. `actorCommands` is keyed by actor id and the runner only routes it;
 * the Actor turns it into a proposal and core decides legality.
 *
 * Assertions are on registry POSITIONS, not only the action ledger (AM.0).
 */
const assert = require("node:assert/strict");

const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

function makeFloorGrid(w, h) {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => (x === 0 || x === w - 1 || y === 0 || y === h - 1 ? "#" : ".")).join(""));
}

function buildLevel() {
  return buildUnifiedLevel({
    id: "actor_commands",
    tiles: makeFloorGrid(9, 9),
    actors: [
      { category: "delver", id: "delver_1", position: { x: 2, y: 4 }, motivations: ["random"], vitals: viableVitals() },
      { category: "warden", id: "warden_1", position: { x: 6, y: 2 }, motivations: ["random"], vitals: viableVitals({ health: 6 }) },
    ],
  });
}

async function startRuntime() {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const core = createCore();
  const runtime = createRuntime({ core, adapters: {}, clock: () => "2026-10-10T00:00:00.000Z" });
  await runtime.init({ seed: 0, ...buildLevel() });
  return { core, runtime };
}

// Positions are the registry's, read back through the runtime.
const position = (runtime, id) => ({ ...runtime.getActorSnapshot().actors.find((actor) => actor.id === id).position });
const lastApply = (runtime) => runtime.getTickFrames().filter((f) => f.phaseDetail === "apply").at(-1);

test("a commanded actor does exactly the command while the uncommanded warden still decides and moves", async () => {
  const { runtime } = await startRuntime();
  const wardenStart = position(runtime, "warden_1");
  const directions = ["north", "north", "east"];
  const expected = [{ x: 2, y: 3 }, { x: 2, y: 2 }, { x: 3, y: 2 }];
  let wardenMoved = false;
  for (let i = 0; i < directions.length; i += 1) {
    await runtime.step({ actorCommands: { delver_1: { kind: "move", params: { direction: directions[i] } } } });
    assert.deepEqual(position(runtime, "delver_1"), expected[i], `tick ${i}: delver must follow the command`);
    const p = position(runtime, "warden_1");
    if (p.x !== wardenStart.x || p.y !== wardenStart.y) wardenMoved = true;
  }
  assert.ok(wardenMoved, "the warden must take its own turns while the delver is commanded");
  const wardenActions = runtime.getTickFrames()
    .flatMap((f) => f.acceptedActions || [])
    .filter((a) => a.actorId === "warden_1" && a.kind === "move");
  assert.ok(wardenActions.length > 0);
  wardenActions.forEach((a) => assert.notEqual(a.params?.reason, "command"));
});

test("a command into a wall is rejected by core, the tick still advances, and the warden still acts", async () => {
  const { runtime } = await startRuntime();
  await runtime.step({ actorCommands: { delver_1: { kind: "move", params: { direction: "west" } } } });
  await runtime.step({ actorCommands: { delver_1: { kind: "move", params: { direction: "west" } } } });
  const before = runtime.getTickFrames().filter((f) => f.phaseDetail === "apply").length;
  await runtime.step({ actorCommands: { delver_1: { kind: "move", params: { direction: "west" } } } });
  assert.deepEqual(position(runtime, "delver_1"), { x: 1, y: 4 }, "the delver stops at the wall");
  const frame = lastApply(runtime);
  assert.equal(runtime.getTickFrames().filter((f) => f.phaseDetail === "apply").length, before + 1);
  assert.ok(
    (frame.preCoreRejections || []).some((r) => (r.action?.actorId || r.actorId) === "delver_1"),
    "the rejected move is recorded, not silently dropped",
  );
  assert.ok((frame.acceptedActions || []).some((a) => a.actorId === "warden_1"), "the warden acted this tick");
});

test("actorCommands for an unknown actor id throws instead of being ignored", async () => {
  const { runtime } = await startRuntime();
  await assert.rejects(runtime.step({ actorCommands: { delver_typo: { kind: "wait" } } }), /delver_typo/);
});

test("actorCommands must be a record of commands", async () => {
  const { runtime } = await startRuntime();
  await assert.rejects(runtime.step({ actorCommands: [{ kind: "wait" }] }), /actorCommands/);
});

test("a malformed command is refused before the tick starts, so the runtime stays usable", async () => {
  const { runtime } = await startRuntime();
  const framesBefore = runtime.getTickFrames().length;
  await assert.rejects(
    runtime.step({ actorCommands: { delver_1: { kind: "move", params: { direction: "up" } } } }),
    /unknown direction "up"/,
  );
  assert.equal(runtime.getTickFrames().length, framesBefore, "no phase of the tick ran");
  await runtime.step({ actorCommands: { delver_1: { kind: "move", params: { direction: "north" } } } });
  assert.deepEqual(position(runtime, "delver_1"), { x: 2, y: 3 });
});

// ## TODO: Test Permutations
// - two commanded actors in the same tick
// - a command for an actor that has already exited is rejected
// - identical command sequences replay to identical tick frames
