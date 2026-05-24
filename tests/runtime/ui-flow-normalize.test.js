const assert = require("node:assert/strict");

async function loadUiFlow() {
  return import("../../packages/runtime/src/commands/ui-flow.js");
}

test("normalizeBuildSpecForUi normalizes singleton authoring request fields", async () => {
  const { normalizeBuildSpecForUi } = await loadUiFlow();

  const input = {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: {
      id: "build_spec_ui_normalize",
      runId: "run_ui_normalize",
      createdAt: "2026-04-08T00:00:00.000Z",
      source: "ui-web",
    },
    intent: {
      goal: "Normalize authoring fields",
    },
    authoring: {
      objectKinds: "room",
      request: {
        schema: "agent-kernel/AgentCommandRequestArtifact",
        schemaVersion: 1,
        meta: {
          id: "agent_command_ui_normalize",
          runId: "run_ui_normalize",
          createdAt: "2026-04-08T00:00:00.000Z",
          producedBy: "test",
        },
        command: {
          action: "author",
          text: "author one room",
          source: "ui-web",
          taxonomyVersion: 1,
        },
        objects: {
          kind: "room",
          prompt: "one room",
          count: 1,
        },
        compilation: {
          rules: {
            kind: "room",
            compileTo: {
              target: "build_spec_plan",
              path: "plan.hints.cardSet",
            },
          },
        },
      },
    },
  };

  const normalized = normalizeBuildSpecForUi(input);

  assert.equal(normalized.changed, true);
  assert.deepEqual(normalized.spec.authoring.objectKinds, ["room"]);
  assert.equal(Array.isArray(normalized.spec.authoring.request.objects), true);
  assert.equal(Array.isArray(normalized.spec.authoring.request.compilation.rules), true);
  assert.equal(
    Array.isArray(normalized.spec.authoring.request.compilation.rules[0].compileTo),
    true,
  );
});
