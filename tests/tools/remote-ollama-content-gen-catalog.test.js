const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const {
  CATALOG_DIR,
  canonicalJson,
  loadScenarioCatalog,
  loadScenarios,
} = require("../../tools/remote-ollama-control/scripts/lib/ak-scenarios");
const { scoreRun } = require("../../tools/remote-ollama-control/scripts/lib/ak-compare");

const EXPECTED_HASH = "6e5abc67edaaea2f1d2d1e06ce0e8d074b4e46e808f3a01bbcaf0a3c7efd4960";
const TIERS = ["simple", "affinity", "complex", "constrained"];
const REMOTE_CONTROL_ROOT = resolve(__dirname, "../../tools/remote-ollama-control");
const MAC_SCRIPT = join(REMOTE_CONTROL_ROOT, "scripts/remote-ollama-mac.js");
const BASELINE_GENERATOR = resolve(__dirname, "../../tools/benchmark/generate-baselines.mjs");
const BENCHMARK_VALIDATOR = resolve(__dirname, "../../tools/benchmark/validate-benchmark.mjs");

function copyCatalog() {
  const dir = mkdtempSync(join(tmpdir(), "ak-content-gen-catalog-"));
  for (const tier of TIERS) {
    cpSync(join(CATALOG_DIR, `${tier}.json`), join(dir, `${tier}.json`));
  }
  return dir;
}

function mutateCatalog(tier, mutator) {
  const dir = copyCatalog();
  const file = join(dir, `${tier}.json`);
  const document = JSON.parse(readFileSync(file, "utf8"));
  mutator(document);
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return dir;
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).reverse().map((key) => [key, reverseObjectKeys(value[key])]),
  );
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function scoringFixture() {
  const dir = mkdtempSync(join(tmpdir(), "ak-content-gen-score-"));
  const generatedDir = join(dir, "generated");
  const referenceDir = join(dir, "reference");
  mkdirSync(generatedDir, { recursive: true });
  mkdirSync(referenceDir, { recursive: true });
  const referenceCards = [
    { type: "room", count: 2, affinity: "dark" },
    { type: "delver", count: 1, affinity: "fire" },
  ];
  writeJson(join(generatedDir, "spec.json"), { plan: { hints: { cardSet: referenceCards } } });
  writeJson(join(generatedDir, "budget-receipt.json"), { totalCost: 120 });
  writeJson(join(referenceDir, "spec.json"), { plan: { hints: { cardSet: referenceCards } } });
  writeJson(join(referenceDir, "budget-receipt.json"), { totalCost: 100 });
  return {
    dir,
    generatedDir,
    referenceSpec: join(referenceDir, "spec.json"),
    referenceReceipt: join(referenceDir, "budget-receipt.json"),
    runResult: {
      toolCallProduced: true,
      execResult: { succeeded: true },
      outDir: generatedDir,
    },
    compactReference: {
      entityCounts: { delver: 1, room: 2 },
      affinitiesByType: { delver: ["fire"], room: ["dark"] },
      totalSpend: 100,
    },
  };
}

test("repository catalog owns 100 balanced content-generation scenarios", () => {
  const catalog = loadScenarioCatalog();
  const schema = JSON.parse(readFileSync(join(CATALOG_DIR, "catalog.schema.json"), "utf8"));

  assert.equal(schema.$id, "https://agent-kernel.local/schemas/content-gen-catalog-v1.json");
  assert.equal(catalog.schemaVersion, "agent-kernel-content-gen-catalog/v1");
  assert.equal(catalog.count, 100);
  assert.deepEqual(catalog.tierCounts, {
    simple: 25,
    affinity: 25,
    complex: 25,
    constrained: 25,
  });
  assert.equal(catalog.sha256, EXPECTED_HASH);
  assert.deepEqual(catalog.scenarios.map((scenario) => scenario.index),
    Array.from({ length: 100 }, (_, index) => index + 1));

  for (const scenario of catalog.scenarios) {
    assert.ok(scenario.title.length > 0);
    assert.ok(scenario.prompt.length > 0);
    assert.equal(scenario.payload.text, scenario.prompt);
    assert.equal(scenario.payload.runId, scenario.runId);
    assert.equal(scenario.payload.outDir, "$RUN_OUTPUT/create");
    assert.equal(scenario.legacyReferencePath.startsWith("Reference Artifacts/"), true);
  }

  const recoveredIds = [2, 9, 10, 16, 22, 37, 54];
  for (const index of recoveredIds) {
    const scenario = catalog.scenarios[index - 1];
    assert.ok(scenario.prompt.length > 0, `scenario ${index} prompt was not recovered`);
    assert.ok(scenario.payload, `scenario ${index} payload was not recovered`);
  }

  const scenario54 = catalog.scenarios[53];
  assert.equal(scenario54.title, "Create Mixed Motivation Encounter");
  assert.equal(scenario54.tier, "constrained");
  assert.equal(scenario54.budget, 600);
  assert.equal(scenario54.expectedOutcome, "budget_denied");
  assert.equal(scenario54.status, "denied");

  assert.deepEqual(
    [65, 81, 85, 90].map((index) => catalog.scenarios.find((scenario) => scenario.index === index)?.tier),
    ["simple", "affinity", "complex", "constrained"],
  );
});

test("scenario questions load without runtime vault paths", () => {
  const scenarios = loadScenarios();

  assert.equal(scenarios.length, 100);
  assert.equal(scenarios[0].prompt.length > 0, true);
  assert.equal(Object.hasOwn(scenarios[0], "artifactDir"), false);
});

test("content-gen dry run reports the repository scenario-set identity without a vault", () => {
  const result = spawnSync(process.execPath, [MAC_SCRIPT, "dry-run", "run-content-gen"], {
    cwd: REMOTE_CONTROL_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      LLM_AK_VAULT_DIR: "/definitely/not/a/real/agent-kernel-vault",
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.scenarios.length, 100);
  assert.deepEqual(output.scenarioSet, {
    count: 100,
    sha256: EXPECTED_HASH,
    tierCounts: { simple: 25, affinity: 25, complex: 25, constrained: 25 },
  });
  assert.equal(Object.hasOwn(output, "vaultDir"), false);
});

test("baseline generation consumes the canonical catalog instead of a duplicate case list", () => {
  const source = readFileSync(BASELINE_GENERATOR, "utf8");

  assert.match(source, /loadScenarioCatalog/);
  assert.doesNotMatch(source, /const cases\s*=\s*\[/);
});

test("direct parity validation consumes catalog outcomes instead of generated notes", () => {
  const source = readFileSync(BENCHMARK_VALIDATOR, "utf8");

  assert.match(source, /loadScenarioCatalog/);
  assert.match(source, /expectedOutcome/);
  assert.match(source, /evaluateOutcomeParity/);
  assert.doesNotMatch(source, /scenarioNotes|extractPayload/);
});

test("direct parity helpers distinguish expected denial from execution failure", async () => {
  const {
    classifyCliOutcome,
    classifyMcpOutcome,
    evaluateOutcomeParity,
    scenarioPayloadForOutput,
  } = await import(BENCHMARK_VALIDATOR);
  const scenario = loadScenarioCatalog().scenarios.find((entry) => entry.index === 54);
  const payload = scenarioPayloadForOutput(scenario, "/tmp/mcp-create");

  assert.equal(payload.outDir, "/tmp/mcp-create");
  assert.equal(scenario.payload.outDir, "$RUN_OUTPUT/create");
  assert.equal(classifyCliOutcome({
    exitCode: 1,
    json: { ok: false, error: "Budget receipt denied: deniedPools=wardens" },
  }), "budget_denied");
  assert.equal(classifyMcpOutcome({
    ok: false,
    error: "Budget receipt denied: deniedPools=wardens",
  }), "budget_denied");
  assert.deepEqual(
    evaluateOutcomeParity("budget_denied", "budget_denied", "budget_denied"),
    { cliOk: true, mcpOk: true, parityOk: true },
  );
  assert.deepEqual(
    evaluateOutcomeParity("budget_denied", "budget_denied", "unexpected_failure"),
    { cliOk: true, mcpOk: false, parityOk: false },
  );
});

test("baseline helpers preserve canonical payloads and derive compact references", async () => {
  const {
    classifyOutcome,
    deriveReference,
    scenarioPayloadForOutput,
  } = await import(BASELINE_GENERATOR);
  const scenario = loadScenarioCatalog().scenarios[0];
  const payload = scenarioPayloadForOutput(scenario, "/tmp/reference-create", 1234);

  assert.equal(payload.outDir, "/tmp/reference-create");
  assert.equal(payload.budgetTokens, 1234);
  assert.equal(scenario.payload.outDir, "$RUN_OUTPUT/create");
  assert.deepEqual(deriveReference({
    plan: {
      hints: {
        cardSet: [
          { type: "room", count: 2, affinity: "dark" },
          { type: "delver", count: 1, affinity: "fire" },
          { type: "delver", count: 2, affinity: "water" },
        ],
      },
    },
  }, { totalCost: 321 }), {
    entityCounts: { room: 2, delver: 3 },
    affinitiesByType: { room: ["dark"], delver: ["fire", "water"] },
    totalSpend: 321,
  });
  assert.equal(classifyOutcome({ exitCode: 0, json: { ok: true } }), "success");
  assert.equal(classifyOutcome({ exitCode: 1, json: { error: "Budget receipt denied" } }), "budget_denied");
  assert.equal(classifyOutcome({ exitCode: 1, stderr: "syntax error" }), "unexpected_failure");
});

test("canonical catalog hash ignores JSON object key order", (context) => {
  const dir = copyCatalog();
  context.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));

  for (const tier of TIERS) {
    const file = join(dir, `${tier}.json`);
    const document = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, `${JSON.stringify(reverseObjectKeys(document), null, 2)}\n`, "utf8");
  }

  assert.equal(loadScenarioCatalog(dir).sha256, EXPECTED_HASH);
  assert.equal(canonicalJson({ z: 1, a: { y: 2, b: 3 } }), '{"a":{"b":3,"y":2},"z":1}');
});

test("catalog rejects duplicate scenario indexes", (context) => {
  const dir = mutateCatalog("simple", (document) => {
    document.scenarios[1].index = document.scenarios[0].index;
  });
  context.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));

  assert.throws(() => loadScenarioCatalog(dir), /duplicate scenario index: 1/);
});

test("catalog rejects an implicit scenario tier", (context) => {
  const dir = mutateCatalog("simple", (document) => {
    delete document.scenarios[0].tier;
  });
  context.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));

  assert.throws(() => loadScenarioCatalog(dir), /scenario 1\.tier must be a non-empty string/);
});

test("catalog rejects unknown fields and non-canonical output paths", (context) => {
  const unknownDir = mutateCatalog("simple", (document) => {
    document.scenarios[0].surprise = true;
  });
  const pathDir = mutateCatalog("simple", (document) => {
    document.scenarios[0].payload.outDir = "/tmp/machine-specific";
  });
  context.onTestFinished(() => {
    rmSync(unknownDir, { recursive: true, force: true });
    rmSync(pathDir, { recursive: true, force: true });
  });

  assert.throws(() => loadScenarioCatalog(unknownDir), /scenario 1 has unknown field: surprise/);
  assert.throws(() => loadScenarioCatalog(pathDir), /canonical \$RUN_OUTPUT\/create placeholder/);
});

test("compact references produce the exact legacy score without readable vault files", (context) => {
  const fixture = scoringFixture();
  context.onTestFinished(() => rmSync(fixture.dir, { recursive: true, force: true }));

  const legacy = scoreRun(
    fixture.runResult,
    { budgetMode: "constrained" },
    fixture.referenceSpec,
    fixture.referenceReceipt,
  );
  const compact = scoreRun(
    fixture.runResult,
    { budgetMode: "constrained", reference: fixture.compactReference },
    "/missing-vault/spec.json",
    "/missing-vault/budget-receipt.json",
  );

  assert.deepEqual(compact, legacy);
  assert.equal(compact.points, 98);
});

test("malformed compact references fail closed instead of falling back to legacy files", (context) => {
  const fixture = scoringFixture();
  context.onTestFinished(() => rmSync(fixture.dir, { recursive: true, force: true }));

  assert.throws(() => scoreRun(
    fixture.runResult,
    {
      budgetMode: "constrained",
      reference: { entityCounts: null, affinitiesByType: {}, totalSpend: 100 },
    },
    fixture.referenceSpec,
    fixture.referenceReceipt,
  ), /Invalid compact reference expectations/);
});

// ## TODO: Test Permutations
// - reject missing catalog tier files and mismatched document-level tiers
// - reject gaps outside the exact 1..100 id range
// - reject constrained scenarios whose payload budget differs from the declared budget
// - reject malformed compact reference counts, affinities, and total spend
// - compact and legacy scorers remain equal for partial overlaps and empty card sets
// - malformed compact affinity arrays and non-positive constrained spends fail closed
