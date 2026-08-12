const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const TOOL_ROOT = resolve(__dirname, "../../tools/remote-ollama-control");
const INSTALLER = join(TOOL_ROOT, "scripts/install-local-ubuntu.sh");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function installFixture(home) {
  return execFileSync("bash", [INSTALLER], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      REMOTE_OLLAMA_INSTALL_SYSTEM: "Linux",
      REMOTE_OLLAMA_SKIP_SYSTEMCTL: "1",
    },
  });
}

function setupRemote(root) {
  const remote = join(root, "source.git");
  const operator = join(root, "operator");
  git(root, ["init", "--bare", remote]);
  git(root, ["clone", remote, operator]);
  git(operator, ["config", "user.email", "benchmark@example.invalid"]);
  git(operator, ["config", "user.name", "Benchmark Fixture"]);
  writeFileSync(join(operator, "README.md"), "source\n");
  git(operator, ["add", "README.md"]);
  git(operator, ["commit", "-m", "initial"]);
  git(operator, ["branch", "-M", "main"]);
  git(operator, ["push", "-u", "origin", "main"]);
  return remote;
}

test("local Ubuntu install is idempotent and deploys unprivileged user artifacts", () => {
  const home = mkdtempSync(join(tmpdir(), "ak-benchmark-install-"));
  installFixture(home);
  const packageDir = join(home, "remote-ollama-control");
  const config = join(home, ".config/agent-kernel-benchmark/benchmark-agent.env");
  const service = join(home, ".config/systemd/user/agent-kernel-benchmark.service");
  const timer = join(home, ".config/systemd/user/agent-kernel-benchmark.timer");
  assert.equal(existsSync(join(home, "bin/agent-kernel-benchmark")), true);
  assert.equal(existsSync(join(packageDir, "bin/agent-kernel-benchmark")), true);
  assert.equal(existsSync(service), true);
  assert.equal(existsSync(timer), true);
  writeFileSync(config, `${readFileSync(config, "utf8")}\nAK_OPERATOR_MARKER=preserve\n`);
  installFixture(home);
  assert.match(readFileSync(config, "utf8"), /AK_OPERATOR_MARKER=preserve/);
  assert.doesNotMatch(readFileSync(config, "utf8"), /(?:TOKEN|PASSWORD|PRIVATE_KEY)=\S+/);
});

test("systemd timer delegates to one internal lock and runbook documents lifecycle", () => {
  const service = readFileSync(join(TOOL_ROOT, "systemd/agent-kernel-benchmark.service"), "utf8");
  const timer = readFileSync(join(TOOL_ROOT, "systemd/agent-kernel-benchmark.timer"), "utf8");
  const shim = readFileSync(join(TOOL_ROOT, "bin/agent-kernel-benchmark"), "utf8");
  const example = readFileSync(join(TOOL_ROOT, "config/benchmark-agent.env.example"), "utf8");
  const readme = readFileSync(join(TOOL_ROOT, "README.md"), "utf8");
  assert.match(service, /Type=oneshot/);
  assert.match(service, /NoNewPrivileges=true/);
  assert.doesNotMatch(service, /^(?:User=root|Group=root)/m);
  assert.match(service, /EnvironmentFile=-%h\/\.config\/agent-kernel-benchmark\/benchmark-agent\.env/);
  assert.match(timer, /Unit=agent-kernel-benchmark\.service/);
  assert.equal((`${service}\n${timer}\n${shim}`.match(/flock/g) || []).length, 0);
  assert.match(example, /AK_BENCHMARK_DRY_RUN=1/);
  assert.doesNotMatch(example, /\/Users\/|\/home\/darren|(?:TOKEN|PASSWORD|PRIVATE_KEY)=\S+/);
  assert.notEqual(
    /AK_BENCHMARK_SOURCE_MIRROR=([^\n]+)/.exec(example)?.[1],
    /AK_BENCHMARK_STATE_DIR=([^\n]+)/.exec(example)?.[1],
  );
  assert.match(readme, /systemctl --user disable --now agent-kernel-benchmark\.timer/);
  assert.match(readme, /systemctl --user enable --now agent-kernel-benchmark\.timer/);
});

test("installed dry-run fetches and classifies without state, publication, or GPU execution", () => {
  const home = mkdtempSync(join(tmpdir(), "ak-benchmark-dry-run-"));
  const remote = setupRemote(home);
  installFixture(home);
  const envFile = join(home, ".config/agent-kernel-benchmark/benchmark-agent.env");
  writeFileSync(envFile, [
    `AK_BENCHMARK_SOURCE_REMOTE=${remote}`,
    `AK_BENCHMARK_RESULTS_REMOTE=${remote}`,
    "AK_BENCHMARK_SOURCE_REF=main",
    "AK_BENCHMARK_RESULT_BRANCH=benchmark-results",
    "AK_BENCHMARK_SCENARIO_HASH=scenario-a",
    "AK_BENCHMARK_MATRIX_HASH=matrix-a",
    "AK_BENCHMARK_DRY_RUN=1",
    "",
  ].join("\n"));
  const result = spawnSync(join(home, "bin/agent-kernel-benchmark"), [], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "dry_run");
  assert.equal(output.trigger.required, true);
  assert.equal(existsSync(join(home, ".local/state/agent-kernel-benchmark/state.json")), false);
  assert.throws(() => git(home, [`--git-dir=${remote}`, "rev-parse", "refs/heads/benchmark-results"]));
  assert.equal(existsSync(join(home, ".local/share/agent-kernel-benchmark/source.git")), true);
  assert.equal(existsSync(join(home, ".local/state/agent-kernel-benchmark/results-worktree")), false);
});

// ## TODO: Test Permutations
// - installer rejects non-Linux hosts without the explicit fixture override
// - a malformed operator env file fails before cloning or changing state
// - dry-run after an irrelevant commit reports no trigger and leaves poll state untouched
