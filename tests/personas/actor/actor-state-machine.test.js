const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

/**
 * P2.6 — the label assertions are gone; what the labels GATE is what is left.
 *
 * Charter §6: a test asserting only a state label is legacy and must be replaced,
 * not extended. This file used to assert `result.state === ActorStates[...]` and
 * `context.lastEvent === event` on every happy-path case — a *label changed*, which
 * is why "persona tests pass" never implied "personas decide". G1
 * (`persona-authority-registry.js`) asks the question those could not: does
 * production break without this persona? Ownership is answered there, not here.
 *
 * ALSO REMOVED: `context.updatedAt === "fixed"`. It was not label-only — it pinned
 * the injected clock — but `single-origin.test.js` forbids `new Date(` across the
 * whole personas directory, so a persona CANNOT mint a wall-clock timestamp. A
 * per-persona copy of a rule already enforced repo-wide by rule (not by list) is a
 * second origin, and this branch has paid for enough of those.
 *
 * WHAT SURVIVES, and why it is not a label:
 *   - the happy sequence is still DRIVEN, so a transition that stops being legal
 *     throws and fails here — walkability is proven without naming the states;
 *   - `lastProposalCount` is what the actor DID with the payload, not what it is called.
 *     Context is the persona's memory and is serialized into `personaViews`, which
 *     gates real behavior in `runtime-fsm.mjs`.
 *
 * ⚠️ THE COUNT CHECK IS ABSOLUTE, AND IT HAS TO BE. It was written first as the
 * relative form this file used to carry — `result.count === before.count` on the
 * `observe` case — and a perturbation proved that shape blind. Neutering the
 * preservation branch (`?? context.lastProposalCount` → `?? 0`) left every actor test
 * GREEN, because the fixture's `cooldown` case sits between the proposal and the
 * observe: by the time the assertion ran, the clobber had already corrupted BOTH
 * sides, and 0 === 0 agrees. A before/after comparison cannot see a defect that
 * damages the baseline it compares against. Tracking the expected count across the
 * whole sequence catches it on the cooldown case, where it actually happens.
 * ⇒ *Same family as the `emitRecord.telemetry || []` no-op: the assertion ran, it
 * just could not disagree.*
 */
const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/actor-transitions-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/actor-transitions-guards.json"), "utf8"));

test("actor state machine walks the happy path and accumulates proposal counts", async () => {
  const { createActorStateMachine } = await import(
    "../../../packages/runtime/src/personas/actor/state-machine.js"
  );

  const machine = createActorStateMachine({ initialState: happyFixture.initialState, clock: () => "fixed" });

  // The count a proposal earned, carried forward independently of the machine, so the
  // assertion has a baseline the machine cannot corrupt.
  let expectedProposalCount = 0;

  happyFixture.cases.forEach((entry) => {
    // advance() throws on an illegal transition, so driving the sequence is itself
    // the assertion that the happy path remains walkable.
    const result = machine.advance(entry.event, entry.payload);

    if (Array.isArray(entry.payload.proposals)) {
      expectedProposalCount = entry.payload.proposals.length;
    }
    if (entry.expectProposalCount !== undefined) {
      assert.equal(result.context.lastProposalCount, entry.expectProposalCount);
    }
    assert.equal(
      result.context.lastProposalCount,
      expectedProposalCount,
      `after "${entry.event}": a case carrying no proposals must leave the count a `
        + `previous proposal earned intact`,
    );
  });
});

test("actor state machine enforces guard and invalid transitions", async () => {
  const { createActorStateMachine } = await import(
    "../../../packages/runtime/src/personas/actor/state-machine.js"
  );

  const machine = createActorStateMachine({ initialState: guardFixture.initialState, clock: () => "fixed" });

  guardFixture.cases.forEach((entry) => {
    let threw = false;
    try {
      machine.advance(entry.event, entry.payload);
    } catch (err) {
      threw = true;
      assert.match(err.message, new RegExp(entry.expectError));
    }
    assert.equal(threw, true);
  });
});
