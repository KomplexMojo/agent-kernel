const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const { loadConfig } = require("../../tools/remote-ollama-control/scripts/lib/config");
const {
  buildHardwareBenchmarkSpecs,
  summarizeRecommendations,
} = require("../../tools/remote-ollama-control/scripts/lib/benchmark");

const ROOT = resolve(__dirname, "../..", "tools/remote-ollama-control");
const MAC_SCRIPT = resolve(ROOT, "scripts/remote-ollama-mac.js");

test("hardware benchmark routes 30B models only to dual and smaller models to both single-card profiles", () => {
  const config = loadConfig(ROOT);
  const plan = buildHardwareBenchmarkSpecs(config, {
    models: [
      "qwen3-coder:30b-a3b-q4_K_M",
      "qwen3-coder:30b",
      "qwen3:14b",
      "qwen2.5-coder:14b",
      "qwen2.5-coder:7b",
    ],
    contexts: [8192],
    efforts: ["high"],
    scenarioNames: ["vitest-generation"],
  });

  const byModel = new Map();
  for (const spec of plan.specs) {
    const profiles = byModel.get(spec.model) || new Set();
    profiles.add(spec.profileName);
    byModel.set(spec.model, profiles);
  }

  assert.deepEqual([...byModel.get("qwen3-coder:30b-a3b-q4_K_M")].sort(), ["dual"]);
  assert.deepEqual([...byModel.get("qwen3-coder:30b")].sort(), ["dual"]);
  assert.deepEqual([...byModel.get("qwen3:14b")].sort(), ["primary", "secondary"]);
  assert.deepEqual([...byModel.get("qwen2.5-coder:14b")].sort(), ["primary", "secondary"]);
  assert.deepEqual([...byModel.get("qwen2.5-coder:7b")].sort(), ["primary", "secondary"]);
});

test("hardware benchmark recommendations prefer score before speed", () => {
  const recommendations = summarizeRecommendations([
    {
      ok: true,
      profile: "primary",
      model: "fast-lower-quality",
      context: 32768,
      effortName: "max",
      numPredict: 16384,
      scenario: "vitest-generation",
      score: { score: 70 },
      earlyStop: { earlyStop: false },
      timings: { tokensPerSecond: 40 },
    },
    {
      ok: true,
      profile: "primary",
      model: "slow-higher-quality",
      context: 8192,
      effortName: "high",
      numPredict: 8192,
      scenario: "vitest-generation",
      score: { score: 90 },
      earlyStop: { earlyStop: false },
      timings: { tokensPerSecond: 4 },
    },
  ]);

  assert.equal(recommendations.byProfile[0].model, "slow-higher-quality");
  assert.equal(recommendations.byProfile[0].averageScore, 90);
});

test("hardware benchmark dry run advertises profile reset by default", () => {
  const result = spawnSync(process.execPath, [
    MAC_SCRIPT,
    "dry-run",
    "benchmark-hardware",
    "--route",
    "internal",
    "--models",
    "qwen3-coder:30b",
    "--contexts",
    "8192",
    "--efforts",
    "high",
    "--scenarios",
    "vitest-generation",
  ], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.startProfiles, true);
  assert.equal(output.resetProfiles, true);
  assert.deepEqual(output.runs.map((run) => run.profileName), ["dual"]);
});

test("remote ollama mac external host flag overrides the configured WAN host", () => {
  const result = spawnSync(process.execPath, [
    MAC_SCRIPT,
    "dry-run",
    "status",
    "--route",
    "external",
    "--external-host",
    "203.0.113.10",
    "--profile",
    "dual",
  ], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /darren@203\.0\.113\.10/);
  assert.doesNotMatch(result.stdout, /154\.5\.75\.3/);
});

test("hardware benchmark skips models with no configured profiles", () => {
  const config = {
    profiles: {
      primary: { name: "primary", port: 11434 },
    },
    models: {
      runnable: { profiles: ["primary"] },
      unconfigured: {},
    },
    benchmark: {
      defaultContexts: [4096],
      defaultEfforts: [{ name: "standard", numPredict: 4096 }],
      defaultScenarios: ["vitest-generation"],
    },
  };
  const plan = buildHardwareBenchmarkSpecs(config, {
    models: ["runnable", "unconfigured"],
  });
  assert.deepEqual(plan.specs.map((spec) => spec.model), ["runnable"]);
});

test("hardware benchmark resolves named effort from configured defaults", () => {
  const config = loadConfig(ROOT);
  const plan = buildHardwareBenchmarkSpecs(config, {
    models: ["qwen2.5-coder:7b"],
    contexts: [8192],
    efforts: ["high"],
    scenarioNames: ["vitest-generation"],
  });
  assert.ok(plan.specs.length > 0, "expected at least one benchmark spec");
  for (const spec of plan.specs) {
    assert.equal(spec.effortName, "high");
    assert.equal(spec.numPredict, 8192);
  }
});

test("hardware benchmark recommendations exclude failed runs", () => {
  const recommendations = summarizeRecommendations([
    {
      ok: false,
      profile: "primary",
      model: "failed-high-score",
      context: 32768,
      effortName: "high",
      numPredict: 8192,
      scenario: "vitest-generation",
      score: { score: 100 },
      timings: { tokensPerSecond: 100 },
    },
    {
      ok: true,
      profile: "primary",
      model: "successful",
      context: 8192,
      effortName: "standard",
      numPredict: 4096,
      scenario: "vitest-generation",
      score: { score: 70 },
      timings: { tokensPerSecond: 10 },
    },
  ]);
  assert.equal(recommendations.ranked.length, 1);
  assert.equal(recommendations.byProfile[0].model, "successful");
});

test("hardware benchmark dry run honors no-reset flag", () => {
  const result = spawnSync(process.execPath, [
    MAC_SCRIPT,
    "dry-run",
    "benchmark-hardware",
    "--route",
    "internal",
    "--models",
    "qwen3-coder:30b",
    "--contexts",
    "8192",
    "--efforts",
    "high",
    "--scenarios",
    "vitest-generation",
    "--no-reset",
  ], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.resetProfiles, false);
});
