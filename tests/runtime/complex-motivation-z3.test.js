/**
 * M8 — Complex motivation via Z3 solver: runtime integration
 *
 * Verifies that:
 *   1. An actor with runtimeDecisioning enabled emits a SolverRequest effect
 *      that wraps the simple-motivation proposals as candidate actions
 *   2. The Z3 adapter, invoked through the solver port, resolves the envelope
 *      to a deterministic action selection
 *   3. resolveActionFromSolverResult round-trips the solver result back to a
 *      concrete Action whose kind matches a candidate
 *   4. Solver errors/deferred responses are recorded without IO and do not bypass
 *      the simple motivation flow
 */
"use strict";

const assert = require("node:assert/strict");

const ACTOR_ID = "delver_z3";
const WARDEN_ID = "warden_z3";

// ---------------------------------------------------------------------------
// Helpers — build a runtime-decision-enabled actor and run one propose cycle
// ---------------------------------------------------------------------------

function makeBaseTiles() {
  // 5×3 floor row
  return ["#####", "#...#", "#####"];
}

/**
 * Run one observe → decide → propose cycle and return the persona's effects.
 */
async function runOneProposeCycle({ observation, payload, extraPayload = {} }) {
  const { createActorPersona } = await import(
    "../../packages/runtime/src/personas/actor/controller.mts"
  );
  const { TickPhases } = await import(
    "../../packages/runtime/src/personas/_shared/tick-state-machine.mts"
  );
  const persona = createActorPersona({ clock: () => "fixed_clock" });
  const fullPayload = { ...payload, observation, baseTiles: makeBaseTiles(), ...extraPayload };
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload: fullPayload, tick: 1 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload: fullPayload, tick: 1 });
  return persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload: fullPayload, tick: 1 });
}

// ---------------------------------------------------------------------------
// Requirement: solver request is emitted only when there are candidate actions
// (i.e. simple motivation produced at least one proposal).
// ---------------------------------------------------------------------------

test("actor with runtimeDecisioning emits SolverRequest effect containing candidate actions", async () => {
  const observation = {
    actors: [
      { id: ACTOR_ID, kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "attacking" } },
      { id: WARDEN_ID, kind: 2, position: { x: 2, y: 1 }, role: "warden" },
    ],
    tiles: { baseTiles: makeBaseTiles() },
    exit: { x: 3, y: 1 },
  };
  const payload = {
    actorId: ACTOR_ID,
    runtimeDecisioning: {
      enabled: true,
      mode: "solver",
      preferred: "solver",
      targetAdapter: "z3",
    },
  };

  const result = await runOneProposeCycle({ observation, payload });

  // The persona should emit a single solver-request effect (no direct actions when solver fires)
  const solverEffects = (result.effects || []).filter((e) => e?.kind === "solver_request");
  assert.equal(solverEffects.length, 1, "exactly one SolverRequest effect should be emitted");

  const request = solverEffects[0].request;
  assert.equal(request?.schema, "agent-kernel/SolverRequest");
  const envelope = request?.problem?.data;
  assert.ok(envelope, "solver request must include a runtime-decision envelope as problem.data");
  assert.equal(envelope.contract, "runtime-decision-v1");
  assert.ok(envelope.candidateActions?.length > 0, "envelope must include candidate actions from simple motivation");
});

test("solver request envelope wraps the simple-motivation attack proposal when actor is adjacent to hostile", async () => {
  const observation = {
    actors: [
      { id: ACTOR_ID, kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "attacking" } },
      { id: WARDEN_ID, kind: 2, position: { x: 2, y: 1 }, role: "warden" },
    ],
    tiles: { baseTiles: makeBaseTiles() },
    exit: { x: 3, y: 1 },
  };
  const payload = {
    actorId: ACTOR_ID,
    runtimeDecisioning: { enabled: true, mode: "solver", preferred: "solver", targetAdapter: "z3" },
  };

  const result = await runOneProposeCycle({ observation, payload });
  const envelope = result.effects[0].request.problem.data;

  // M5's simple motivation produces an attack proposal; M8 must include it in the envelope's candidates.
  const attackCandidate = envelope.candidateActions.find((c) => c.action?.kind === "attack");
  assert.ok(attackCandidate, "envelope must contain the simple-motivation attack proposal as a candidate");
  assert.equal(attackCandidate.action.params.targetId, WARDEN_ID);
});

// ---------------------------------------------------------------------------
// Solver port → Z3 adapter end-to-end
// ---------------------------------------------------------------------------

test("Z3 adapter via solver port resolves the envelope to a fulfilled action", async () => {
  const observation = {
    actors: [
      { id: ACTOR_ID, kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "attacking" } },
      { id: WARDEN_ID, kind: 2, position: { x: 2, y: 1 }, role: "warden" },
    ],
    tiles: { baseTiles: makeBaseTiles() },
    exit: { x: 3, y: 1 },
  };
  const payload = {
    actorId: ACTOR_ID,
    runtimeDecisioning: { enabled: true, mode: "solver", preferred: "solver", targetAdapter: "z3" },
  };

  const result = await runOneProposeCycle({ observation, payload });
  const solverRequest = result.effects[0].request;

  // Wire through the solver port to the Z3 adapter
  const [{ createSolverPort }, { createZ3SolverAdapter }, { resolveActionFromSolverResult }] = await Promise.all([
    import("../../packages/runtime/src/ports/solver.js"),
    import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js"),
    import("../../packages/runtime/src/personas/_shared/runtime-decision.mts"),
  ]);

  const port = createSolverPort({ clock: () => "fixed_clock" });
  const adapter = createZ3SolverAdapter();
  const solverResult = await port.solve(adapter, solverRequest);

  assert.equal(solverResult.status, "fulfilled");
  assert.equal(solverResult.model.contract, "runtime-decision-v1");
  assert.ok(solverResult.model.selectedActionId, "Z3 model must include selectedActionId");

  // Round-trip: convert solver result back to a concrete Action
  const resolved = resolveActionFromSolverResult({ solverRequest, solverResult });
  assert.equal(resolved.ok, true, `resolveActionFromSolverResult should succeed; errors: ${JSON.stringify(resolved.errors)}`);
  // Z3 prefers attack candidates first — when adjacent to hostile, action.kind = "attack"
  assert.equal(resolved.action.kind, "attack", "Z3 should select attack candidate when adjacent to hostile");
  assert.equal(resolved.action.params?.targetId, WARDEN_ID);
});

// ---------------------------------------------------------------------------
// Error and deferred handling
// ---------------------------------------------------------------------------

test("solver deferred response is recorded without throwing or executing IO", async () => {
  const observation = {
    actors: [
      { id: ACTOR_ID, kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "attacking" } },
      { id: WARDEN_ID, kind: 2, position: { x: 2, y: 1 }, role: "warden" },
    ],
    tiles: { baseTiles: makeBaseTiles() },
    exit: { x: 3, y: 1 },
  };
  const payload = {
    actorId: ACTOR_ID,
    runtimeDecisioning: { enabled: true, mode: "solver", preferred: "solver", targetAdapter: "z3" },
  };

  const result = await runOneProposeCycle({ observation, payload });
  const solverRequest = result.effects[0].request;

  const [{ createSolverPort }, { createZ3SolverAdapter }, { resolveActionFromSolverResult }] = await Promise.all([
    import("../../packages/runtime/src/ports/solver.js"),
    import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js"),
    import("../../packages/runtime/src/personas/_shared/runtime-decision.mts"),
  ]);

  const port = createSolverPort({ clock: () => "fixed_clock" });
  const adapter = createZ3SolverAdapter({ forceStatus: "deferred" });
  const solverResult = await port.solve(adapter, solverRequest);

  assert.equal(solverResult.status, "deferred");
  assert.ok(solverResult.reason);

  const resolved = resolveActionFromSolverResult({ solverRequest, solverResult });
  assert.equal(resolved.ok, false, "deferred result must not resolve to an action");
  assert.equal(resolved.status, "deferred");
  assert.deepEqual(resolved.errors, ["solver_status_deferred"]);
});

test("solver error response is recorded without throwing", async () => {
  const observation = {
    actors: [
      { id: ACTOR_ID, kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "attacking" } },
      { id: WARDEN_ID, kind: 2, position: { x: 2, y: 1 }, role: "warden" },
    ],
    tiles: { baseTiles: makeBaseTiles() },
    exit: { x: 3, y: 1 },
  };
  const payload = {
    actorId: ACTOR_ID,
    runtimeDecisioning: { enabled: true, mode: "solver", preferred: "solver", targetAdapter: "z3" },
  };

  const result = await runOneProposeCycle({ observation, payload });
  const solverRequest = result.effects[0].request;

  const [{ createSolverPort }, { createZ3SolverAdapter }] = await Promise.all([
    import("../../packages/runtime/src/ports/solver.js"),
    import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js"),
  ]);

  const port = createSolverPort({ clock: () => "fixed_clock" });
  const adapter = createZ3SolverAdapter({ throwOnSolve: true });
  const solverResult = await port.solve(adapter, solverRequest);

  // Port catches the throw and produces a structured error response — no exception escapes
  assert.equal(solverResult.status, "error");
  assert.equal(solverResult.reason, "z3_adapter_simulated_failure");
});

// ---------------------------------------------------------------------------
// Simple motivation flow is preserved (M5) — complex motivation is opt-in
// ---------------------------------------------------------------------------

test("actor without runtimeDecisioning still uses simple motivation path (M5), no solver request", async () => {
  const observation = {
    actors: [
      { id: ACTOR_ID, kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "attacking" } },
      { id: WARDEN_ID, kind: 2, position: { x: 2, y: 1 }, role: "warden" },
    ],
    tiles: { baseTiles: makeBaseTiles() },
    exit: { x: 3, y: 1 },
  };
  const payload = { actorId: ACTOR_ID };  // no runtimeDecisioning

  const result = await runOneProposeCycle({ observation, payload });

  // M5 path: a concrete attack action is produced directly, no solver effects
  const solverEffects = (result.effects || []).filter((e) => e?.kind === "solver_request");
  assert.equal(solverEffects.length, 0, "simple motivation path must not emit solver effects");
  assert.ok(result.actions.length > 0, "simple motivation must produce direct actions");
  assert.equal(result.actions[0].kind, "attack");
});

test("complex actor with no hostile present sends move and wait candidates, and Z3 picks move toward exit", async () => {
  const observation = {
    actors: [
      { id: ACTOR_ID, kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "attacking" } },
    ],
    tiles: { baseTiles: makeBaseTiles() },
    exit: { x: 3, y: 1 },
  };
  const payload = {
    actorId: ACTOR_ID,
    runtimeDecisioning: { enabled: true, mode: "solver", preferred: "solver", targetAdapter: "z3" },
  };

  const result = await runOneProposeCycle({ observation, payload });
  const solverRequest = result.effects[0].request;
  const envelope = solverRequest.problem.data;
  assert.ok(envelope.candidateActions.some((c) => c.action?.kind === "move"));
  assert.ok(envelope.candidateActions.some((c) => c.action?.kind === "wait"));

  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const solverResult = await createZ3SolverAdapter().solve(solverRequest);

  assert.equal(solverResult.status, "fulfilled");
  assert.deepEqual(solverResult.model.rationaleTags, ["move_toward_exit"]);
});

test("complex actor with hostile far away lets Z3 pick the move_toward_hostile candidate", async () => {
  const observation = {
    actors: [
      { id: ACTOR_ID, kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "attacking" } },
      { id: WARDEN_ID, kind: 2, position: { x: 3, y: 1 }, role: "warden" },
    ],
    tiles: { baseTiles: makeBaseTiles() },
    exit: { x: 3, y: 1 },
  };
  const payload = {
    actorId: ACTOR_ID,
    runtimeDecisioning: { enabled: true, mode: "solver", preferred: "solver", targetAdapter: "z3" },
  };

  const result = await runOneProposeCycle({ observation, payload });
  const solverRequest = result.effects[0].request;
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const solverResult = await createZ3SolverAdapter().solve(solverRequest);

  assert.equal(solverResult.status, "fulfilled");
  assert.deepEqual(solverResult.model.rationaleTags, ["move_toward_hostile"]);
  assert.equal(solverResult.model.selectedActionId, "move_east");
});

test("solver unsat result resolves to ok=false with status unsat", async () => {
  const observation = {
    actors: [
      { id: ACTOR_ID, kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "attacking" } },
      { id: WARDEN_ID, kind: 2, position: { x: 2, y: 1 }, role: "warden" },
    ],
    tiles: { baseTiles: makeBaseTiles() },
    exit: { x: 3, y: 1 },
  };
  const payload = {
    actorId: ACTOR_ID,
    runtimeDecisioning: { enabled: true, mode: "solver", preferred: "solver", targetAdapter: "z3" },
  };

  const result = await runOneProposeCycle({ observation, payload });
  const solverRequest = result.effects[0].request;
  const { resolveActionFromSolverResult } = await import("../../packages/runtime/src/personas/_shared/runtime-decision.mts");

  const resolved = resolveActionFromSolverResult({
    solverRequest,
    solverResult: { status: "unsat", reason: "z3_no_satisfying_assignment" },
  });

  assert.equal(resolved.ok, false);
  assert.equal(resolved.status, "unsat");
  assert.deepEqual(resolved.errors, ["solver_status_unsat"]);
});

test("solver model referencing a missing candidate id fails resolution", async () => {
  const observation = {
    actors: [
      { id: ACTOR_ID, kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "attacking" } },
      { id: WARDEN_ID, kind: 2, position: { x: 2, y: 1 }, role: "warden" },
    ],
    tiles: { baseTiles: makeBaseTiles() },
    exit: { x: 3, y: 1 },
  };
  const payload = {
    actorId: ACTOR_ID,
    runtimeDecisioning: { enabled: true, mode: "solver", preferred: "solver", targetAdapter: "z3" },
  };

  const result = await runOneProposeCycle({ observation, payload });
  const solverRequest = result.effects[0].request;
  const { resolveActionFromSolverResult } = await import("../../packages/runtime/src/personas/_shared/runtime-decision.mts");

  const resolved = resolveActionFromSolverResult({
    solverRequest,
    solverResult: {
      status: "fulfilled",
      model: {
        contract: "runtime-decision-v1",
        decisionKind: "next_move",
        selectedActionId: "missing_candidate",
      },
    },
  });

  assert.equal(resolved.ok, false);
  assert.deepEqual(resolved.errors, ["selected_action_missing_from_candidates"]);
});

test("two consecutive complex actor ticks reflect post-attack state in the new envelope", async () => {
  const payload = {
    actorId: ACTOR_ID,
    runtimeDecisioning: { enabled: true, mode: "solver", preferred: "solver", targetAdapter: "z3" },
  };
  const beforeAttack = {
    actors: [
      { id: ACTOR_ID, kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "attacking" }, vitals: { health: { current: 10, max: 10, regen: 0 } } },
      { id: WARDEN_ID, kind: 2, position: { x: 2, y: 1 }, role: "warden", vitals: { health: { current: 6, max: 6, regen: 0 } } },
    ],
    tiles: { baseTiles: makeBaseTiles() },
    exit: { x: 3, y: 1 },
  };
  const afterAttack = {
    ...beforeAttack,
    actors: [
      beforeAttack.actors[0],
      { ...beforeAttack.actors[1], vitals: { health: { current: 4, max: 6, regen: 0 } } },
    ],
  };

  const first = await runOneProposeCycle({ observation: beforeAttack, payload });
  const second = await runOneProposeCycle({ observation: afterAttack, payload });
  const firstEnvelope = first.effects[0].request.problem.data;
  const secondEnvelope = second.effects[0].request.problem.data;

  assert.equal(firstEnvelope.visibleActors[0].vitals.health.current, 6);
  assert.equal(secondEnvelope.visibleActors[0].vitals.health.current, 4);
  assert.equal(secondEnvelope.candidateActions.find((c) => c.action?.kind === "attack").action.params.targetId, WARDEN_ID);
});

test("complex actor motivation flip between attacking and defending yields context-matching solver selections", async () => {
  const payload = {
    actorId: ACTOR_ID,
    runtimeDecisioning: { enabled: true, mode: "solver", preferred: "solver", targetAdapter: "z3" },
  };
  const attackingObservation = {
    actors: [
      { id: ACTOR_ID, kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "attacking" } },
      { id: WARDEN_ID, kind: 2, position: { x: 3, y: 1 }, role: "warden" },
    ],
    tiles: { baseTiles: makeBaseTiles() },
    exit: { x: 3, y: 1 },
  };
  const defendingObservation = {
    actors: [
      { id: ACTOR_ID, kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "defending" } },
      { id: WARDEN_ID, kind: 2, position: { x: 2, y: 1 }, role: "warden" },
    ],
    tiles: { baseTiles: makeBaseTiles() },
    exit: { x: 3, y: 1 },
  };

  const [{ createZ3SolverAdapter }, { resolveActionFromSolverResult }] = await Promise.all([
    import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js"),
    import("../../packages/runtime/src/personas/_shared/runtime-decision.mts"),
  ]);
  const adapter = createZ3SolverAdapter();
  const attacking = await runOneProposeCycle({ observation: attackingObservation, payload });
  const attackingRequest = attacking.effects[0].request;
  const attackingResult = await adapter.solve(attackingRequest);
  const attackingResolved = resolveActionFromSolverResult({ solverRequest: attackingRequest, solverResult: attackingResult });

  const defending = await runOneProposeCycle({ observation: defendingObservation, payload });
  const defendingRequest = defending.effects[0].request;
  const defendingResult = await adapter.solve(defendingRequest);
  const defendingResolved = resolveActionFromSolverResult({ solverRequest: defendingRequest, solverResult: defendingResult });

  assert.equal(attackingResolved.ok, true);
  assert.equal(attackingResolved.action.kind, "move");
  assert.equal(attackingResult.model.rationaleTags[0], "move_toward_hostile");
  assert.equal(defendingResolved.ok, true);
  assert.equal(defendingResolved.action.kind, "attack");
  assert.equal(defendingResolved.action.params.targetId, WARDEN_ID);
});
