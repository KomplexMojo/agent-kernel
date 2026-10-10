// `ak play` hands a level to the terminal UI (packages/ui-ascii) as a separate
// program; these tests run the real CLI.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const AK = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const ak = (args, options = {}) => spawnSync(process.execPath, [AK, ...args], { cwd: ROOT, encoding: "utf8", input: "", ...options });

test("ak play shows an `ak create` out-dir level with its traps, as text or JSON", () => {
  const outDir = mkdtempSync(join(tmpdir(), "ak-play-"));
  try {
    const created = ak([
      "create", "--room", "size=small;count=2",
      "--delver", "count=1;affinity=wind;motivation=exploring",
      "--hazard", "affinity=water;expression=emit;proximityRadius=1;mana=one-time:30",
      "--out-dir", outDir, "--run-id", "ak-play", "--created-at", "2026-10-10T00:00:00.000Z",
    ]);
    assert.equal(created.status, 0, created.stderr);

    const text = ak(["play", "--dir", outDir, "--keys", "."]);
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /Mind the traps \(H\)/);
    assert.match(text.stdout, /Turns 1/);

    const json = ak(["play", "--dir", outDir, "--json"]);
    assert.equal(json.status, 0, json.stderr);
    const payload = JSON.parse(json.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, "play");
    assert.deepEqual(payload.source, { dir: outDir });
    assert.equal(payload.launch, `node packages/adapters-cli/src/cli/ak.mjs play --dir ${outDir}`);
    assert.match(payload.screen, /@/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("ak play takes one level source and refuses unknown flags", () => {
  const two = ak(["play", "--level", "first-steps", "--dir", "x", "--json"]);
  assert.equal(two.status, 1);
  assert.match(two.stderr, /one level source/);
  const bogus = ak(["play", "--bogus"]);
  assert.equal(bogus.status, 1);
  assert.match(bogus.stderr, /does not support: --bogus/);
  const half = ak(["play", "--sim-config", "a.json"]);
  assert.equal(half.status, 1);
  assert.match(half.stderr, /together/);
});

test("ak play with no keys hands the terminal to the UI, which needs one", () => {
  const result = ak(["play", "--level", "first-steps"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /interactive terminal/);
});

// ## TODO: Test Permutations
// - --from-run with each artifacts/runs/<id> stage directory
// - --sim-config/--initial-state with relative paths
// - --color and --no-color passed through in scripted mode
// - --level with an unknown name
