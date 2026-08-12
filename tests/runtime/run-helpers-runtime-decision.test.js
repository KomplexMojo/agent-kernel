const assert = require("node:assert/strict");


test("run helpers summarize and compare runtime decisions from tick frames", async () => {const {
  collectRuntimeDecisionCaptureRecords,
  collectRuntimeDecisionRecords,
  compareFrameSummaries,
  compareRuntimeDecisionCaptureSummaries,
  compareRuntimeDecisionSummaries,
  summarizeFrame,
  summarizeRuntimeDecisionCaptures,
  summarizeRuntimeDecisions,
} = await import("../../packages/runtime/src/commands/run-helpers.js");

const expectedFrames = [
  {
    tick: 4,
    phase: "decide",
    phaseDetail: "decide",
    emittedEffects: [{ kind: "solver_request" }],
    fulfilledEffects: [{ status: "fulfilled" }],
    personaArtifacts: [{
      schema: "agent-kernel/CapturedInputArtifact",
      schemaVersion: 1,
      meta: { id: "capture_runtime_1" },
      source: { adapter: "llm" },
      payload: {
        requestEnvelope: {
          contract: "runtime-decision-v1",
          actor: { id: "boss_1" },
          decisionKind: "next_move",
        },
        responseParsed: {
          decision: {
            contract: "runtime-decision-v1",
            decisionKind: "next_move",
            selectedActionId: "move_east",
          },
        },
      },
    }],
    solverResults: [
      {
        decision: {
          contract: "runtime-decision-v1",
          decisionKind: "next_move",
          selectedActionId: "move_east",
          confidence: 0.9,
        },
        action: {
          actorId: "boss_1",
          tick: 4,
          kind: "move",
          params: { direction: "east", to: { x: 2, y: 1 } },
        },
      },
    ],
  },
];
const actualFrames = [
  {
    tick: 4,
    phase: "decide",
    phaseDetail: "decide",
    emittedEffects: [{ kind: "solver_request" }],
    fulfilledEffects: [{ status: "fulfilled" }],
    personaArtifacts: [{
      schema: "agent-kernel/CapturedInputArtifact",
      schemaVersion: 1,
      meta: { id: "capture_runtime_1" },
      source: { adapter: "llm" },
      payload: {
        requestEnvelope: {
          contract: "runtime-decision-v1",
          actor: { id: "boss_1" },
          decisionKind: "next_move",
        },
        responseParsed: {
          decision: {
            contract: "runtime-decision-v1",
            decisionKind: "next_move",
            selectedActionId: "wait_here",
          },
        },
      },
    }],
    solverResults: [
      {
        decision: {
          contract: "runtime-decision-v1",
          decisionKind: "next_move",
          selectedActionId: "wait_here",
          confidence: 0.2,
        },
        action: {
          actorId: "boss_1",
          tick: 4,
          kind: "wait",
          params: {},
        },
      },
    ],
  },
];

const expectedSummary = summarizeFrame(expectedFrames[0]);
assert.equal(expectedSummary.runtimeDecisions, 1);
assert.equal(expectedSummary.decisionDrivenActions, 1);

const decisionSummary = summarizeRuntimeDecisions(expectedFrames);
assert.equal(decisionSummary.total, 1);
assert.equal(decisionSummary.byActor.boss_1, 1);
assert.equal(decisionSummary.byActionKind.move, 1);
assert.equal(collectRuntimeDecisionRecords(expectedFrames)[0].selectedActionId, "move_east");

const captureSummary = summarizeRuntimeDecisionCaptures(expectedFrames);
assert.equal(captureSummary.total, 1);
assert.equal(captureSummary.byAdapter.llm, 1);
assert.equal(captureSummary.byActor.boss_1, 1);
assert.equal(captureSummary.withSelectedActionId, 1);
assert.equal(collectRuntimeDecisionCaptureRecords(expectedFrames)[0].selectedActionId, "move_east");

const matchingFrameComparison = compareFrameSummaries([expectedSummary], [summarizeFrame(expectedFrames[0])]);
assert.equal(matchingFrameComparison.match, true);

const decisionComparison = compareRuntimeDecisionSummaries(expectedFrames, actualFrames);
assert.equal(decisionComparison.match, false);
assert.equal(decisionComparison.mismatches, 1);
assert.equal(decisionComparison.firstMismatch.expected.selectedActionId, "move_east");
assert.equal(decisionComparison.firstMismatch.actual.selectedActionId, "wait_here");

const captureComparison = compareRuntimeDecisionCaptureSummaries(expectedFrames, actualFrames);
assert.equal(captureComparison.match, false);
assert.equal(captureComparison.mismatches, 1);
assert.equal(captureComparison.firstMismatch.expected.selectedActionId, "move_east");
assert.equal(captureComparison.firstMismatch.actual.selectedActionId, "wait_here");
});
