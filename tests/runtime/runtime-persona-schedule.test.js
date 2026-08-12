const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");

test("runtime drives all personas via the FSM schedule", async () => {
  const { createRuntime } = await import(
    "../../packages/runtime/src/runner/runtime.js"
  );
  const { createCore } = await import(
    "../../packages/core-ts/src/index.ts"
  );

  const core = createCore();

  const simConfig = JSON.parse(readFileSync(resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-mvp-grid.json"), "utf8"));
  const initialState = JSON.parse(readFileSync(resolve(ROOT, "tests/fixtures/artifacts/initial-state-artifact-v1-mvp-actor.json"), "utf8"));
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
  assert.equal(views.director.state, "ready");
  assert.ok(["idle", "monitoring", "rebalancing"].includes(views.allocator.state));
  assert.equal(views.moderator.state, "ticking");
  assert.equal(views.configurator.state, "configured");
});
