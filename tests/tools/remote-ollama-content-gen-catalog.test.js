const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const {
  CATALOG_DIR,
  canonicalJson,
  loadScenarioCatalog,
  loadScenarios,
} = require("../../tools/remote-ollama-control/scripts/lib/ak-scenarios");
const { scoreRun } = require("../../tools/remote-ollama-control/scripts/lib/ak-compare");
const { AK_CREATE_TOOL } = require("../../tools/remote-ollama-control/scripts/lib/ak-tool-schema");
const { normalizeToolArgs } = require("../../tools/remote-ollama-control/scripts/lib/ak-runner");
const {
  pipelineComponents,
  validateRouteManifestDocument,
} = require("../../tools/remote-ollama-control/scripts/lib/benchmark-pipeline");
const { loadExecutionCatalog } = require("../../tools/remote-ollama-control/scripts/lib/execution-catalog");

const PRIOR_CATALOG_HASH = "fa63f68c2adb2f9be01f2e5634230fee217f3753d199f20c3169980686308272";
const EXPECTED_HASH = "d839c42a9932ce0c82d43d58c6cceca4b2191ba965d3f01773ce7d2feca3a001";
const TIERS = ["simple", "affinity", "complex", "constrained"];
const ROOT = resolve(__dirname, "../..");
const REMOTE_CONTROL_ROOT = resolve(__dirname, "../../tools/remote-ollama-control");
const MAC_SCRIPT = join(REMOTE_CONTROL_ROOT, "scripts/remote-ollama-mac.js");
const GENERATED_ROUTES = join(REMOTE_CONTROL_ROOT, "benchmarks/execution/generated-content-routes.json");
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

function parseEntitySpec(spec) {
  return Object.fromEntries(String(spec).split(";").map((segment) => {
    const separator = segment.indexOf("=");
    return [segment.slice(0, separator), segment.slice(separator + 1)];
  }));
}

function authoredCount(payload, key) {
  return (payload[key] || []).reduce((sum, spec) => (
    sum + Number.parseInt(parseEntitySpec(spec).count || "1", 10)
  ), 0);
}

async function runCanonicalScenario(scenario, budgetTokens = scenario.payload.budgetTokens) {
  const { buildArgv } = await import("../../packages/adapters-cli/src/mcp/tools/shared.mjs");
  const { authoringSpec } = await import("../../packages/adapters-cli/src/mcp/tools/authoring.mjs");
  const cli = resolve(__dirname, "../../packages/adapters-cli/src/cli/ak.mjs");
  const outDir = mkdtempSync(join(tmpdir(), `ak-constrained-${scenario.index}-`));
  try {
    const result = spawnSync(process.execPath, [cli, "create", ...buildArgv({
      ...scenario.payload,
      budgetTokens,
      outDir,
    }, authoringSpec)], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    const detail = `${result.stderr || ""}\n${result.stdout || ""}`;
    return {
      actual: result.status === 0
        ? "success"
        : /Budget receipt denied/i.test(detail) ? "budget_denied" : "unexpected_failure",
      detail,
    };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
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
      affinitiesByType: { delver: ["fire"] },
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

test("constrained prompts name the exact budget the harness executes", () => {
  const catalog = loadScenarioCatalog();
  for (const scenario of catalog.scenarios.filter((entry) => entry.budgetMode === "constrained")) {
    const match = scenario.prompt.match(/\bUse a (\d+) token hard budget\b/);
    assert.ok(match, `scenario ${scenario.index} prompt does not declare its hard budget`);
    assert.equal(Number.parseInt(match[1], 10), scenario.budget,
      `scenario ${scenario.index} prompt budget disagrees with its executed budget`);
    assert.equal(scenario.payload.budgetTokens, scenario.budget);
  }
});

test("constrained canonical payloads produce their declared outcomes", async () => {
  const constrained = loadScenarioCatalog().scenarios.filter((entry) => entry.budgetMode === "constrained");

  for (const scenario of constrained) {
    const result = await runCanonicalScenario(scenario);
    assert.equal(result.actual, scenario.expectedOutcome,
      `scenario ${scenario.index} expected ${scenario.expectedOutcome}, received ${result.actual}: ${result.detail}`);
  }
});

test("named constrained boundaries match the allocator's actual minimum", async () => {
  const catalog = loadScenarioCatalog();
  const offsetsFromMinimum = new Map([
    [90, 0], [91, -1], [92, 0], [93, -1], [94, 0], [95, -1],
    [96, 0], [97, -1], [98, 5], [99, -1], [100, 0],
  ]);

  for (const [index, offset] of offsetsFromMinimum) {
    const scenario = catalog.scenarios.find((entry) => entry.index === index);
    const minimum = scenario.budget - offset;
    if (offset !== 0) {
      const exact = await runCanonicalScenario(scenario, minimum);
      assert.equal(exact.actual, "success",
        `scenario ${index} claims a minimum of ${minimum}, but it received ${exact.actual}: ${exact.detail}`);
    }
    if (offset !== -1) {
      const under = await runCanonicalScenario(scenario, minimum - 1);
      assert.equal(under.actual, "budget_denied",
        `scenario ${index} claims a minimum of ${minimum}, but ${minimum - 1} received ${under.actual}: ${under.detail}`);
    }
  }
});

test("content authoring preserves blocking hazards and V3 affinity resources through the public route", () => {
  const properties = AK_CREATE_TOOL.function.parameters.properties;
  assert.ok(properties.hazard.items.properties.blocking, "ak_create must expose blocking hazards");
  for (const field of ["permanenceMode", "vital", "regen", "affinity", "expression", "stacks", "mana", "manaRegen"]) {
    assert.ok(properties.resource.items.properties[field], `ak_create resource schema is missing ${field}`);
  }

  const normalized = normalizeToolArgs({
    hazard: [{ affinity: "earth", expression: "emit", proximityRadius: 1, blocking: true }],
    resource: [{ affinity: "fire", expression: "push", stacks: 2, mana: 12, manaRegen: 0 }],
  });
  assert.equal(normalized.hazard[0].blocking, true);
  assert.equal(normalized.resource[0].affinity, "fire");

  const outDir = mkdtempSync(join(tmpdir(), "ak-content-route-affinity-resource-"));
  const result = spawnSync(process.execPath, [
    resolve(__dirname, "../../packages/adapters-cli/src/cli/ak.mjs"), "create",
    "--room", "size=medium;count=1",
    "--hazard", "affinity=earth;expression=emit;proximityRadius=1;blocking=true",
    "--resource", "affinity=fire;expression=push;stacks=2;mana=12;manaRegen=0",
    "--out-dir", outDir,
    "--run-id", "content_route_affinity_resource",
    "--created-at", "2026-08-21T00:00:00.000Z",
  ], { cwd: resolve(__dirname, "../.."), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const spec = JSON.parse(readFileSync(join(outDir, "spec.json"), "utf8"));
  assert.equal(spec.configurator.inputs.levelGen.hazards[0].blocking, true);
  assert.deepEqual(spec.configurator.inputs.resources[0].affinity, {
    kind: "fire", expression: "push", stacks: 2, mana: 12, manaRegen: 0,
  });
});

test("generated execution routes bind 26 exact semantic counterparts to the balanced catalog", async () => {
  const catalog = loadScenarioCatalog();
  const executionCatalog = loadExecutionCatalog();
  const manifest = JSON.parse(readFileSync(GENERATED_ROUTES, "utf8"));
  const routes = validateRouteManifestDocument(manifest, {
    kind: "generated",
    components: pipelineComponents(ROOT, executionCatalog),
    catalog: executionCatalog,
    sourceWorktree: ROOT,
    scenarioSetHash: catalog.sha256,
  });
  assert.equal(manifest.identity.scenarioSetHash, EXPECTED_HASH);
  assert.notEqual(manifest.identity.scenarioSetHash, PRIOR_CATALOG_HASH);
  assert.equal(Object.keys(routes).length, 26);
  assert.equal(new Set(Object.values(routes).map((route) => route.scenarioIndex)).size, 26);

  const expected = {
    "EX-TR-01": [1, 1, 0, 0, 0, ["exploring"]],
    "EX-TR-02": [3, 1, 0, 0, 0, ["exploring"]],
    "EX-TR-03": [2, 0, 1, 0, 0, ["patrolling"]],
    "EX-TR-04": [1, 0, 1, 0, 0, ["stationary"]],
    "EX-TR-05": [3, 2, 2, 0, 0, ["exploring", "patrolling", "random", "stationary"]],
    "EX-CB-01": [1, 1, 1, 0, 0, ["attacking", "defending"]],
    "EX-CB-02#neutral": [1, 1, 1, 0, 0, ["attacking", "defending"]],
    "EX-CB-02#advantaged": [1, 1, 1, 0, 0, ["attacking", "defending"]],
    "EX-CB-03": [1, 2, 1, 0, 0, ["attacking", "defending"]],
    "EX-CB-04": [1, 1, 1, 0, 0, ["attacking", "defending"]],
    "EX-CB-05": [1, 1, 2, 0, 0, ["attacking", "defending", "reflexive"]],
    "EX-HZ-01": [1, 1, 0, 1, 0, ["exploring"]],
    "EX-HZ-02": [1, 1, 0, 1, 0, ["exploring"]],
    "EX-HZ-03": [1, 1, 0, 1, 0, ["exploring"]],
    "EX-HZ-04": [1, 1, 1, 1, 0, ["exploring", "stationary"]],
    "EX-HZ-05": [1, 1, 0, 1, 0, ["exploring"]],
    "EX-RS-01": [1, 1, 0, 0, 1, ["exploring"]],
    "EX-RS-02": [1, 1, 0, 0, 1, ["exploring"]],
    "EX-RS-03": [1, 1, 0, 0, 1, ["exploring"]],
    "EX-RS-04": [1, 1, 1, 0, 1, ["attacking", "defending"]],
    "EX-RS-05": [1, 1, 1, 0, 2, ["attacking", "defending"]],
    "EX-ST-01": [3, 2, 2, 2, 2, ["attacking", "defending", "patrolling", "random"]],
    "EX-ST-02": [1, 1, 10, 0, 0, ["random"]],
    "EX-ST-03": [4, 2, 4, 6, 6, ["attacking", "defending", "patrolling", "random"]],
    "EX-ST-04": [2, 2, 2, 0, 0, ["attacking", "defending", "patrolling", "random"]],
    "EX-ST-05": [1, 1, 2, 0, 0, ["random"]],
  };

  for (const [key, shape] of Object.entries(expected)) {
    const scenario = catalog.scenarios.find((entry) => entry.index === routes[key].scenarioIndex);
    assert.ok(scenario, `missing authoring scenario for ${key}`);
    assert.equal(scenario.expectedOutcome, "success");
    assert.match(scenario.title, new RegExp(`^Execution ${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} —`));
    assert.ok(scenario.prompt.includes(`[${key}]`), `${key} prompt lacks its explicit execution contract`);
    const payload = scenario.payload;
    assert.deepEqual([
      authoredCount(payload, "room"),
      authoredCount(payload, "delver"),
      authoredCount(payload, "warden"),
      authoredCount(payload, "hazard"),
      authoredCount(payload, "resource"),
      [...new Set([...(payload.delver || []), ...(payload.warden || [])]
        .map((spec) => parseEntitySpec(spec).motivation))].sort(),
    ], shape, `${key} authoring payload drifted from its execution setup`);
  }

  assert.deepEqual(["emit", "push", "pull", "draw"], [
    "EX-HZ-01", "EX-HZ-02", "EX-HZ-03", "EX-HZ-04",
  ].map((key) => parseEntitySpec(catalog.scenarios.find(
    (entry) => entry.index === routes[key].scenarioIndex,
  ).payload.hazard[0]).expression));
  assert.equal(parseEntitySpec(catalog.scenarios.find(
    (entry) => entry.index === routes["EX-HZ-05"].scenarioIndex,
  ).payload.hazard[0]).blocking, "true");

  const temporary = parseEntitySpec(catalog.scenarios.find(
    (entry) => entry.index === routes["EX-RS-04"].scenarioIndex,
  ).payload.resource[0]);
  assert.deepEqual(temporary, {
    id: "resource_fire_temporary", affinity: "fire", expression: "push",
    stacks: "2", mana: "12", manaRegen: "0",
  });
  const permanent = catalog.scenarios.find(
    (entry) => entry.index === routes["EX-RS-05"].scenarioIndex,
  ).payload.resource.map(parseEntitySpec);
  assert.equal(permanent.length, 2);
  assert.ok(permanent.every((resource) => resource.affinity === "fire"
    && resource.expression === "emit" && resource.stacks === "2"
    && resource.mana === "12" && resource.manaRegen === "2"));

  const neutral = parseEntitySpec(catalog.scenarios.find(
    (entry) => entry.index === routes["EX-CB-02#neutral"].scenarioIndex,
  ).payload.delver[0]);
  const advantaged = parseEntitySpec(catalog.scenarios.find(
    (entry) => entry.index === routes["EX-CB-02#advantaged"].scenarioIndex,
  ).payload.delver[0]);
  assert.equal(neutral.affinity, "earth");
  assert.equal(advantaged.affinity, "fire");
  delete neutral.affinity;
  delete neutral.affinities;
  delete advantaged.affinity;
  delete advantaged.affinities;
  assert.deepEqual(advantaged, neutral, "CB-02 variants must differ only in declared attacker affinity");

  const { buildArgv } = await import("../../packages/adapters-cli/src/mcp/tools/shared.mjs");
  const { authoringSpec } = await import("../../packages/adapters-cli/src/mcp/tools/authoring.mjs");
  const cli = resolve(__dirname, "../../packages/adapters-cli/src/cli/ak.mjs");
  for (const [key, route] of Object.entries(routes)) {
    const scenario = catalog.scenarios.find((entry) => entry.index === route.scenarioIndex);
    const outDir = mkdtempSync(join(tmpdir(), `ak-generated-route-${key.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-`));
    const result = spawnSync(process.execPath, [cli, "create", ...buildArgv({
      ...scenario.payload,
      outDir,
    }, authoringSpec)], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    assert.equal(result.status, 0, `${key} canonical authoring route failed: ${result.stderr || result.stdout}`);
    assert.equal(existsSync(join(outDir, "sim-config.json")), true);
    assert.equal(existsSync(join(outDir, "initial-state.json")), true);
    if (key === "EX-RS-04" || key === "EX-RS-05") {
      const spec = JSON.parse(readFileSync(join(outDir, "spec.json"), "utf8"));
      assert.ok(spec.configurator.inputs.resources.every((resource) => resource.affinity),
        `${key} lost affinity during canonical authoring`);
    }
  }
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
    affinitiesByType: { delver: ["fire", "water"] },
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

test("catalog rejects a prompt budget that differs from the executable payload", (context) => {
  const dir = mutateCatalog("constrained", (document) => {
    document.scenarios[0].prompt = document.scenarios[0].prompt.replace(
      /Use a \d+ token hard budget/,
      "Use a 999 token hard budget",
    );
    document.scenarios[0].payload.text = document.scenarios[0].prompt;
  });
  context.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));

  assert.throws(() => loadScenarioCatalog(dir), /prompt hard budget must match payload\.budgetTokens/);
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

test("catalog rejects room affinities because rooms are untyped containers", (context) => {
  const dir = mutateCatalog("simple", (document) => {
    document.scenarios[0].reference.affinitiesByType.room = ["dark"];
  });
  context.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));

  assert.throws(() => loadScenarioCatalog(dir), /room affinities are not part of the program construct/);
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
