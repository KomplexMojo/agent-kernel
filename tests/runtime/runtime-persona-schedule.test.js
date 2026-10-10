const assert = require("node:assert/strict");

test("runtime drives all personas via the FSM schedule", async () => {
  const { createRuntime } = await import(
    "../../packages/runtime/src/runner/runtime.js"
  );
  const { createCore } = await import(
    "../../packages/core-ts/src/index.ts"
  );
  const { boxedTerrain, buildUnifiedArtifacts } = await import(
    "../fixtures/personas/unified-actor-runtime.mjs"
  );
  const width = 9;
  const height = 9;
  const terrain = boxedTerrain(width, height);
  terrain[width + 1] = "spawn";
  terrain[7 * width + 7] = "exit";
  const { simConfig, initialState } = buildUnifiedArtifacts({
    width,
    height,
    terrain,
    runId: "run_runtime_schedule",
    clock: "2025-01-01T00:00:00.000Z",
    actors: [{
      id: "actor_mvp",
      category: "delver",
      position: { x: 2, y: 1 },
      motivations: ["exploring"],
      vitals: { health: { current: 10, max: 10, regen: 0 } },
    }],
  });
  const intentEnvelope = {
    schema: "agent-kernel/IntentEnvelope",
    schemaVersion: 1,
    meta: {
      id: "intent_runtime_schedule",
      runId: "run_runtime_schedule",
      createdAt: "2025-01-01T00:00:00.000Z",
      producedBy: "test",
    },
    source: "test",
    intent: { goal: "Reach the exit", tags: ["runtime", "schedule"] },
  };

  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState, runId: "run_runtime_schedule", intentEnvelope });
  await runtime.step();
  await runtime.step();
  await runtime.step();
  await runtime.step();

  const frames = runtime.getTickFrames();
  const summarizeFrames = frames.filter((frame) => frame.phaseDetail === "summarize");
  const last = summarizeFrames[summarizeFrames.length - 1];
  assert.ok(last, "Expected a summarize frame");

  const views = last.personaViews;
  assert.equal(views.orchestrator.state, "running");
  // PX.5: this SimConfig already names its plan (planRef), so the run
  // consumes it and the Director does no build round. It used to report `ready` —
  // its completed-round state — with buildSpecCount 0 and planId null, while minting
  // a PlanArtifact mid-tick. The Orchestrator still reaches `running` above, now
  // because the SimConfig's planRef is evidence a plan exists rather than because
  // the Director produced one inside the run loop.
  assert.equal(views.director.state, "uninitialized");
  assert.ok(["idle", "monitoring", "rebalancing"].includes(views.allocator.state));
  assert.equal(views.moderator.state, "ticking");
  // PX.5 / Option A: the tick plane no longer drives the Configurator's build round.
  // It used to walk uninitialized -> pending_config -> configured -> locked on every
  // run without calling provideConfig/validate/lock, so `configured` here asserted a
  // state the persona had not earned — nothing read it except the code choosing the
  // next event. Configuration is a build-plane concern (charter rule 3), so on the
  // tick plane the Configurator now correctly stays put.
  assert.equal(views.configurator.state, "uninitialized");
});
// ## TODO: Test Permutations
// - leftover mvp-grid tiles still fail category storage at runtime.init
// - a run whose SimConfig omits planRef still leaves Configurator uninitialized on the tick plane
