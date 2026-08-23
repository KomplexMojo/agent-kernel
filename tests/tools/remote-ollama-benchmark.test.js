const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const http = require("node:http");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const { getProfile, loadConfig } = require("../../tools/remote-ollama-control/scripts/lib/config");
const {
  assertPortAvailable,
  dryRunProcessProbe,
} = require("../../tools/remote-ollama-control/scripts/remote-ollama-profile");
const { hostEnvironmentForChild } = require("../../tools/remote-ollama-control/scripts/lib/benchmark-pipeline");
const {
  buildContentGenMatrix,
  buildHardwareBenchmarkSpecs,
  summarizeRecommendations,
} = require("../../tools/remote-ollama-control/scripts/lib/benchmark");

const ROOT = resolve(__dirname, "../..", "tools/remote-ollama-control");
const MAC_SCRIPT = resolve(ROOT, "scripts/remote-ollama-mac.js");
const PROFILE_SCRIPT = resolve(ROOT, "scripts/remote-ollama-profile.js");

test("hardware benchmark reserves secondary and maps every model to its declared profiles", () => {
  const config = loadConfig(ROOT);
  const plan = buildHardwareBenchmarkSpecs(config, {
    models: [
      "qwen3-coder:30b-a3b-q4_K_M",
      "qwen3.8:27b",
      "qwen3.5:27b",
      "qwen3:14b",
      "qwen3.5:9b",
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
  assert.deepEqual([...byModel.get("qwen3.8:27b")].sort(), ["dual", "primary"]);
  // qwen3.5:27b mirrors qwen3.8:27b exactly — same size, same profiles, same settings — so the
  // only thing that differs between them is the generation. That is the whole point of its row.
  assert.deepEqual([...byModel.get("qwen3.5:27b")].sort(), ["dual", "primary"]);
  assert.deepEqual([...byModel.get("qwen3:14b")].sort(), ["primary"]);
  assert.deepEqual([...byModel.get("qwen3.5:9b")].sort(), ["primary"]);
  assert.equal(byModel.has("qwen2.5-coder:14b"), false, "dropped: it scored below the 7b");
  assert.equal(byModel.has("qwen2.5-coder:7b"), false, "replaced as canary by qwen3.5:9b");
  assert.equal(byModel.has("qwen3-coder:30b"), false, "dropped: same digest as :30b-a3b-q4_K_M");
});

test("content-gen matrix plans seven primary-or-dual configurations in resource order", () => {
  const config = loadConfig(ROOT);
  const plan = buildContentGenMatrix(config, { scenarioCount: 100 });

  assert.equal(plan.contractVersion, "content-gen-matrix-v1");
  assert.equal(plan.sha256, "21d135595cf539764f9df8f94fb6334f027f6a51f93eb467e9512631aaa728c2");
  assert.equal(plan.configurationCount, 7);
  assert.deepEqual(plan.repeatPolicy, {
    minimumCompletePasses: 1,
    maximumPasses: 3,
    earlyStop: "mathematically_lossless",
  });
  assert.deepEqual(plan.callBounds, { minimum: 700, maximum: 2100 });
  assert.deepEqual(plan.configurations.map((entry) => entry.configurationId), [
    "cg-v1--qwen3.5_9b--primary--ctx32768--out4096",
    "cg-v1--qwen3_14b--primary--ctx32768--out4096",
    "cg-v1--qwen3.5_27b--primary--ctx32768--out4096",
    "cg-v1--qwen3.8_27b--primary--ctx32768--out4096",
    "cg-v1--qwen3.5_27b--dual--ctx65536--out32768",
    "cg-v1--qwen3.8_27b--dual--ctx65536--out32768",
    "cg-v1--qwen3-coder_30b-a3b-q4_K_M--dual--ctx65536--out32768",
  ]);

  const profilesByModel = new Map();
  for (const entry of plan.configurations) {
    const profiles = profilesByModel.get(entry.model.id) || [];
    profiles.push(entry.profile.id);
    profilesByModel.set(entry.model.id, profiles);
  }
  assert.deepEqual(profilesByModel.get("qwen3-coder:30b-a3b-q4_K_M"), ["dual"]);
  assert.deepEqual(profilesByModel.get("qwen3.8:27b"), ["primary", "dual"]);
  assert.deepEqual(profilesByModel.get("qwen3.5:27b"), ["primary", "dual"]);
  assert.deepEqual(profilesByModel.get("qwen3:14b"), ["primary"]);
  assert.deepEqual(profilesByModel.get("qwen3.5:9b"), ["primary"]);

  const resourceTuples = plan.configurations.map((entry) => [
    entry.resourceOrder.gpuCount,
    entry.resourceOrder.capacityRank,
    entry.resourceOrder.modelSizeBillions,
    entry.resourceOrder.contextTokens,
    entry.resourceOrder.outputTokens,
  ]);
  assert.deepEqual(resourceTuples, [...resourceTuples].sort((left, right) => {
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return left[index] - right[index];
    }
    return 0;
  }));
  assert.deepEqual(buildContentGenMatrix(config, { scenarioCount: 100 }), plan);
});

test("content-gen dry run exposes the complete offline matrix and exact repeat bounds", () => {
  const result = spawnSync(process.execPath, [MAC_SCRIPT, "run-content-gen", "--dry-run"], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.command, "run-content-gen");
  assert.equal(output.execution, "plan-only");
  assert.equal(output.scenarioSet.count, 100);
  assert.deepEqual(output.scenarioSet.tierCounts, {
    simple: 25,
    affinity: 25,
    complex: 25,
    constrained: 25,
  });
  assert.equal(output.matrix.configurationCount, 7);
  assert.equal(output.runsPerScenario, 3);
  assert.deepEqual(output.matrix.callBounds, { minimum: 700, maximum: 2100 });
  assert.equal(output.matrix.configurations.length, 7);
});

// A state directory whose profile is unmistakably running: the pid is this very test process, so
// `process.kill(pid, 0)` succeeds on any host. That is the machine state the dry run must ignore.
function runningProfileStateDir(profileName = "primary") {
  const dir = mkdtempSync(join(tmpdir(), "remote-ollama-state-"));
  writeFileSync(
    join(dir, `${profileName}.json`),
    `${JSON.stringify({ mode: "pid", pid: process.pid, profile: profileName, model: "" })}\n`,
  );
  return dir;
}

test("profile dry run honors an explicit Ollama binary for unattended starts", () => {
  const result = spawnSync(process.execPath, [
    PROFILE_SCRIPT,
    "start",
    "--profile",
    "primary",
    "--dry-run",
  ], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, OLLAMA_BIN: "/opt/ollama-current/bin/ollama", LLM_PROFILE_MANAGER: "pid" },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /'\/opt\/ollama-current\/bin\/ollama' serve/);
});

// The perturbation that makes the test above hermetic. It used to pass only where no profile
// happened to be running — that is, everywhere except the benchmark box, whose whole job is to run
// Ollama. A dry run there exited 1, the source preflight failed, and the benchmark never started.
test("profile dry run plans the start even while that profile is running", () => {
  const result = spawnSync(process.execPath, [
    PROFILE_SCRIPT,
    "start",
    "--profile",
    "primary",
    "--dry-run",
  ], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      OLLAMA_BIN: "/opt/ollama-current/bin/ollama",
      LLM_PROFILE_MANAGER: "pid",
      LLM_PROFILE_STATE_DIR: runningProfileStateDir(),
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /'\/opt\/ollama-current\/bin\/ollama' serve/);
  // The plan still states the guard it did not evaluate, so an inert check never reads as no check.
  assert.match(result.stdout, /preflight \(not evaluated\).*already running/);
});

// The refusal half. Skipping the check for a plan must not skip it for a start — prove the guard
// still has teeth by handing it a probe that reports exactly what the box reports.
test("a real start refuses when the process probe reports the profile running", () => {
  const profile = getProfile(loadConfig(ROOT), "primary");

  assert.throws(
    () => assertPortAvailable(profile, {
      runningInfo: () => ({ running: true, mode: "systemd-user" }),
      portLines: () => [],
    }),
    /Profile 'primary' is already running \(systemd-user\)/,
  );

  assert.throws(
    () => assertPortAvailable(profile, {
      runningInfo: () => ({ running: false, mode: "" }),
      portLines: () => ["LISTEN 0 4096 127.0.0.1:11434 users:((\"ollama\",pid=1,fd=3))"],
    }),
    /is already in use; refusing to kill unrelated processes/,
  );

  // ...and the dry-run probe is inert by construction, not by luck of the host it runs on.
  assert.equal(dryRunProcessProbe.runningInfo(profile).running, false);
  assert.deepEqual(dryRunProcessProbe.portLines(profile.port), []);
  assert.doesNotThrow(() => assertPortAvailable(profile, dryRunProcessProbe));
});

// End to end, on the same fixture the dry run above ignores: a start that is not a dry run still
// reads live state and still refuses. OLLAMA_BIN points nowhere so a regression here cannot launch
// a real Ollama on the benchmark box.
test("the start guard is wired to the live probe when the start is real", () => {
  const stateDir = runningProfileStateDir();
  const result = spawnSync(process.execPath, [
    PROFILE_SCRIPT,
    "start",
    "--profile",
    "primary",
  ], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      OLLAMA_BIN: join(stateDir, "never-ollama"),
      LLM_PROFILE_MANAGER: "pid",
      LLM_PROFILE_STATE_DIR: stateDir,
    },
  });

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /Profile 'primary' is already running \(pid\)/);
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
    "qwen3-coder:30b-a3b-q4_K_M",
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
    models: ["qwen3.5:9b"],
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
    "qwen3-coder:30b-a3b-q4_K_M",
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

// ## TODO: Test Permutations
// - content-gen matrix rejects duplicate sanitized configuration ids
// - explicit model/profile filters with no eligible intersection fail closed
// - explicit context, output, repeat, and scenario overrides produce exact call bounds

// The content-gen child runs in the isolated source worktree, where config/llm-host.env is absent
// by design. Before this, it inherited nothing, defaulted sshPort to 22, and reported a route-probe
// failure — a network story for a missing-file fault, published as infrastructure_error.
test("content generation inherits host addressing from the installed package, not the worktree", () => {
  const installed = mkdtempSync(join(tmpdir(), "remote-ollama-installed-"));
  mkdirSync(join(installed, "config"), { recursive: true });
  writeFileSync(
    join(installed, "config", "llm-host.env"),
    "LLM_INTERNAL_HOST=10.0.0.5\nLLM_SSH_PORT=2222\nLLM_DEFAULT_ROUTE=internal\nUNRELATED=nope\n",
  );

  const hostEnv = hostEnvironmentForChild(installed);
  assert.equal(hostEnv.LLM_INTERNAL_HOST, "10.0.0.5");
  // The port is the whole point: without it the child probes 22 and blames the network.
  assert.equal(hostEnv.LLM_SSH_PORT, "2222");
  assert.equal(hostEnv.LLM_DEFAULT_ROUTE, "internal");
  // Only LLM_* crosses over — the file is not a general-purpose environment injection point.
  assert.equal("UNRELATED" in hostEnv, false);
});

// The refusal half: an installation with no host file must say so, naming the file, rather than
// letting the child emit a plausible-looking route-probe failure.
test("content generation refuses to start when the runner has no host addressing", () => {
  const empty = mkdtempSync(join(tmpdir(), "remote-ollama-nohost-"));
  mkdirSync(join(empty, "config"), { recursive: true });

  const saved = {
    internal: process.env.LLM_INTERNAL_HOST,
    external: process.env.LLM_EXTERNAL_HOST,
  };
  delete process.env.LLM_INTERNAL_HOST;
  delete process.env.LLM_EXTERNAL_HOST;
  try {
    assert.throws(
      () => hostEnvironmentForChild(empty),
      /content generation has no host configuration: .*llm-host\.env/,
    );
  } finally {
    if (saved.internal === undefined) delete process.env.LLM_INTERNAL_HOST;
    else process.env.LLM_INTERNAL_HOST = saved.internal;
    if (saved.external === undefined) delete process.env.LLM_EXTERNAL_HOST;
    else process.env.LLM_EXTERNAL_HOST = saved.external;
  }
});
