// #396: `ak create --tactic` / `ak_create { tactics }` carry a tactic list into the plan and the
// BuildSpec. Tactics are compiled in later steps, so for now the create result reports each one as
// recorded but not applied, and names the build seed so the level can be rebuilt exactly.

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

test("ak_create tactics reach the BuildSpec and are reported as recorded, not applied", async () => {
  const result = await create({ ...level, tactics: ["ambush;guards=2", "retinue"], seed: 7 });
  assert.equal(result.status, 0, result.output);
  const tactics = [{ tactic: "ambush", params: { guards: 2 } }, { tactic: "retinue" }];
  assert.deepEqual(result.spec.plan.hints.tactics, tactics);
  assert.deepEqual(result.summary.tactics, tactics);
  assert.equal(result.summary.seed, 7);
  assert.equal(result.spec.configurator.inputs.levelGen.seed, 7);
  assert.deepEqual(result.summary.placementReport.map(({ tactic, applied }) => [tactic, applied]),
    [["ambush", false], ["retinue", false]]);
  assert.match(result.summary.placementReport[0].note, /not applied/);
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
  assert.match(unknown.output, /unknown tactic "flank".*ambush, retinue/);
  const cli = spawnSync(process.execPath, [AK_CLI, "create", ...["--room", "size=small;count=1", "--seed", "-3"]],
    { cwd: ROOT, encoding: "utf8" });
  assert.notEqual(cli.status, 0);
  assert.match(`${cli.stderr}${cli.stdout}`, /--seed/);
});

// ## TODO: Test Permutations
// - `ak configure --tactic` carries the same list
// - --dry-run with a tactic still validates the tactic list
// - a tactic param that is a word stays a string in the plan
