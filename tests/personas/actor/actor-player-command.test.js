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

test("a move command becomes the actor's only gameplay action, targeting the cell next to its observed position", async () => {
  const result = await proposeOnce({ actor: DELVER, command: { kind: "move", params: { direction: "east" } } });
  const gameplay = result.actions.filter((a) => a.kind !== "emit_log" && a.kind !== "emit_telemetry");
  assert.equal(gameplay.length, 1);
  assert.equal(gameplay[0].kind, "move");
  assert.equal(gameplay[0].actorId, "delver_1");
  assert.deepEqual(gameplay[0].params, { target: { x: 3, y: 2 } });
});

test("a commanded actor is not posed to the solver even when runtime decisioning is enabled", async () => {
  const result = await proposeOnce({
    actor: DELVER,
    command: { kind: "move", params: { direction: "north" } },
    payload: { runtimeDecisioning: true },
  });
  assert.deepEqual(result.effects, [], "no solver_request may be emitted for a commanded actor");
  const move = result.actions.find((a) => a.kind === "move");
  assert.deepEqual(move?.params?.target, { x: 2, y: 1 });
});

test("control check: the same actor without a command IS posed to the solver", async () => {
  const result = await proposeOnce({ actor: DELVER, payload: { runtimeDecisioning: true } });
  assert.ok(result.effects.length > 0, "without a command runtime decisioning must still emit its request");
});

test("a wait command proposes wait", async () => {
  const result = await proposeOnce({ actor: DELVER, command: { kind: "wait" } });
  const gameplay = result.actions.filter((a) => a.kind !== "emit_log" && a.kind !== "emit_telemetry");
  assert.deepEqual(gameplay.map((a) => a.kind), ["wait"]);
  assert.equal(gameplay[0].params, undefined, "a unified wait carries no params");
});

test("a move into a wall is still proposed: legality belongs to core, not the Actor", async () => {
  const actor = { ...DELVER, position: { x: 1, y: 1 } };
  const result = await proposeOnce({ actor, command: { kind: "move", params: { direction: "west" } } });
  const move = result.actions.find((a) => a.kind === "move");
  assert.deepEqual(move?.params?.target, { x: 0, y: 1 });
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

test("an equip command proposes equipping that affinity (#202)", async () => {
  const result = await proposeOnce({ actor: DELVER, command: { kind: "equip_affinity", params: { affinityKey: "light:emit" } } });
  const gameplay = result.actions.filter((a) => a.kind !== "emit_log" && a.kind !== "emit_telemetry");
  assert.deepEqual(gameplay.map((a) => [a.kind, a.params]), [["equip_affinity", { affinityKey: "light:emit" }]]);
});

test("equip with replaceKey and unequip propose the slot commands core accepts (slots M3)", async () => {
  const equip = await proposeOnce({
    actor: DELVER,
    command: { kind: "equip_affinity", params: { affinityKey: "water:push", replaceKey: "light:emit" } },
  });
  assert.deepEqual(
    equip.actions.filter((a) => a.kind !== "emit_log" && a.kind !== "emit_telemetry").map((a) => [a.kind, a.params]),
    [["equip_affinity", { affinityKey: "water:push", replaceKey: "light:emit" }]],
  );
  const unequip = await proposeOnce({
    actor: DELVER,
    command: { kind: "unequip_affinity", params: { affinityKey: "light:emit" } },
  });
  assert.deepEqual(
    unequip.actions.filter((a) => a.kind !== "emit_log" && a.kind !== "emit_telemetry").map((a) => [a.kind, a.params]),
    [["unequip_affinity", { affinityKey: "light:emit" }]],
  );
});

test("a cast command proposes casting at that target; range and mana are core's to judge", async () => {
  const result = await proposeOnce({ actor: DELVER, command: { kind: "cast_affinity", params: { targetId: "warden_far_away" } } });
  const gameplay = result.actions.filter((a) => a.kind !== "emit_log" && a.kind !== "emit_telemetry");
  assert.deepEqual(gameplay.map((a) => [a.kind, a.params]), [["cast_affinity", { targetId: "warden_far_away" }]]);
});

test("a cast command may name which equipped affinity to fire", async () => {
  const result = await proposeOnce({
    actor: DELVER,
    command: { kind: "cast_affinity", params: { targetId: "warden_1", affinityKey: "water:push" } },
  });
  const gameplay = result.actions.filter((a) => a.kind !== "emit_log" && a.kind !== "emit_telemetry");
  assert.deepEqual(gameplay.map((a) => [a.kind, a.params]), [["cast_affinity", { targetId: "warden_1", affinityKey: "water:push" }]]);
});

test("a take command proposes taking that holding", async () => {
  const command = { kind: "take", params: { targetId: "warden_1", holdingId: "affinity:fire:push" } };
  const result = await proposeOnce({ actor: DELVER, command });
  const gameplay = result.actions.filter((a) => a.kind !== "emit_log" && a.kind !== "emit_telemetry");
  assert.deepEqual(gameplay.map((a) => [a.kind, a.params]), [["take", command.params]]);
});

test("affinity commands with malformed params throw", async () => {
  await assert.rejects(proposeOnce({ actor: DELVER, command: { kind: "equip_affinity", params: { affinityKey: "fire" } } }), /affinityKey/);
  await assert.rejects(proposeOnce({ actor: DELVER, command: { kind: "equip_affinity", params: { affinityKey: "fire:push", replaceKey: "x" } } }), /replaceKey/);
  await assert.rejects(proposeOnce({ actor: DELVER, command: { kind: "unequip_affinity", params: {} } }), /affinityKey/);
  await assert.rejects(proposeOnce({ actor: DELVER, command: { kind: "cast_affinity", params: {} } }), /targetId/);
  await assert.rejects(proposeOnce({ actor: DELVER, command: { kind: "cast_affinity", params: { targetId: "w", affinityKey: "fire" } } }), /affinityKey/);
  await assert.rejects(proposeOnce({ actor: DELVER, command: { kind: "take", params: { targetId: "w" } } }), /holdingId/);
});

// ## TODO: Test Permutations
// - every one of the eight directions maps to the matching target cell
// - a command for a stationary-kind actor proposes nothing
// - a command with a budget still goes through the Allocator's admissibility judge
// - command on an actor whose position is absent from the observation
// - an equip command for a key the actor does not hold is still proposed (core refuses it)
// - extra params on any affinity command throw
// - equip without replaceKey omits the field (single-slot callers keep their shape)
// - cast without affinityKey omits the field
