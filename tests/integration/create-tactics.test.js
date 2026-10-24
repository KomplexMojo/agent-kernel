// #396: `ak create --tactic` / `ak_create { tactics }` carry a tactic list into the plan and the
// BuildSpec. The create result reports what was done with each tactic (#398 ambush, #400 retinue,
// #418 minefield) and names the build seed so the level can be rebuilt exactly.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const AK_CLI = join(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

async function create(payload) {
  const { buildArgv } = await import("../../packages/adapters-cli/src/mcp/tools/shared.mjs");
  const { authoringSpec } = await import("../../packages/adapters-cli/src/mcp/tools/authoring.mjs");
  const outDir = mkdtempSync(join(tmpdir(), "ak-tactic-"));
  try {
    const result = spawnSync(process.execPath, [
      AK_CLI, "create",
      ...buildArgv({ ...payload, outDir, runId: "tactic_probe", createdAt: "2026-10-18T00:00:00.000Z" }, authoringSpec),
    ], { cwd: ROOT, encoding: "utf8" });
    const read = (name) => JSON.parse(readFileSync(join(outDir, name), "utf8"));
    return {
      status: result.status,
      output: `${result.stderr || ""}${result.stdout || ""}`,
      summary: result.status === 0 ? JSON.parse(result.stdout.trim().split("\n").pop()) : null,
      spec: result.status === 0 ? read("spec.json") : null,
      initialState: result.status === 0 ? read("initial-state.json") : null,
    };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

const level = { room: ["size=medium;count=2"], warden: ["count=2;motivation=defending"] };

test("ak_create tactics reach the BuildSpec and each one is reported", async () => {
  const result = await create({ ...level, tactics: ["ambush;guards=1", "retinue;size=1"], seed: 7 });
  assert.equal(result.status, 0, result.output);
  const tactics = [{ tactic: "ambush", params: { guards: 1 } }, { tactic: "retinue", params: { size: 1 } }];
  assert.deepEqual(result.spec.plan.hints.tactics, tactics);
  assert.deepEqual(result.summary.tactics, tactics);
  assert.equal(result.summary.seed, 7);
  assert.equal(result.spec.configurator.inputs.levelGen.seed, 7);
  // #398 compiles ambush with the first warden; #400 gives the other a one-minion retinue.
  const tacticRows = result.summary.placementReport.filter((row) => row.tactic);
  assert.deepEqual(tacticRows.map(({ tactic, applied }) => [tactic, applied]), [["ambush", true], ["retinue", true]]);
  assert.equal(tacticRows[1].minions.length, 1);
  assert.ok(result.initialState.actors.some((actor) => actor.id === tacticRows[1].minions[0].id), "the minion is in the level");
});

test("a minefield needs no authored hazard: the tactic brings its own hazard share (#418)", async () => {
  const result = await create({ room: ["size=medium;count=3"], resource: ["permanenceMode=consumable;vital=health;delta=5"],
    delver: ["count=1;affinity=wind;motivation=exploring"], tactics: ["minefield;hazards=3"], seed: 4 });
  assert.equal(result.status, 0, result.output);
  const row = result.summary.placementReport.find((entry) => entry.tactic === "minefield");
  assert.equal(row.applied, true, row.note);
  assert.equal(row.hazards.length, 3);
  assert.ok(row.safeLine.length >= 2 && typeof row.room === "string", JSON.stringify(row.safeLine));
  for (const { id } of row.hazards) {
    assert.ok(result.initialState.actors.some((actor) => actor.id === id), `${id} is in the level`);
  }
});

test("the same tactics and seed rebuild the same level", async () => {
  const first = await create({ ...level, tactics: ["ambush"], seed: 11 });
  const second = await create({ ...level, tactics: ["ambush"], seed: 11 });
  assert.equal(first.status, 0, first.output);
  assert.deepEqual(second.initialState, first.initialState);
});

test("a tactic without a seed draws one and reports it", async () => {
  const result = await create({ ...level, tactics: ["retinue"] });
  assert.equal(result.status, 0, result.output);
  assert.ok(Number.isSafeInteger(result.summary.seed) && result.summary.seed >= 0, String(result.summary.seed));
  assert.equal(result.spec.configurator.inputs.levelGen.seed, result.summary.seed);
});

test("a build without tactics or a seed reports neither", async () => {
  const result = await create(level);
  assert.equal(result.status, 0, result.output);
  assert.equal("tactics" in result.summary, false);
  assert.equal("seed" in result.summary, false);
  assert.equal("tactics" in result.spec.plan.hints, false);
});

test("an unknown tactic or a bad seed is refused with a reason", async () => {
  const unknown = await create({ ...level, tactics: ["flank"] });
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.output, /unknown tactic "flank".*ambush, retinue, minefield/);
  const cli = spawnSync(process.execPath, [AK_CLI, "create", ...["--room", "size=small;count=1", "--seed", "-3"]],
    { cwd: ROOT, encoding: "utf8" });
  assert.notEqual(cli.status, 0);
  assert.match(`${cli.stderr}${cli.stdout}`, /--seed/);
});

// ## TODO: Test Permutations
// - `ak configure --tactic` carries the same list
// - --dry-run with a tactic still validates the tactic list
// - a tactic param that is a word stays a string in the plan

test("tactics [\"auto\"]: the Director picks the mix from the seed, recorded and rebuilt by --seed (#401)", async () => {
  const payload = { room: ["size=medium;count=3"], resource: ["permanenceMode=consumable;vital=health;delta=5"],
    warden: ["count=3;motivation=defending"], tactics: ["auto"], seed: 11 };
  const first = await create(payload);
  assert.equal(first.status, 0, first.output);
  const { createDirectorPersona } = await import("../../packages/runtime/src/personas/director/controller.js");
  const picked = createDirectorPersona({ clock: () => "2026-10-18T00:00:00.000Z" }).pickSeededTactics(11, { wardens: 3, resources: 1 });
  assert.deepEqual(first.summary.tactics, picked);
  assert.deepEqual(first.spec.plan.hints.tactics, picked);
  assert.equal(first.summary.seed, 11);
  // The recorded list, given back with the same seed, builds the same level.
  const again = await create({ ...payload, tactics: picked.map(({ tactic, params }) =>
    [tactic, ...Object.entries(params || {}).map(([k, v]) => `${k}=${v}`)].join(";")) });
  assert.equal(again.status, 0, again.output);
  assert.deepEqual(again.initialState, first.initialState);
});

test("tactics [\"auto\", ...]: auto stands alone (#401)", async () => {
  const result = await create({ ...level, tactics: ["auto", "retinue"], seed: 1 });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /auto.*can't be combined/);
});

// #402: `--tactic llm` — the model's plan, checked; any failure falls back to the seeded plan.
const llmLevel = { room: ["size=medium;count=3"], resource: ["permanenceMode=consumable;vital=health;delta=5"],
  warden: ["count=2;motivation=defending"], seed: 5 };

test("tactics [\"llm\"] with a recorded reply: the model's plan decides and is recorded (#402)", async () => {
  const result = await create({ ...llmLevel, tactics: ["llm"], tacticFixture: join(ROOT, "tests/fixtures/llm/tactic-plan-valid.json") });
  assert.equal(result.status, 0, result.output);
  const plan = [{ tactic: "retinue", params: { size: 2 } }, { tactic: "minefield", params: { hazards: 3 } }];
  assert.deepEqual(result.summary.tactics, plan);
  assert.equal(result.summary.tacticPlan.decidedBy, "llm");
  assert.deepEqual(result.summary.tacticPlan.response, plan);
  // Replay needs no model: the recorded list and seed rebuild the level.
  const replay = await create({ ...llmLevel, tactics: ["retinue;size=2", "minefield;hazards=3"] });
  assert.equal(replay.status, 0, replay.output);
  assert.deepEqual(replay.initialState, result.initialState);
});

test("tactics [\"llm\"] with an invalid reply or no model falls back to the seeded plan (#402)", async () => {
  const { createDirectorPersona } = await import("../../packages/runtime/src/personas/director/controller.js");
  const seeded = createDirectorPersona({ clock: () => "2026-10-18T00:00:00.000Z" }).pickSeededTactics(5, { wardens: 2, resources: 1 });
  const invalid = await create({ ...llmLevel, tactics: ["llm"], tacticFixture: join(ROOT, "tests/fixtures/llm/tactic-plan-invalid.json") });
  assert.equal(invalid.status, 0, invalid.output);
  assert.deepEqual(invalid.summary.tactics, seeded);
  assert.equal(invalid.summary.tacticPlan.decidedBy, "seeded");
  assert.match(invalid.summary.tacticPlan.reasons.join(";"), /unknown tactic "flank"/);
  assert.deepEqual(invalid.summary.tacticPlan.response, [{ tactic: "flank" }]);
  const offline = await create({ ...llmLevel, tactics: ["llm"] });
  assert.equal(offline.status, 0, offline.output);
  assert.deepEqual(offline.summary.tactics, seeded);
  assert.match(offline.summary.tacticPlan.reasons[0], /no model/);
});
