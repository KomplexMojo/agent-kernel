/**
 * `ak run --actor` adds an actor to a unified level. Core setup refuses a mover
 * with no authored move cost, so the override must assemble one (#211).
 */
"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const read = (name) => JSON.parse(readFileSync(resolve(ROOT, "tests/fixtures/artifacts", name), "utf8"));

test("an added delver gets a movement stamina cost and the run initializes", async () => {
  const [{ applyActorOverrides }, { createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/commands/run-helpers.js"),
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const simConfig = read("sim-config-artifact-v1-unified-run.json");
  const initialState = read("initial-state-artifact-v1-unified-run.json");
  const existing = { ...simConfig.actionCosts.movementStamina };

  applyActorOverrides(initialState, simConfig, { actorSpecs: ["actor_probe,1,2,delver"] });

  assert.equal(Number.isSafeInteger(simConfig.actionCosts.movementStamina.actor_probe), true);
  for (const [id, cost] of Object.entries(existing)) {
    assert.equal(simConfig.actionCosts.movementStamina[id], cost, `${id} keeps its authored cost`);
  }
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState });
  assert.ok(runtime.getActorSnapshot().actors.some((actor) => actor.id === "actor_probe"));
});

test("a barrier added by override needs no move cost", async () => {
  const { applyActorOverrides } = await import("../../packages/runtime/src/commands/run-helpers.js");
  const simConfig = read("sim-config-artifact-v1-unified-run.json");
  const initialState = read("initial-state-artifact-v1-unified-run.json");
  applyActorOverrides(initialState, simConfig, { actorSpecs: ["barrier_1_3,1,3,barrier"] });
  assert.equal(Object.hasOwn(simConfig.actionCosts.movementStamina, "barrier_1_3"), false);
});

// ## TODO: Test Permutations
// - overriding an existing actor's position keeps its move cost unchanged
// - a warden added by override gets the default cost
