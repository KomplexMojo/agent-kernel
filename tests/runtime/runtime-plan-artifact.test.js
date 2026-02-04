const test = require("node:test");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const runtimeModule = moduleUrl("packages/runtime/src/runner/runtime.js");

const script = `
import assert from "node:assert/strict";
import { createRuntime } from ${JSON.stringify(runtimeModule)};

const core = {
  init() {},
  applyAction() {},
  getCounter() { return 0; },
  getEffectCount() { return 0; },
  getEffectKind() { return 0; },
  getEffectValue() { return 0; },
  clearEffects() {},
};

const intentEnvelope = {
  schema: "agent-kernel/IntentEnvelope",
  schemaVersion: 1,
  meta: {
    id: "intent_demo",
    runId: "run_demo",
    createdAt: "2025-01-01T00:00:00.000Z",
    producedBy: "test",
  },
  source: "test",
  intent: {
    goal: "Find the exit",
    tags: ["demo"],
  },
};

const runtime = createRuntime({ core, adapters: {} });
await runtime.init({ seed: 0, runId: "run_demo", intentEnvelope });

await runtime.step();
await runtime.step();
await runtime.step();

const frames = runtime.getTickFrames();
const planFrames = frames.filter((frame) => Array.isArray(frame.personaArtifacts)
  && frame.personaArtifacts.some((artifact) => artifact?.schema === "agent-kernel/PlanArtifact"));
assert.ok(planFrames.length > 0, "Expected a plan artifact in tick frames");
const planArtifact = planFrames[0].personaArtifacts.find((artifact) => artifact?.schema === "agent-kernel/PlanArtifact");
assert.equal(planArtifact.intentRef.id, "intent_demo");

const summarizeFrames = frames.filter((frame) => frame.phaseDetail === "summarize");
const last = summarizeFrames[summarizeFrames.length - 1];
assert.equal(last.personaViews.orchestrator.state, "running");
`;

test("runtime emits plan artifacts and orchestrator starts from director output", () => {
  runEsm(script);
});
