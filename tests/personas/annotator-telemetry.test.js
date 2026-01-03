const test = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const annotatorModule = moduleUrl("packages/runtime/src/personas/annotator/controller.mts");
const tickModule = moduleUrl("packages/runtime/src/personas/_shared/tick-state-machine.mts");
const fixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/persona-behavior-v1-annotator.json"), "utf8"));

const script = `
import assert from "node:assert/strict";
import { createAnnotatorPersona } from ${JSON.stringify(annotatorModule)};
import { TickPhases } from ${JSON.stringify(tickModule)};

const fixture = ${JSON.stringify(fixture)};
const persona = createAnnotatorPersona({ clock: () => "fixed" });

const observeResult = persona.advance({
  phase: TickPhases.EMIT,
  event: "observe",
  payload: { observations: fixture.annotator.observations, runId: fixture.annotator.runId },
  tick: 1
});
assert.equal(observeResult.state, "recording");

const summarizeResult = persona.advance({
  phase: TickPhases.SUMMARIZE,
  event: "summarize",
  payload: { observations: fixture.annotator.observations, runId: fixture.annotator.runId },
  tick: 1
});
assert.equal(summarizeResult.state, "summarizing");
assert.ok(summarizeResult.telemetry);
assert.ok(Array.isArray(summarizeResult.telemetry.records));
assert.equal(summarizeResult.telemetry.records.length, 1);
assert.equal(summarizeResult.telemetry.records[0].schema, "agent-kernel/TelemetryRecord");
assert.equal(summarizeResult.telemetry.records[0].meta.runId, "run-annotate");
assert.equal(summarizeResult.telemetry.records[0].data.effectCount, 2);
assert.ok(summarizeResult.telemetry.summary);
assert.equal(summarizeResult.telemetry.summary.schema, "agent-kernel/RunSummary");
assert.equal(summarizeResult.telemetry.summary.metrics.totalEffects, 2);
`;

test("annotator persona emits telemetry records and summaries from observations", () => {
  runEsm(script);
});
