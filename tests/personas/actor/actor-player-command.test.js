/**
 * Player command — an actor the caller COMMANDS proposes exactly that action.
 *
 * The Actor README promises that "actors driven by humans, scripts, heuristics, or AI
 * models" are replayed "on equal footing". Before this seam the only way to steer one
 * actor was `payload.proposals`, which runtime decisioning demotes to the second-to-last
 * member of the rank tuple: a solver could overrule the player. A `command` is the
 * player's decision, so the Actor turns it into the actor's sole proposal and does not
 * pose that actor to the solver. Legality is still core's call; nothing here checks walls.
 */
const assert = require("node:assert/strict");

let modulesPromise;
function loadModules() {
  modulesPromise ??= Promise.all([
    import("../../../packages/runtime/src/personas/actor/persona.js"),
    import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);
  return modulesPromise;
}

const BASE_TILES = ["#######", "#.....#", "#.....#", "#.....#", "#######"];

async function proposeOnce({ actor, command, payload = {}, tick = 0 } = {}) {
  const [{ createActorPersona }, { TickPhases }] = await loadModules();
  const persona = createActorPersona({ clock: () => "fixed" });
  const observation = { tick, actors: [{ kind: 2, ...actor }] };
  const fullPayload = { actorId: actor.id, observation, baseTiles: BASE_TILES, command, ...payload };
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload: fullPayload, tick });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload: fullPayload, tick });
  return persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload: fullPayload, tick });
}

const DELVER = { id: "delver_1", role: "delver", position: { x: 2, y: 2 }, motivation: { kind: "random" } };

test("a move command becomes the actor's only gameplay action, with from/to filled from its observed position", async () => {
  const result = await proposeOnce({ actor: DELVER, command: { kind: "move", params: { direction: "east" } } });
  const gameplay = result.actions.filter((a) => a.kind !== "emit_log" && a.kind !== "emit_telemetry");
  assert.equal(gameplay.length, 1);
  assert.equal(gameplay[0].kind, "move");
  assert.equal(gameplay[0].actorId, "delver_1");
  assert.deepEqual(gameplay[0].params, { direction: "east", from: { x: 2, y: 2 }, to: { x: 3, y: 2 } });
});

test("a commanded actor is not posed to the solver even when runtime decisioning is enabled", async () => {
  const result = await proposeOnce({
    actor: DELVER,
    command: { kind: "move", params: { direction: "north" } },
    payload: { runtimeDecisioning: true },
  });
  assert.deepEqual(result.effects, [], "no solver_request may be emitted for a commanded actor");
  const move = result.actions.find((a) => a.kind === "move");
  assert.deepEqual(move?.params?.to, { x: 2, y: 1 });
});

test("control check: the same actor without a command IS posed to the solver", async () => {
  const result = await proposeOnce({ actor: DELVER, payload: { runtimeDecisioning: true } });
  assert.ok(result.effects.length > 0, "without a command runtime decisioning must still emit its request");
});

test("a wait command proposes wait", async () => {
  const result = await proposeOnce({ actor: DELVER, command: { kind: "wait" } });
  const gameplay = result.actions.filter((a) => a.kind !== "emit_log" && a.kind !== "emit_telemetry");
  assert.deepEqual(gameplay.map((a) => a.kind), ["wait"]);
  assert.equal(gameplay[0].params.reason, "command");
});

test("a move into a wall is still proposed: legality belongs to core, not the Actor", async () => {
  const actor = { ...DELVER, position: { x: 1, y: 1 } };
  const result = await proposeOnce({ actor, command: { kind: "move", params: { direction: "west" } } });
  const move = result.actions.find((a) => a.kind === "move");
  assert.deepEqual(move?.params?.to, { x: 0, y: 1 });
});

test("the commanded actor still surfaces an intention so the Moderator can order it", async () => {
  const result = await proposeOnce({ actor: DELVER, command: { kind: "move", params: { direction: "east" } } });
  assert.deepEqual(result.intentions.map((i) => i.actorId), ["delver_1"]);
});

test("malformed commands throw instead of silently falling back to autonomous play", async () => {
  await assert.rejects(
    proposeOnce({ actor: DELVER, command: { kind: "move", params: { direction: "up" } } }),
    /direction/,
  );
  await assert.rejects(proposeOnce({ actor: DELVER, command: { kind: "teleport" } }), /kind/);
});

// ## TODO: Test Permutations
// - every one of the eight directions maps to the matching to-cell
// - a command for a stationary-kind actor proposes nothing
// - a command with a budget still goes through the Allocator's admissibility judge
// - command on an actor whose position is absent from the observation
