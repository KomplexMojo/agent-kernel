// `agon play` hands a level to the terminal UI (packages/ui-ascii) as a separate
// program; these tests run the real CLI.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const AK = resolve(ROOT, "packages/adapters-cli/src/cli/agon.mjs");
const agon = (args, options = {}) => spawnSync(process.execPath, [AK, ...args], { cwd: ROOT, encoding: "utf8", input: "", ...options });

test("agon play shows an `agon create` out-dir level with its traps, as text or JSON", () => {
  const outDir = mkdtempSync(join(tmpdir(), "agon-play-"));
  try {
    const created = agon([
      "create", "--room", "size=small;count=2",
      "--delver", "count=1;affinity=wind;motivation=exploring",
      "--hazard", "affinity=water;expression=emit;proximityRadius=1;mana=one-time:30",
      "--out-dir", outDir, "--run-id", "agon-play", "--created-at", "2026-10-10T00:00:00.000Z",
    ]);
    assert.equal(created.status, 0, created.stderr);

    const text = agon(["play", "--dir", outDir, "--keys", ".", "--no-fog"]);
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /Mind the traps \(☼\)/);
    assert.match(text.stdout, /Turns 1/);

    // Fog of war is on by default: the map starts mostly unseen.
    const fogged = agon(["play", "--dir", outDir, "--keys", ""]);
    assert.equal(fogged.status, 0, fogged.stderr);
    assert.match(fogged.stdout, /\?{5}/);

    const json = agon(["play", "--dir", outDir, "--json"]);
    assert.equal(json.status, 0, json.stderr);
    const payload = JSON.parse(json.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, "play");
    assert.deepEqual(payload.source, { dir: outDir });
    assert.equal(payload.launch, `node packages/adapters-cli/src/cli/agon.mjs play --dir ${outDir}`);
    assert.match(payload.screen, /@/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

// #204: `agon play --record` saves the played commands; `--replay` re-runs them on the same level.
test("agon play records a bundled-level game and replays it to the same result", () => {
  const dir = mkdtempSync(join(tmpdir(), "agon-play-capture-"));
  try {
    const capture = join(dir, "game.json");
    const played = agon(["play", "--level", "first-steps", "--json", "--keys", "dds.", "--record", capture]);
    assert.equal(played.status, 0, played.stderr);
    const replayed = agon(["play", "--json", "--replay", capture]);
    assert.equal(replayed.status, 0, replayed.stderr);
    const strip = ({ ok, level, turns, status, screen }) => ({ ok, level, turns, status, screen });
    assert.deepEqual(strip(JSON.parse(replayed.stdout)), strip(JSON.parse(played.stdout)));
    assert.match(agon(["play", "--level", "first-steps", "--json", "--record"]).stderr, /need a file path/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("agon play takes one level source and refuses unknown flags", () => {
  const two = agon(["play", "--level", "first-steps", "--dir", "x", "--json"]);
  assert.equal(two.status, 1);
  assert.match(two.stderr, /one level source/);
  const bogus = agon(["play", "--bogus"]);
  assert.equal(bogus.status, 1);
  assert.match(bogus.stderr, /does not support: --bogus/);
  const half = agon(["play", "--sim-config", "a.json"]);
  assert.equal(half.status, 1);
  assert.match(half.stderr, /together/);
});

test("agon play with no keys hands the terminal to the UI, which needs one", () => {
  const result = agon(["play", "--level", "first-steps"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /interactive terminal/);
});

// ## TODO: Test Permutations
// - --from-run with each artifacts/runs/<id> stage directory
// - --sim-config/--initial-state with relative paths
// - --color and --no-color passed through in scripted mode
// - --level with an unknown name

// The terminal UI also shows a run `agon run` recorded: `agon play --watch`. This is how
// `agon tick` and the MCP tick tools draw a run too.
test("agon play --watch shows a recorded run tick by tick, as text or JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "agon-play-watch-"));
  try {
    const created = agon([
      "create", "--room", "size=small;count=2",
      "--delver", "count=1;motivation=exploring",
      "--warden", "count=1;affinity=dark;motivation=random",
      "--out-dir", join(dir, "create"), "--run-id", "agon-play-watch", "--created-at", "2026-10-13T00:00:00.000Z",
    ]);
    assert.equal(created.status, 0, created.stderr);
    const ran = agon([
      "run", "--sim-config", join(dir, "create", "sim-config.json"), "--initial-state", join(dir, "create", "initial-state.json"),
      "--ticks", "5", "--out-dir", join(dir, "run"),
    ]);
    assert.equal(ran.status, 0, ran.stderr);

    const first = JSON.parse(agon(["play", "--watch", "--dir", join(dir, "run"), "--json"]).stdout);
    assert.equal(first.ok, true);
    assert.equal(first.watch, true);
    assert.deepEqual([first.tick, first.maxTick], [0, 5]);
    assert.match(first.screen, /Tick 0 of 5/);
    assert.match(first.screen, /W/, "the warden is on the board");
    assert.match(first.screen, /@/, "and so is the delver the HUD follows");

    const last = agon(["play", "--watch", "--dir", join(dir, "run"), "--tick", "5", "--keys", ""]);
    assert.equal(last.status, 0, last.stderr);
    assert.match(last.stdout, /Tick 5 of 5/);
    assert.match(last.stdout, /End of the recorded run/);

    // The run's parent works too: ui-ascii finds the frames under run/ and the level under create/.
    const parent = JSON.parse(agon(["play", "--watch", "--dir", dir, "--tick", "5", "--json"]).stdout);
    assert.equal(parent.screen.split("\n").slice(1).join("\n"), JSON.parse(agon(["play", "--watch", "--dir", join(dir, "run"), "--tick", "5", "--json"]).stdout).screen.split("\n").slice(1).join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("agon play --watch refuses a level source, a bad tick, and --tick without --watch", () => {
  assert.match(agon(["play", "--watch", "--level", "first-steps"]).stderr, /does not take --level/);
  assert.match(agon(["play", "--watch"]).stderr, /takes one run/);
  assert.match(agon(["play", "--watch", "--dir", "x", "--tick", "soon"]).stderr, /whole number/);
  assert.match(agon(["play", "--level", "first-steps", "--tick", "2"]).stderr, /needs --watch/);
  assert.match(agon(["play", "--watch", "--dir", resolve(ROOT, "no-such-run"), "--json"]).stderr, /No recorded run/);
});
