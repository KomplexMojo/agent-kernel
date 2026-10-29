/**
 * #557: the phone app builds a level from `ak create` arguments by `ak create`'s own code
 * (runtime `authorLevel`), with object placement answered from what z3 decided when `ak create`
 * ran (`AK_SOLVER_RECORD`, replayed by adapters-web's recorded-answers adapter). So a level built
 * on the phone, with or without a configured character, is byte for byte the level
 * `playtest.sh` builds in the terminal.
 */
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const ROOT = join(__dirname, "../..");
const AK = join(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const CREATED_AT = "2026-10-18T00:00:00.000Z";
// As written to disk: a key holding undefined is not part of a file.
const asWritten = (artifact) => JSON.parse(JSON.stringify(artifact));

async function load() {
  const playtest = await import("../../scripts/game/playtest.mjs");
  const { authorLevel } = await import("../../packages/runtime/src/commands/author-level.js");
  const { createRecordedSolverAdapter } = await import("../../packages/adapters-web/src/adapters/solver-recorded/index.js");
  return { ...playtest, authorLevel, createRecordedSolverAdapter };
}

/** `ak create` with z3 and its answers recorded; returns the files it wrote and the answers. */
function akCreate(dir, argv) {
  mkdirSync(dir, { recursive: true });
  const answersPath = join(dir, "answers.jsonl");
  const result = spawnSync(process.execPath, [AK, "create", ...argv, "--out-dir", join(dir, "level")], {
    cwd: ROOT, encoding: "utf8", env: { ...process.env, AK_SOLVER_RECORD: answersPath },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const read = (name) => JSON.parse(readFileSync(join(dir, "level", name), "utf8"));
  const answers = existsSync(answersPath)
    ? readFileSync(answersPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];
  return { simConfig: read("sim-config.json"), initialState: read("initial-state.json"), answers };
}

// `fields` places its traps with z3, so without the recorded answers the browser would differ.
for (const id of ["first-look", "fields"]) {
  test(`${id}: the browser build matches ak create, as written and with a configured character`, async () => {
    const { loadPlaytestScenarios, createArgs, playerDelverSpec, authorLevel, createRecordedSolverAdapter } = await load();
    const scenario = loadPlaytestScenarios().scenarios.find((entry) => entry.id === id);
    const dir = mkdtempSync(join(tmpdir(), "author-level-"));
    try {
      const written = akCreate(join(dir, "default"), createArgs(scenario, 1, CREATED_AT));
      assert.ok(id !== "fields" || written.answers.length > 0, "fields asks the solver, so an answer is recorded");
      const adapter = createRecordedSolverAdapter(written.answers);
      const { buildResult } = await authorLevel(createArgs(scenario, 1, CREATED_AT), { adapter });
      assert.deepEqual(asWritten(buildResult.simConfig), written.simConfig);
      assert.deepEqual(asWritten(buildResult.initialState), written.initialState);

      const character = playerDelverSpec(scenario, 1).replace(/mana:(\d+)/, (_, max) => `mana:${Number(max) + 5}`);
      const terminal = akCreate(join(dir, "custom"), createArgs(scenario, 1, CREATED_AT, undefined, character));
      const phone = await authorLevel(createArgs(scenario, 1, CREATED_AT, undefined, character), { adapter: createRecordedSolverAdapter(written.answers) });
      assert.deepEqual(asWritten(phone.buildResult.simConfig), terminal.simConfig, "the default level's answers settle the custom level's placement");
      assert.deepEqual(asWritten(phone.buildResult.initialState), terminal.initialState);
      assert.ok(phone.buildResult.solverDecisions.every((decision) => decision.reason !== "no_recorded_answer"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
}

// 2026-10-29: minions. A delver's minions start beside it, seated as delvers are, so they pose no
// placement question: the level's own recorded answers build it, priced as the sheet priced it.
for (const id of ["first-look", "fields"]) test(`${id} with minions: the browser build matches ak create from the level's own answers, and the sheet's total is the delver share's spend`, async () => {
  const { loadPlaytestScenarios, createArgs, playerDelverSpec, authorLevel, createRecordedSolverAdapter } = await load();
  const { createCharacterSheet } = await import("../../packages/runtime/src/runner/character-sheet.js");
  const scenario = loadPlaytestScenarios().scenarios.find((entry) => entry.id === id);
  const dir = mkdtempSync(join(tmpdir(), "author-level-minions-"));
  try {
    const recorded = akCreate(join(dir, "default"), createArgs(scenario, 1, CREATED_AT));
    const character = playerDelverSpec(scenario, 1).replace(/mana:(\d+)/, (_, max) => `mana:${Number(max) + 5}`)
      .replace("motivation=user_controlled", "motivation=user_controlled;minions=shield+striker");
    const terminal = akCreate(join(dir, "picked"), createArgs(scenario, 1, CREATED_AT, undefined, character));
    const phone = await authorLevel(createArgs(scenario, 1, CREATED_AT, undefined, character), { adapter: createRecordedSolverAdapter(recorded.answers) });
    assert.deepEqual(asWritten(phone.buildResult.simConfig), terminal.simConfig);
    assert.deepEqual(asWritten(phone.buildResult.initialState), terminal.initialState);
    const minions = terminal.initialState.actors.filter((actor) => actor.id.startsWith("hero-1_minion_"));
    assert.equal(minions.length, 2);
    assert.ok(minions.every((actor) => actor.motivations.includes("escorting") && !actor.motivations.includes("user_controlled")));
    const hero = terminal.initialState.actors.find((actor) => actor.id === "hero-1");
    assert.ok(minions.every((actor) => Math.max(Math.abs(actor.position.x - hero.position.x), Math.abs(actor.position.y - hero.position.y)) <= 2), "they start beside you");
    const receipt = phone.buildResult.budgetReceipt;
    const delverPool = receipt.poolStatuses.find((pool) => pool.id === "delver");
    const sheet = createCharacterSheet({ spec: character, budgetTokens: delverPool.capTokens });
    assert.equal(sheet.view().total, delverPool.spentTokens, "the sheet prices the minions as the build does");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 90_000);

test("a question with no recorded answer is deferred: the fallback places, or a level that needs the solver is refused", async () => {
  const { loadPlaytestScenarios, createArgs, authorLevel, createRecordedSolverAdapter } = await load();
  const scenario = (id) => loadPlaytestScenarios().scenarios.find((entry) => entry.id === id);
  const { buildResult } = await authorLevel(createArgs(scenario("first-look"), 1, CREATED_AT), { adapter: createRecordedSolverAdapter([]) });
  assert.ok(buildResult.solverDecisions.some((decision) => decision.decision === "fallback" && decision.reason === "no_recorded_answer"));
  // A minefield's placement constraints need the solver, so with no answer the build stops rather than guess.
  await assert.rejects(
    authorLevel(createArgs(scenario("fields"), 1, CREATED_AT), { adapter: createRecordedSolverAdapter([]) }),
    /placement constraints need the solver, which answered deferred \(no_recorded_answer\)/,
  );
});

test("authorLevel reads no clock, id or randomness: a run without --run-id is refused", async () => {
  const { authorLevel, createRecordedSolverAdapter } = await load();
  await assert.rejects(
    authorLevel(["--created-at", CREATED_AT, "--room", "size=small;count=1", "--delver", "count=1;motivation=exploring"], { adapter: createRecordedSolverAdapter([]) }),
    /unnamed run is not available here/,
  );
});
