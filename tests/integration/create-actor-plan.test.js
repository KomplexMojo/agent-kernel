// #721: `agon create --actors llm` — the model casts the level by recipe from the author's text. Its
// specs go through the spec parser like typed ones, so an unknown recipe is refused, never invented.
// The recipes configure actors; the seat prompt never sees them. Fixture replies only, no live model.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const AGON_CLI = join(ROOT, "packages/adapters-cli/src/cli/agon.mjs");
const TEXT = "Create a scenario with a shadowblade delver in a dungeon full of lantern-bearers.";

async function create(payload) {
  const { buildArgv } = await import("../../packages/adapters-cli/src/mcp/tools/shared.mjs");
  const { authoringSpec } = await import("../../packages/adapters-cli/src/mcp/tools/authoring.mjs");
  const outDir = mkdtempSync(join(tmpdir(), "agon-actor-plan-"));
  try {
    const result = spawnSync(process.execPath, [AGON_CLI, "create",
      ...buildArgv({ ...payload, outDir, runId: "actor_plan_probe", createdAt: "2026-11-04T00:00:00.000Z" }, authoringSpec),
    ], { cwd: ROOT, encoding: "utf8", env: { ...process.env, AGON_LLM_LIVE: "" } });
    return {
      status: result.status,
      output: `${result.stderr || ""}${result.stdout || ""}`,
      summary: result.status === 0 ? JSON.parse(result.stdout.trim().split("\n").pop()) : null,
      initialState: result.status === 0 ? JSON.parse(readFileSync(join(outDir, "initial-state.json"), "utf8")) : null,
    };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

const level = { text: TEXT, room: ["size=medium;count=3"], budgetTokens: 5000 };

test("a shadowblade delver among lantern-bearers resolves to recipe specs through a recorded reply", async () => {
  const result = await create({ ...level, actors: "llm", actorFixture: join(ROOT, "tests/fixtures/llm/actor-plan-shadowblade.json") });
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.summary.actorPlan, { decidedBy: "llm", model: result.summary.actorPlan.model,
    delvers: ["recipe=shadowblade;motivation=user_controlled"], wardens: ["recipe=lantern-bearer;count=4"] });
  const actors = result.initialState.actors;
  const keys = (actor) => actor.affinities.map((entry) => `${entry.kind}:${entry.expression}`).sort();
  const delver = actors.find((actor) => actor.motivations?.includes("user_controlled"));
  assert.deepEqual(keys(delver), ["dark:emit", "fire:push", "light:emit"], "the shadowblade's kit");
  const wardens = actors.filter((actor) => actor.id.includes("warden"));
  assert.equal(wardens.length, 4, "a dungeon full of them: the four the reply asked for");
  assert.ok(wardens.every((warden) => keys(warden).join() === "light:emit,light:pull"),
    "lantern-bearers, trimmed to a warden's two slots");
});

test("a recipe the catalogue does not have is refused, not invented", async () => {
  const result = await create({ ...level, actors: "llm", actorFixture: join(ROOT, "tests/fixtures/llm/actor-plan-invented.json") });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /unknown recipe "necromancer" \(known: shadowblade,/);
});

test("--actors llm with no model is an error, and it cannot share a fixture with --tactic llm", async () => {
  const offline = await create({ ...level, actors: "llm" });
  assert.notEqual(offline.status, 0);
  assert.match(offline.output, /--actors llm needs a model: pass --fixture or set AGON_LLM_LIVE=1/);
  const both = await create({ ...level, actors: "llm", tactics: ["llm"], actorFixture: join(ROOT, "tests/fixtures/llm/actor-plan-shadowblade.json") });
  assert.match(both.output, /--actors llm and --tactic llm would share one --fixture/);
});

test("the prompt lists every recipe with its cost and asks for specs; the reply reader takes strings or objects", async () => {
  const { buildActorPlanPrompt, readActorPlanResponse } = await import("../../packages/runtime/src/personas/orchestrator/persona.js");
  const { createRecipeCatalogue } = await import("../../packages/runtime/src/commands/recipe-catalogue.js");
  const catalogue = createRecipeCatalogue();
  const prompt = buildActorPlanPrompt({ text: TEXT, budgetTokens: 5000, recipes: catalogue.list({ kind: "config" }), strategies: catalogue.list({ kind: "strategy" }) });
  assert.match(prompt, /Description: Create a scenario with a shadowblade delver/);
  assert.match(prompt, /- shadowblade: .*delver 391 t, warden 328 t/);
  assert.match(prompt, /- kite: Kite \(attacking, exploring\)/);
  assert.match(prompt, /Reply with JSON only: \{"delvers":\["<spec>"\],"wardens":\["<spec>"\]\}/);
  assert.deepEqual(readActorPlanResponse({ response: "{\"delvers\":[{\"recipe\":\"tank\",\"motivation\":[\"user_controlled\"],\"strategyRecipe\":\"break-off\"}]}" }),
    { delvers: ["recipe=tank;motivation=user_controlled;strategy-recipe=break-off"], wardens: [] });
  assert.deepEqual(readActorPlanResponse({ response: "{\"wardens\":[{\"spell\":\"x\"}]}" }).errors, ["wardens[0] has unknown field spell"]);
  assert.deepEqual(readActorPlanResponse({ response: "{}" }).errors, ["the reply names no delvers or wardens"]);
});

// ## TODO: Test Permutations
// - a reply mixing typed --delver with planned wardens; a strategy-recipe= in a planned spec.
// - a reply whose spec clashes motivations with its strategy recipe is refused naming both.
