const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readdirSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { normalizeToolArgs, classifyExecutionOutcome, REPO_ROOT, AK_CLI } = require(
  "../../tools/remote-ollama-control/scripts/lib/ak-runner",
);

// The corpus this test replays. See tests/fixtures/benchmark-failures/README.md for how it was
// harvested and tools/benchmark/extract-benchmark-failure-fixtures.mjs for the extraction itself.
const FIXTURE_DIR = join(__dirname, "../fixtures/benchmark-failures");

function loadFixtures() {
  return readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith(".json") && name !== "index.json")
    .map((name) => JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")));
}

// Mirrors the tail of runScenario() in ak-runner.js: normalize, inject the scenario-controlled
// budget (never the model's own guess), build argv via the shared MCP translation layer, and run
// the real CLI. No LLM, no network, no GPU.
async function replay(fixture) {
  const { buildArgv } = await import("../../packages/adapters-cli/src/mcp/tools/shared.mjs");
  const { authoringSpec } = await import("../../packages/adapters-cli/src/mcp/tools/authoring.mjs");

  const outDir = mkdtempSync(join(tmpdir(), `ak-benchmark-failure-${fixture.id}-`));
  try {
    const constrained = fixture.scenarioBudget != null;
    const normalizedArgs = normalizeToolArgs({
      ...fixture.toolArgs,
      budgetTokens: constrained ? fixture.scenarioBudget : undefined,
      outDir,
      runId: fixture.id,
      emitIntermediates: true,
    });
    if (!constrained) delete normalizedArgs.budgetTokens;

    const cliArgs = buildArgv(normalizedArgs, authoringSpec);
    const result = spawnSync(process.execPath, [AK_CLI, "create", ...cliArgs], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });

    const observed = classifyExecutionOutcome({
      toolCallProduced: true,
      execResult: {
        succeeded: result.status === 0,
        timedOut: result.status === null,
        stdout: result.stdout || "",
        stderr: result.stderr || "",
      },
    });
    return { observed, detail: `${result.stderr || ""}\n${result.stdout || ""}`.trim() };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

const fixtures = loadFixtures();

test("the harvested corpus covers every non-success attempt in the reference run", () => {
  const index = JSON.parse(readFileSync(join(FIXTURE_DIR, "index.json"), "utf8"));
  const total = fixtures.reduce((sum, f) => sum + f.occurrences, 0);
  assert.equal(total, index.totalNonSuccessAttempts);
  assert.equal(fixtures.length, index.fixtures.length);
});

test("every not-replayable fixture genuinely has no toolArgs to replay", () => {
  const notReplayable = fixtures.filter((f) => f.disposition === "not-replayable");
  assert.ok(notReplayable.length >= 1, "expected at least one not-replayable fixture");
  for (const fixture of notReplayable) {
    assert.equal(fixture.toolArgs, null, `${fixture.id} is marked not-replayable but has toolArgs`);
  }
});

for (const fixture of fixtures) {
  if (fixture.disposition === "not-replayable") continue;

  if (fixture.disposition === "harness-defect") {
    // Intentionally red until the corresponding milestone (M3/M4/M5, see dispositionNote) fixes
    // it. A passing harness-defect fixture here is the perturbation proof that milestone is done.
    test(`${fixture.id} (harness-defect): ${fixture.dispositionNote}`, async () => {
      const { observed, detail } = await replay(fixture);
      assert.equal(
        observed, "success",
        `${fixture.id}: expected this to be accepted -- ${fixture.dispositionNote}\n${detail}`,
      );
    });
  } else {
    // model-error: the harness is correct to deny this. A regression guard -- if this ever starts
    // passing, either the harness got looser (verify that was intentional) or a genuine fix landed
    // and this fixture's disposition is stale and should move to harness-defect.
    test(`${fixture.id} (model-error): ${fixture.dispositionNote}`, async () => {
      const { observed, detail } = await replay(fixture);
      assert.equal(
        observed, fixture.observedOutcome,
        `${fixture.id}: expected the original denial to reproduce -- ${fixture.dispositionNote}\n${detail}`,
      );
    });
  }
}
