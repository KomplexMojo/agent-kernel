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
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    REMOTE_OLLAMA_INSTALL_SYSTEM: "Linux",
    REMOTE_OLLAMA_SKIP_SYSTEMCTL: "1",
    // The operator's real llm-host.env points LLM_REMOTE_*_DIR at paths on the
    // Ubuntu box, and the installer uses them as local install targets. Without
    // this the fixture installs to /home/darren instead of its temp HOME.
    REMOTE_OLLAMA_ENV_FILE: join(home, "absent-llm-host.env"),
  };
  // A parent shell that sourced llm-host.env (or ran install-remote) leaves these
  // set; spreading process.env would then ignore the absent env-file guard above.
  delete env.LLM_REMOTE_PACKAGE_DIR;
  delete env.LLM_REMOTE_SCRIPTS_DIR;
  delete env.LLM_REMOTE_PROJECT_DIR;
  return execFileSync("bash", [INSTALLER], { encoding: "utf8", env });
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
  const home = mkdtempSync(join(tmpdir(), "agon-benchmark-install-"));
  installFixture(home);
  const packageDir = join(home, "remote-ollama-control");
  const config = join(home, ".config/agon-benchmark/benchmark-agent.env");
  const service = join(home, ".config/systemd/user/agon-benchmark.service");
  const timer = join(home, ".config/systemd/user/agon-benchmark.timer");
  assert.equal(existsSync(join(home, "bin/agon-benchmark")), true);
  assert.equal(existsSync(join(packageDir, "bin/agon-benchmark")), true);
  assert.equal(existsSync(service), true);
  assert.equal(existsSync(timer), true);
  writeFileSync(config, `${readFileSync(config, "utf8")}\nAGON_OPERATOR_MARKER=preserve\n`);
  installFixture(home);
  assert.match(readFileSync(config, "utf8"), /AGON_OPERATOR_MARKER=preserve/);
  assert.doesNotMatch(readFileSync(config, "utf8"), /(?:TOKEN|PASSWORD|PRIVATE_KEY)=\S+/);
});

// The installer sources llm-host.env, whose LLM_REMOTE_*_DIR values name paths on
// the Ubuntu box and are used here as LOCAL install targets. On the box that is
// correct; anywhere else it installs outside the caller's HOME. Two suite failures
// came from exactly that, so the override seam is pinned rather than assumed.
test("the install target follows the named env file, not whatever config is on the machine", () => {
  const home = mkdtempSync(join(tmpdir(), "agon-benchmark-envfile-"));
  const target = join(home, "explicit-package-dir");
  const envFile = join(home, "llm-host.env");
  writeFileSync(envFile, `LLM_REMOTE_PACKAGE_DIR=${target}\n`);

  execFileSync("bash", [INSTALLER], {
    encoding: "utf8",
    env: (() => {
      const env = {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        REMOTE_OLLAMA_INSTALL_SYSTEM: "Linux",
        REMOTE_OLLAMA_SKIP_SYSTEMCTL: "1",
        REMOTE_OLLAMA_ENV_FILE: envFile,
      };
      // Ambient LLM_REMOTE_SCRIPTS_DIR from a sourced operator env would still
      // mkdir /home/darren even when the env file overrides only PACKAGE_DIR.
      delete env.LLM_REMOTE_PACKAGE_DIR;
      delete env.LLM_REMOTE_SCRIPTS_DIR;
      delete env.LLM_REMOTE_PROJECT_DIR;
      return env;
    })(),
  });

  assert.equal(existsSync(join(target, "bin/agon-benchmark")), true);
  // And with no env file in scope it falls back to HOME rather than the repo's.
  const bare = mkdtempSync(join(tmpdir(), "agon-benchmark-noenv-"));
  installFixture(bare);
  assert.equal(existsSync(join(bare, "remote-ollama-control/bin/agon-benchmark")), true);
});

// The shim sources this file with `.`, so an unedited config has to be valid
// shell. Bare <placeholder> values are redirects: the operator's first dry-run
// after install died on "syntax error near unexpected token `newline'", which
// says nothing about what actually needs filling in.
test("the installed config is sourceable before the operator edits it", () => {
  const home = mkdtempSync(join(tmpdir(), "agon-benchmark-sourceable-"));
  installFixture(home);
  const config = join(home, ".config/agon-benchmark/benchmark-agent.env");

  // Fails loudly on a syntax error; the shipped file must parse as-is.
  execFileSync("bash", ["-n", config], { encoding: "utf8" });

  // And sourcing it must not leave a placeholder standing in for a real value.
  const exported = execFileSync("bash", ["-c", `set -a; . "${config}"; set +a; env`], { encoding: "utf8" });
  const placeholders = exported.split("\n")
    .filter((line) => /^AGON_BENCHMARK_/.test(line) && /[<>]/.test(line));
  assert.deepEqual(placeholders, [], "a placeholder survived into the environment as a real value");
});

test("systemd timer delegates to one internal lock and runbook documents lifecycle", () => {
  const service = readFileSync(join(TOOL_ROOT, "systemd/agon-benchmark.service"), "utf8");
  const timer = readFileSync(join(TOOL_ROOT, "systemd/agon-benchmark.timer"), "utf8");
  const shim = readFileSync(join(TOOL_ROOT, "bin/agon-benchmark"), "utf8");
  const example = readFileSync(join(TOOL_ROOT, "config/benchmark-agent.env.example"), "utf8");
  const readme = readFileSync(join(TOOL_ROOT, "README.md"), "utf8");
  assert.match(service, /Type=oneshot/);
  assert.match(service, /NoNewPrivileges=true/);
  const profileService = readFileSync(join(TOOL_ROOT, "systemd/ollama-profile@.service"), "utf8");
  assert.match(profileService, /ExecStart=\/usr\/bin\/env \$\{OLLAMA_BIN\} serve/);
  assert.doesNotMatch(service, /^(?:User=root|Group=root)/m);
  assert.match(service, /EnvironmentFile=-%h\/\.config\/agon-benchmark\/benchmark-agent\.env/);
  assert.match(timer, /Unit=agon-benchmark\.service/);
  assert.equal((`${service}\n${timer}\n${shim}`.match(/flock/g) || []).length, 0);
  assert.match(example, /AGON_BENCHMARK_DRY_RUN=1/);
  assert.doesNotMatch(example, /\/Users\/|\/home\/darren|(?:TOKEN|PASSWORD|PRIVATE_KEY)=\S+/);
  assert.notEqual(
    /AGON_BENCHMARK_SOURCE_MIRROR=([^\n]+)/.exec(example)?.[1],
    /AGON_BENCHMARK_STATE_DIR=([^\n]+)/.exec(example)?.[1],
  );
  assert.match(readme, /systemctl --user disable --now agon-benchmark\.timer/);
  assert.match(readme, /systemctl --user enable --now agon-benchmark\.timer/);
});

test("installed dry-run fetches and classifies without state, publication, or GPU execution", () => {
  const home = mkdtempSync(join(tmpdir(), "agon-benchmark-dry-run-"));
  const remote = setupRemote(home);
  installFixture(home);
  const envFile = join(home, ".config/agon-benchmark/benchmark-agent.env");
  writeFileSync(envFile, [
    `AGON_BENCHMARK_SOURCE_REMOTE=${remote}`,
    `AGON_BENCHMARK_RESULTS_REMOTE=${remote}`,
    "AGON_BENCHMARK_SOURCE_REF=main",
    "AGON_BENCHMARK_RESULT_BRANCH=benchmark-results",
    "AGON_BENCHMARK_SCENARIO_HASH=scenario-a",
    "AGON_BENCHMARK_MATRIX_HASH=matrix-a",
    "AGON_BENCHMARK_EXECUTION_SUITE_HASH=execution-a",
    "AGON_BENCHMARK_DRY_RUN=1",
    "",
  ].join("\n"));
  const result = spawnSync(join(home, "bin/agon-benchmark"), [], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "dry_run");
  assert.equal(output.trigger.required, true);
  assert.deepEqual(output.identity, {
    scenarioSetHash: "scenario-a", matrixHash: "matrix-a", executionSuiteHash: "execution-a",
  });
  assert.equal(existsSync(join(home, ".local/state/agon-benchmark/state.json")), false);
  assert.throws(() => git(home, [`--git-dir=${remote}`, "rev-parse", "refs/heads/benchmark-results"]));
  assert.equal(existsSync(join(home, ".local/share/agon-benchmark/source.git")), true);
  assert.equal(existsSync(join(home, ".local/state/agon-benchmark/results-worktree")), false);
});

// ## TODO: Test Permutations
// - installer rejects non-Linux hosts without the explicit fixture override
// - a malformed operator env file fails before cloning or changing state
// - dry-run after an irrelevant commit reports no trigger and leaves poll state untouched
