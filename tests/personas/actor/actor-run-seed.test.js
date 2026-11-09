/**
 * #791 — the Actor's seeded draws use the run's seed. `resolveActorRandomSeed` read the actor's own
 * motivation seed, then `payload.seed`, then the persona seed, and ended at 0; the runtime never
 * put the run seed on the payload, so every unnamed draw used seed 0 whatever the level's seed was.
 */
const assert = require("node:assert/strict");

const HELPERS = "../../../packages/runtime/src/personas/actor/proposal-helpers.js";

test("a draw with no seed of its own uses the run seed from simConfig", async () => {
  const { resolveActorRandomSeed, hashRandomInputs } = await import(HELPERS);
  const view = { actors: [{ id: "a1" }] };
  assert.equal(resolveActorRandomSeed(view, "a1", { simConfig: { seed: 7 } }, undefined), 7);
  assert.equal(resolveActorRandomSeed(view, "a1", { simConfig: { seed: 8 } }, undefined), 8);
  // Different run seeds now give different draws for the same actor and tick.
  assert.notEqual(hashRandomInputs(7, "a1", 3), hashRandomInputs(8, "a1", 3));
});

test("the more specific seeds still win, and no seed at all is still 0", async () => {
  const { resolveActorRandomSeed } = await import(HELPERS);
  const simConfig = { seed: 7 };
  assert.equal(resolveActorRandomSeed({ actors: [{ id: "a1", motivation: { seed: 3 } }] }, "a1", { simConfig }, 9), 3, "the actor's own motivation seed");
  assert.equal(resolveActorRandomSeed({ actors: [{ id: "a1" }] }, "a1", { seed: 5, simConfig }, 9), 5, "payload.seed");
  assert.equal(resolveActorRandomSeed({ actors: [{ id: "a1" }] }, "a1", { simConfig: {} }, 9), 9, "the persona seed over nothing");
  assert.equal(resolveActorRandomSeed({ actors: [{ id: "a1" }] }, "a1", {}, undefined), 0, "no seed anywhere");
});
