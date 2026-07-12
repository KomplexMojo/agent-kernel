const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const http = require("node:http");
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

// ---------------------------------------------------------------------------
// Group A — local mode: dry-run endpoint & env (no network)
// ---------------------------------------------------------------------------

test("local claude dry-run targets the default localhost endpoint and exports the model", () => {
  const result = spawnSync(process.execPath, [
    MAC_SCRIPT,
    "dry-run",
    "claude",
    "--local",
    "--model",
    "qwen3.5:9b",
  ], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /http:\/\/127\.0\.0\.1:11434/);
  assert.match(result.stdout, /qwen3\.5:9b/);
  assert.doesNotMatch(result.stdout, /ssh|Tunnel|REMOTE_OLLAMA_|profile/i);
});

test("local claude dry-run honors LLM_LOCAL_OLLAMA_HOST override", () => {
  const result = spawnSync(process.execPath, [
    MAC_SCRIPT,
    "dry-run",
    "claude",
    "--local",
    "--model",
    "qwen3.5:9b",
  ], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, LLM_LOCAL_OLLAMA_HOST: "http://127.0.0.1:9999" },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /http:\/\/127\.0\.0\.1:9999/);
  assert.doesNotMatch(result.stdout, /:11434/);
});

test("local run-local dry-run preserves the command after -- and shows no tunnel", () => {
  const result = spawnSync(process.execPath, [
    MAC_SCRIPT,
    "dry-run",
    "run-local",
    "--local",
    "--model",
    "qwen3.5:9b",
    "--",
    "node",
    "-e",
    "1",
  ], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /OLLAMA_MODEL=.*qwen3\.5:9b/);
  assert.match(result.stdout, /node/);
  assert.doesNotMatch(result.stdout, /ssh|Tunnel/i);
});

test("print-env --local emits exactly the five client exports and no remote vars", () => {
  const result = spawnSync(process.execPath, [
    MAC_SCRIPT,
    "print-env",
    "--local",
    "--model",
    "qwen3.5:9b",
  ], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /export OLLAMA_HOST=/);
  assert.match(result.stdout, /export OLLAMA_MODEL=/);
  assert.match(result.stdout, /export ANTHROPIC_BASE_URL=/);
  assert.match(result.stdout, /export ANTHROPIC_AUTH_TOKEN=/);
  assert.match(result.stdout, /export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1/);
  assert.doesNotMatch(result.stdout, /REMOTE_OLLAMA_/);

  const exportLines = result.stdout
    .split("\n")
    .filter((line) => line.startsWith("export "));
  assert.equal(exportLines.length, 5, `expected exactly five export lines, got:\n${result.stdout}`);
});

// ---------------------------------------------------------------------------
// Group B — local mode: flag-conflict validation
// ---------------------------------------------------------------------------

const LOCAL_CONFLICTING_FLAGS = [
  ["--profile", "dual"],
  ["--route", "external"],
  ["--tunnel"],
  ["--direct"],
  ["--external-host", "203.0.113.5"],
  ["--local-port", "21500"],
];

for (const flagArgs of LOCAL_CONFLICTING_FLAGS) {
  const flagName = flagArgs[0];
  test(`--local rejects the remote-only flag ${flagName}`, () => {
    const result = spawnSync(process.execPath, [
      MAC_SCRIPT,
      "dry-run",
      "claude",
      "--local",
      ...flagArgs,
    ], {
      cwd: ROOT,
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0, `expected non-zero exit for ${flagName}\n${result.stdout}`);
    assert.match(result.stderr, new RegExp(flagName.replace(/[-]/g, "\\-")));
  });
}

test("--local on an unsupported command is rejected", () => {
  const result = spawnSync(process.execPath, [
    MAC_SCRIPT,
    "dry-run",
    "status",
    "--local",
  ], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /--local/);
});

// ---------------------------------------------------------------------------
// Group C — local mode: endpoint + model health check (no internet, no SSH)
// ---------------------------------------------------------------------------

test("local run-local verifies endpoint and model against a live local Ollama-compatible server", async () => {
  const hits = { version: false, show: false };
  let seenModel = null;

  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/version") {
      hits.version = true;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ version: "0.0.0-test" }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/show") {
      hits.show = true;
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          seenModel = parsed.model;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ model: parsed.model }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  try {
    await new Promise((resolveListen) => {
      server.listen(0, "127.0.0.1", resolveListen);
    });
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    // Use async spawn (not spawnSync): the fake Ollama server runs in THIS
    // process's event loop, and spawnSync would block it so the child's
    // /api/version health check could never be answered.
    const result = await new Promise((resolveRun, rejectRun) => {
      const child = spawn(process.execPath, [
        MAC_SCRIPT,
        "run-local",
        "--local",
        "--model",
        "qwen3.5:9b",
        "--",
        "node",
        "-e",
        "process.stdout.write(process.env.OLLAMA_HOST+'|'+process.env.OLLAMA_MODEL+'|'+process.env.ANTHROPIC_BASE_URL+'|'+process.env.ANTHROPIC_AUTH_TOKEN+'|'+process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC)",
      ], {
        cwd: ROOT,
        env: { ...process.env, LLM_LOCAL_OLLAMA_HOST: base },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", rejectRun);
      child.on("close", (status) => resolveRun({ status, stdout, stderr }));
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(hits.version, true, "expected GET /api/version to be hit");
    assert.equal(hits.show, true, "expected POST /api/show to be hit");
    assert.equal(seenModel, "qwen3.5:9b", "expected /api/show to receive the requested model");
    // The wrapper prints a "Local Ollama endpoint healthy: ..." status line to
    // stdout before running the child, so match the child's line specifically.
    const expectedChild = `${base}|qwen3.5:9b|${base}|ollama|1`;
    const lastLine = result.stdout.trim().split("\n").pop();
    assert.equal(lastLine, expectedChild, result.stdout);
    assert.doesNotMatch(result.stdout, /REMOTE_OLLAMA_|ssh|Tunnel/i, result.stdout);
  } finally {
    server.close();
  }
});
