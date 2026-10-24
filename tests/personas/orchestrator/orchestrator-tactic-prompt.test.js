/**
 * #402 — the Orchestrator's prompt contract for an LLM-authored tactic plan, and the
 * Configurator's check of a plan it didn't author. No model is called.
 */
const assert = require("node:assert/strict");

test("the tactic prompt names the level, the catalogue and the reply shape", async () => {
  const { buildTacticPlanPrompt } = await import("../../../packages/runtime/src/personas/orchestrator/controller.js");
  const prompt = buildTacticPlanPrompt({ wardens: 2, resources: 1, rooms: 3, budgetTokens: 900 });
  for (const part of ["2 warden(s)", "1 resource(s)", "budget 900", "ambush", "retinue", "minefield", "\"tactics\""]) {
    assert.ok(prompt.includes(part), part);
  }
});

test("a reply reads into raw tactic entries; no text, no list or an empty list are reasons", async () => {
  const { readTacticPlanResponse } = await import("../../../packages/runtime/src/personas/orchestrator/controller.js");
  assert.deepEqual(readTacticPlanResponse({ response: "```json\n{\"tactics\":[{\"tactic\":\"retinue\"}]}\n```" }),
    { tactics: [{ tactic: "retinue" }] });
  assert.deepEqual(readTacticPlanResponse("{\"tactics\":[{\"tactic\":\"minefield\"}]}"), { tactics: [{ tactic: "minefield" }] });
  assert.match(readTacticPlanResponse({}).errors[0], /no text/);
  assert.match(readTacticPlanResponse({ response: "{\"plan\":1}" }).errors[0], /no "tactics"/);
  assert.match(readTacticPlanResponse({ response: "{\"tactics\":[]}" }).errors[0], /empty/);
});

test("the Configurator checks params and the wardens and resources a plan claims", async () => {
  const { createConfiguratorPersona } = await import("../../../packages/runtime/src/personas/configurator/controller.js");
  const configurator = createConfiguratorPersona({ clock: () => "2026-10-24T00:00:00.000Z" });
  const counts = { wardens: 2, resources: 1 };
  assert.deepEqual(configurator.validateTactics([{ tactic: "retinue", params: { size: 2 } }, { tactic: "ambush", params: { guards: 1 } }], counts), []);
  assert.match(configurator.validateTactics([{ tactic: "ambush", params: { guards: 2 } }, { tactic: "retinue" }], counts).join(";"), /needs 3 warden/);
  assert.match(configurator.validateTactics([{ tactic: "ambush", params: { guards: 1, resources: 2 } }], counts).join(";"), /needs 2 resource/);
  assert.match(configurator.validateTactics([{ tactic: "minefield", params: { range: 0 } }], counts).join(";"), /range/);
  assert.match(configurator.validateTactics([{ tactic: "retinue", params: { mood: 1 } }], counts).join(";"), /unknown param mood/);
  assert.deepEqual(configurator.validateTactics([], counts), ["no tactics"]);
});
