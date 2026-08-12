const assert = require("node:assert/strict");

test("adaptive workflow llm seams consume fixture model adapters", async () => {
  const { createLlmTestAdapter } = await import("../../packages/adapters-test/src/adapters/llm/index.js");
  const { runFlagshipLlmSeam } = await import("../../packages/runtime/src/adaptive-workflow/llm-seams.js");
  const adapter = createLlmTestAdapter();
  const prompt = "fixture objective";
  adapter.setResponse("fixture", prompt, { response: JSON.stringify({ rooms: [{ id: "r1" }], actors: [] }) });

  const result = await runFlagshipLlmSeam({
    adapter,
    model: "fixture",
    prompt,
    runId: "run_fixture_seam",
    clock: () => "2026-07-12T00:00:00.000Z",
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.rooms.length, 1);
  assert.equal(result.captures.length, 1);
});
