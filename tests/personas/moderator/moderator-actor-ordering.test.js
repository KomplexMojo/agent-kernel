/**
 * The Moderator owns ACTOR ordering (maintainer ruling, 2026-09-04).
 *
 * Before this, who resolved first was `initialState.actors` array order — the sequence actors
 * happened to be written into the build spec — and no persona decided it. Measured across 48
 * scenarios, 75% had an outcome that depended on that order.
 *
 * These test the ruling itself: intentions surface from the Actor, the Moderator orders from
 * them, and the order it returns is stable enough for `ak replay` to compare frame by frame.
 */
"use strict";

const assert = require("node:assert/strict");

async function moderator() {
  return import("../../../packages/runtime/src/personas/moderator/persona.js");
}
async function contract() {
  return import("../../../packages/runtime/src/contracts/actor-intention.js");
}

test("higher intent resolves first, whatever order the actors were authored in", async () => {
  const { orderActorsByIntention } = await moderator();
  const { buildActorIntention } = await contract();
  // Authored order puts the mover first; alphabetical would too. Neither should decide.
  const actorIds = ["delver_1", "warden_1"];
  const intentions = [
    buildActorIntention({ actorId: "delver_1", intentClass: 200, intentTag: "move", tick: 1 }),
    buildActorIntention({ actorId: "warden_1", intentClass: 500, intentTag: "attack", tick: 1 }),
  ];
  assert.deepEqual(orderActorsByIntention({ actorIds, intentions }), ["warden_1", "delver_1"]);
});

test("an actor that surfaced no intention still acts, and acts last", async () => {
  const { orderActorsByIntention } = await moderator();
  const { buildActorIntention } = await contract();
  // Dropping it would silently remove an actor from the tick, which is worse than
  // ordering it badly. It sorts at class 0, the same place profile_mismatch already sits.
  const order = orderActorsByIntention({
    actorIds: ["a_1", "b_1", "c_1"],
    intentions: [buildActorIntention({ actorId: "b_1", intentClass: 100, intentTag: "wait", tick: 1 })],
  });
  assert.equal(order.length, 3, "every tracked actor must appear exactly once");
  assert.equal(order[0], "b_1", "the only actor that reported goes first");
  assert.deepEqual(order.slice(1), ["a_1", "c_1"], "unreported actors follow, by id");
});

test("ties break on actor id, because replay compares runs frame by frame", async () => {
  const { orderActorsByIntention } = await moderator();
  const { buildActorIntention } = await contract();
  const intentions = ["zeta_1", "alpha_1", "mid_1"].map((actorId) => (
    buildActorIntention({ actorId, intentClass: 300, intentTag: "move", tick: 1 })
  ));
  const forward = orderActorsByIntention({ actorIds: ["zeta_1", "alpha_1", "mid_1"], intentions });
  const reversed = orderActorsByIntention({ actorIds: ["mid_1", "alpha_1", "zeta_1"], intentions });
  assert.deepEqual(forward, ["alpha_1", "mid_1", "zeta_1"]);
  assert.deepEqual(forward, reversed, "the input order must not survive into the ruling");
});

test("the Moderator reads the class but never reinterprets it", async () => {
  const { orderActorsByIntention } = await moderator();
  const { buildActorIntention } = await contract();
  // An unknown tag with a high class still wins: the NUMBER is the Actor's ruling, and a
  // Moderator that re-derived meaning from the tag would be a second authority on Actor policy.
  const order = orderActorsByIntention({
    actorIds: ["a_1", "b_1"],
    intentions: [
      buildActorIntention({ actorId: "a_1", intentClass: 900, intentTag: "something_new", tick: 1 }),
      buildActorIntention({ actorId: "b_1", intentClass: 500, intentTag: "attack", tick: 1 }),
    ],
  });
  assert.deepEqual(order, ["a_1", "b_1"]);
});

test("malformed intentions are ignored rather than trusted", async () => {
  const { orderActorsByIntention } = await moderator();
  const { buildActorIntention } = await contract();
  const order = orderActorsByIntention({
    actorIds: ["a_1", "b_1"],
    intentions: [
      { schema: "agent-kernel/NotAnIntention", actorId: "a_1", intentClass: 999 },
      buildActorIntention({ actorId: "b_1", intentClass: 100, intentTag: "wait", tick: 1 }),
    ],
  });
  assert.deepEqual(order, ["b_1", "a_1"], "the forged high class must not win");
});

test("the Actor surfaces an intention for the action it chose", async () => {
  const { createActorPersona } = await import(
    "../../../packages/runtime/src/personas/actor/persona.js"
  );
  const { TickPhases } = await import(
    "../../../packages/runtime/src/personas/_shared/tick-state-machine.mts"
  );
  const { isActorIntention } = await contract();
  const baseTiles = ["#####", "#...#", "#...#", "#..E#", "#####"];
  const self = {
    id: "delver_1",
    kind: 2,
    role: "delver",
    position: { x: 1, y: 1 },
    motivation: { kind: "exploring" },
    vitals: { health: { current: 10, max: 10, regen: 0 }, stamina: { current: 10, max: 10, regen: 0 } },
  };
  const payload = {
    actorId: self.id,
    observation: {
      actors: [self],
      tiles: { baseTiles, kinds: baseTiles.map((line) => Array.from(line, (t) => (t === "#" ? 1 : 0))) },
      exit: { x: 3, y: 3 },
    },
    baseTiles,
    initialState: { actors: [{ id: self.id, role: self.role, kind: "motivated" }] },
  };
  const persona = createActorPersona({ clock: () => "fixed" });
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick: 0 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick: 0 });
  const result = persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick: 0 });

  assert.ok(Array.isArray(result.intentions), "the Actor must surface an intentions channel");
  assert.equal(result.intentions.length, 1, "one intention for the one action it chose");
  const [intention] = result.intentions;
  assert.ok(isActorIntention(intention), `not a valid intention: ${JSON.stringify(intention)}`);
  assert.equal(intention.actorId, "delver_1");
  assert.ok(intention.intentClass > 0, "a chosen action must carry a real class");
  // Anti-vacuity: the intention must describe the action actually emitted, not a default.
  // The tag is the CLASSIFICATION, not the raw kind -- this actor moves toward the exit, so a
  // `move` reports `exit_progress` (300) and not the kind-derived `mobile_fallback` (200) the
  // deleted `intentClassForAction` produced. Asserting the kind here would have been satisfied
  // by the coarse derivation too, which is exactly the vacuity this check exists to prevent.
  const chosen = result.actions.find((action) => action.kind !== "emit_log" && action.kind !== "emit_telemetry");
  assert.equal(chosen.kind, "move", "this scenario is only meaningful if the actor moves");
  assert.equal(intention.intentTag, "exit_progress", "the intention must carry the ranked class");
  assert.equal(intention.intentClass, 300, "exit progress outranks a bare mobile fallback");
});

// THE GAP THIS CLOSES. On the runtime-decision route the Actor emits no action during decide --
// only a solver request -- so the surfacing above never runs. Measured before the fix: 17 of 17
// advances on that path produced zero actions AND zero intentions, so every actor sorted at
// class 0 and the Moderator's ordering silently degenerated to its alphabetical tie-break, on
// precisely the path carrying the richest intent data.
test("the envelope path surfaces the intent the Actor published in its rank", async () => {
  const { resolveIntentFromDecision } = await import(
    "../../../packages/runtime/src/personas/actor/persona.js"
  );
  const solverRequest = {
    problem: {
      data: {
        contract: "runtime-decision-v1",
        decisionKind: "next_move",
        tick: 4,
        actor: { id: "delver_1" },
        candidateActions: [{ id: "move_east" }, { id: "wait_here" }],
        objectives: {
          actorDecision: {
            contract: "actor-decision-objective-v5",
            order: ["intentClass", "targetFinish"],
            candidates: [
              { candidateActionId: "move_east", rank: [400, 0], features: {}, rationaleTags: ["hostile_progress"] },
              { candidateActionId: "wait_here", rank: [100, 0], features: {}, rationaleTags: ["wait"] },
            ],
          },
        },
      },
    },
  };

  assert.deepEqual(
    resolveIntentFromDecision({ solverRequest, selectedActionId: "move_east" }),
    { actorId: "delver_1", intentClass: 400, intentTag: "hostile_progress", tick: 4 },
  );
  // It reads the winner, not the first row -- a version that returned candidates[0] would pass
  // the assertion above and be wrong for every actor whose best candidate is not listed first.
  assert.equal(
    resolveIntentFromDecision({ solverRequest, selectedActionId: "wait_here" }).intentClass,
    100,
  );
  // The member is located BY NAME from the published order, never by a hardcoded index.
  const reordered = JSON.parse(JSON.stringify(solverRequest));
  reordered.problem.data.objectives.actorDecision.order = ["targetFinish", "intentClass"];
  assert.equal(
    resolveIntentFromDecision({ solverRequest: reordered, selectedActionId: "move_east" }).intentClass,
    0,
  );
  // No rank, no intention. Ordering actors on an invented default is worse than not ordering.
  const missing = JSON.parse(JSON.stringify(solverRequest));
  delete missing.problem.data.objectives.actorDecision;
  assert.equal(resolveIntentFromDecision({ solverRequest: missing, selectedActionId: "move_east" }), null);
  assert.equal(resolveIntentFromDecision({ solverRequest, selectedActionId: "not_a_candidate" }), null);
});

// ## TODO: Test Permutations
// - two actors surfacing the same class and the same id prefix
// - an actor that emits only telemetry surfaces no intention
// - intentions from a tick other than the current one are not carried forward
