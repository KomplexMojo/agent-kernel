const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

function runCliOk(args) {
  const result = runCli(args);
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`CLI failed (${result.status}): ${output}`);
  }
  return result;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

test("cli help documents generic create and configure authoring commands", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /\bcreate\b/);
  assert.match(result.stdout, /\bconfigure\b/);
  assert.match(result.stdout, /--floor-tile/);
  assert.match(result.stdout, /--trap/);
});

test("cli create authors a multi-object scene and writes an agent request artifact", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-create-authoring-"));
  runCliOk([
    "create",
    "--text",
    "Create a fire room with a trap, one delver, and one warden.",
    "--room",
    "size=large;count=1;affinities=fire:emit:3",
    "--floor-tile",
    "count=18",
    "--trap",
    "id=trap_fire;x=2;y=2;affinity=fire;expression=push;stacks=2;blocking=false;vitals=mana:3:1,durability:4:0",
    "--delver",
    "id=ember_delver;count=1;affinity=fire;motivation=attacking;setup-mode=user",
    "--warden",
    "id=ember_warden;count=1;affinity=fire;motivation=defending",
    "--run-id",
    "run_create_authoring",
    "--created-at",
    "2026-04-08T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  assert.equal(existsSync(join(outDir, "request.json")), true);
  assert.equal(existsSync(join(outDir, "spec.json")), true);
  assert.equal(existsSync(join(outDir, "sim-config.json")), true);
  assert.equal(existsSync(join(outDir, "initial-state.json")), true);

  const request = readJson(join(outDir, "request.json"));
  const spec = readJson(join(outDir, "spec.json"));
  const simConfig = readJson(join(outDir, "sim-config.json"));
  const manifest = readJson(join(outDir, "manifest.json"));

  assert.equal(request.schema, "agent-kernel/AgentCommandRequestArtifact");
  assert.equal(request.command.action, "author");
  assert.equal(request.command.text, "Create a fire room with a trap, one delver, and one warden.");
  assert.deepEqual(
    request.objects.map((entry) => entry.kind),
    ["room", "floor_tile", "trap", "delver", "warden", "shared_config"],
  );

  assert.deepEqual(spec.authoring.objectKinds, ["room", "floor_tile", "trap", "delver", "warden", "shared_config"]);
  assert.equal(spec.configurator.inputs.levelGen.walkableTilesTarget, 18);
  assert.equal(spec.configurator.inputs.levelGen.traps.length, 1);
  assert.equal(spec.configurator.inputs.levelGen.traps[0].id, "trap_fire");

  assert.ok(Array.isArray(simConfig.layout.data.traps));
  assert.ok(simConfig.layout.data.traps.some((entry) => (
    entry.x === 2
    && entry.y === 2
    && entry.affinity?.kind === "fire"
    && entry.affinity?.expression === "push"
    && entry.affinity?.stacks === 2
  )));
  assert.ok(manifest.artifacts.some((entry) => entry.path === "request.json" && entry.schema === "agent-kernel/AgentCommandRequestArtifact"));
});

test("cli configure preserves generic parsing but records configure action", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-configure-authoring-"));
  runCliOk([
    "configure",
    "--text",
    "Configure the existing trap layout for a fire room.",
    "--room",
    "size=small;count=1",
    "--trap",
    "id=trap_fire;x=1;y=1;affinity=fire;expression=emit;stacks=1",
    "--run-id",
    "run_configure_authoring",
    "--created-at",
    "2026-04-08T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const request = readJson(join(outDir, "request.json"));
  const spec = readJson(join(outDir, "spec.json"));
  assert.equal(request.command.action, "configure");
  assert.equal(spec.authoring.request.command.action, "configure");
  assert.ok(spec.authoring.objectKinds.includes("trap"));
});

test("cli create rejects invalid trap expressions deterministically", () => {
  const result = runCli([
    "create",
    "--trap",
    "x=1;y=1;affinity=fire;expression=explode",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /trap\[1\] expression must be one of/i);
});
