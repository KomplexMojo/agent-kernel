const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../../..");

/**
 * CR.6 half A — CHARACTERIZATION TESTS, written BEFORE the Actor's five cached
 * decision inputs (lastObservation / lastBaseTiles / lastSimConfig /
 * lastAffinityEffects / lastHazards) are removed from its closure.
 *
 * THE PREMISE WAS MEASURED, NOT ASSUMED. Instrumenting the controller and running
 * the whole suite recorded 430 cache-fallback hits — and **every one was a DIRECT
 * persona-test caller; zero came through the runner or tick-orchestrator**. The
 * runner supplies observation, baseTiles, simConfig and affinityEffects on every
 * DECIDE payload and never supplies `hazards` at all, so the carry-over is not
 * load-bearing in production. It IS load-bearing for direct callers, which is why
 * the sibling persona tests are being updated to pass full payloads.
 *
 *   A. the production shape (full payload every advance) — must be IDENTICAL
 *      before and after; this is the real characterization;
 *   B. the partial-payload carry-over — DELIBERATELY REMOVED, so it gets its own
 *      named test rather than being quietly absorbed.
 *
 * ⚠️ NON-VACUITY. A first draft of this file used `kind: "delver"`, which is not
 * proposal-eligible (`isMotivatedKind` accepts only "motivated"/"ambulatory"/2),
 * so every assertion compared [] to [] and passed for no reason. The fixtures
 * below are asserted to produce real proposals before anything is compared —
 * the same trap the CR.5 perturbation check caught, found again by looking.
 */

const BASE_TILES = ["#####", "#...E", "#####"];

function observationFor(tick = 0) {
  return {
    tick,
    actorId: "actor_1",
    // kind 2 == MOTIVATED_KIND; a non-eligible kind silently yields no proposals.
    actors: [{ kind: 2, id: "actor_1", position: { x: 1, y: 1 } }],
    hazards: [],
  };
}

function fullPayload(tick = 0) {
  return { actorId: "actor_1", observation: observationFor(tick), baseTiles: BASE_TILES };
}

async function loadActor() {
  const [{ createActorPersona }, { TickPhases }] = await Promise.all([
    import("../../../packages/runtime/src/personas/actor/persona.js"),
    import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);
  return { createActorPersona, TickPhases };
}

function shape(actions) {
  return actions.map((a) => ({ kind: a.kind, actorId: a.actorId, params: a.params }));
}

// ---------------------------------------------------------------------------
// A · The production shape — a full payload on every advance
// ---------------------------------------------------------------------------

test("CR.6 characterization: the fixtures actually produce proposals (non-vacuity guard)", async () => {
  const { createActorPersona, TickPhases } = await loadActor();
  const persona = createActorPersona({ clock: () => "fixed", seed: 7 });
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload: fullPayload(), tick: 0 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload: fullPayload(), tick: 0 });
  const result = persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload: fullPayload(), tick: 0 });

  assert.ok(
    result.actions.length > 0,
    "the shared fixture must yield at least one proposal, or every comparison below is vacuous",
  );
});

test("CR.6 characterization: two Actors fed the same full payloads agree, step for step", async () => {
  const { createActorPersona, TickPhases } = await loadActor();

  const drive = (persona) => {
    persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload: fullPayload(), tick: 0 });
    persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload: fullPayload(), tick: 0 });
    return persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload: fullPayload(), tick: 0 });
  };

  const a = drive(createActorPersona({ clock: () => "fixed", seed: 7 }));
  const b = drive(createActorPersona({ clock: () => "fixed", seed: 7 }));

  assert.ok(a.actions.length > 0, "precondition: the drive must produce proposals");
  assert.deepEqual(shape(b.actions), shape(a.actions), "same seed + same full payload must give the same proposals");
  assert.equal(b.state, a.state);
});

test("CR.6 characterization: a full-payload run produces a stable action stream", async () => {
  const { createRuntime } = await import("../../../packages/runtime/src/runner/runtime.js");
  const { createCore } = await import("../../../packages/core-ts/src/index.ts");
  const simConfig = JSON.parse(readFileSync(resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-mvp-grid.json"), "utf8"));
  const initialState = JSON.parse(readFileSync(resolve(ROOT, "tests/fixtures/artifacts/initial-state-artifact-v1-mvp-actor.json"), "utf8"));

  const runOnce = async () => {
    const rt = createRuntime({ core: createCore(), adapters: {} });
    await rt.init({ seed: 0, simConfig, initialState, runId: "run_cr6_char" });
    for (let i = 0; i < 6; i += 1) await rt.step();
    return rt.getTickFrames()
      .filter((f) => f.phaseDetail === "apply")
      .map((f) => (f.acceptedActions || []).map((a) => `${a.kind}:${a.actorId}`).join("|"));
  };

  const first = await runOnce();
  const second = await runOnce();
  assert.ok(first.some((row) => row.length > 0), "the run must accept real actions, not just empty frames");
  assert.deepEqual(second, first, "two identical runs must produce an identical action stream");
});

// ---------------------------------------------------------------------------
// B · The carry-over being removed
//
// Recorded as its own test because it IS a behavior change. It is confined to
// direct callers: the runner always supplies these fields, which is why the
// whole-suite probe found zero runner-originated fallbacks.
// ---------------------------------------------------------------------------

test("CR.6: a propose no longer inherits an earlier advance's observation", async () => {
  const { createActorPersona, TickPhases } = await loadActor();

  const persona = createActorPersona({ clock: () => "fixed", seed: 7 });
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload: fullPayload(), tick: 0 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload: fullPayload(), tick: 0 });

  // Withholding the observation. Before CR.6 the closure supplied the earlier
  // one and this still proposed movement; the decision is now a function of the
  // payload the Actor was actually handed.
  const result = persona.advance({
    phase: TickPhases.DECIDE,
    event: "propose",
    payload: { actorId: "actor_1" },
    tick: 0,
  });

  assert.deepEqual(result.actions, [], "a propose with no observation in its payload proposes nothing");
});

// TEETH NOTE (verified by perturbation, 2026-07-31): unlike the test above, this
// one does NOT detect a reintroduced cache — restoring the pre-CR.6 fallbacks
// leaves it green, because both Actors are fed full payloads and so agree either
// way. It is a property assertion, not a change detector. The detector is the
// starved-propose test above, which was confirmed to FAIL once the fallbacks were
// put back inside resolveObservation/resolveBaseTiles (the exact place they lived).
test("CR.6: an Actor with history and one without decide identically from the same state", async () => {
  const { createActorPersona, TickPhases } = await loadActor();

  // `primed` has been driven through a full earlier tick; `fresh` has not. Both
  // are in the same FSM state, so the same payload must give the same decision —
  // which holds only if nothing decision-relevant survives outside view().
  const primed = createActorPersona({ clock: () => "fixed", seed: 7 });
  primed.advance({ phase: TickPhases.OBSERVE, event: "observe", payload: fullPayload(0), tick: 0 });
  primed.advance({ phase: TickPhases.DECIDE, event: "decide", payload: fullPayload(0), tick: 0 });
  primed.advance({ phase: TickPhases.DECIDE, event: "propose", payload: fullPayload(0), tick: 0 });
  primed.advance({ phase: TickPhases.DECIDE, event: "cooldown", payload: fullPayload(0), tick: 0 });
  primed.advance({ phase: TickPhases.OBSERVE, event: "observe", payload: fullPayload(1), tick: 1 });
  primed.advance({ phase: TickPhases.DECIDE, event: "decide", payload: fullPayload(1), tick: 1 });

  const fresh = createActorPersona({ clock: () => "fixed", seed: 7 });
  fresh.advance({ phase: TickPhases.OBSERVE, event: "observe", payload: fullPayload(1), tick: 1 });
  fresh.advance({ phase: TickPhases.DECIDE, event: "decide", payload: fullPayload(1), tick: 1 });

  assert.equal(primed.view().state, fresh.view().state, "precondition: both must be in the same state");

  const fromPrimed = primed.advance({ phase: TickPhases.DECIDE, event: "propose", payload: fullPayload(1), tick: 1 });
  const fromFresh = fresh.advance({ phase: TickPhases.DECIDE, event: "propose", payload: fullPayload(1), tick: 1 });

  assert.ok(fromFresh.actions.length > 0, "precondition: the propose must produce real proposals");
  assert.deepEqual(
    shape(fromPrimed.actions),
    shape(fromFresh.actions),
    "an Actor with history and one without, in the same state, must decide identically — "
      + "if they differ, decision-relevant state is living outside view()",
  );
});

/**
 * ## TODO: Test Permutations
 *
 * - full-payload equivalence across every ActorStates value
 * - propose with observation present but baseTiles withheld, and vice versa
 * - affinityEffects supplied on one advance and withheld on the next
 * - multi-actor payloads where actorId selects a different actor each advance
 * - seeded random-move proposals: same seed + same payload across many ticks
 */
