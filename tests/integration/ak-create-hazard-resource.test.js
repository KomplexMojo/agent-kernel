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

test("ak create --hazard produces hazard artifact and wires levelGen.hazards", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-create-hazard-"));
  runCliOk([
    "create",
    "--hazard",
    "affinity=fire;expression=emit;proximityRadius=2;mana=regen:4:4:1;durability=regen:10:10:0",
    "--run-id",
    "run_hazard_test",
    "--created-at",
    "2026-04-14T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  // Verify spec has levelGen.hazards
  const spec = readJson(join(outDir, "spec.json"));
  const hazards = spec.configurator?.inputs?.levelGen?.hazards;
  assert.ok(Array.isArray(hazards) && hazards.length === 1, "spec.configurator.inputs.levelGen.hazards should have one entry");
  assert.equal(hazards[0].affinity, "fire");
  assert.equal(hazards[0].expression, "emit");
  assert.equal(hazards[0].proximityRadius, 2);
  assert.equal(hazards[0].mana.kind, "regen");
  assert.equal(hazards[0].mana.current, 4);
  assert.equal(hazards[0].mana.max, 4);
  assert.equal(hazards[0].mana.regen, 1);
  assert.equal(hazards[0].durability.kind, "regen");

  // Verify request artifact has hazard object
  const request = spec.authoring?.request;
  assert.ok(request, "spec.authoring.request should be present");
  const hazardReq = request.objects?.find((o) => o.kind === "hazard");
  assert.ok(hazardReq, "request should include a hazard object");
  assert.equal(hazardReq.attributes.affinity, "fire");

  // Verify HazardArtifact file was written
  const hazardArtifactPath = join(outDir, "hazard-1.json");
  assert.ok(existsSync(hazardArtifactPath), "hazard-1.json should exist");

  const hazardArtifact = readJson(hazardArtifactPath);
  assert.equal(hazardArtifact.schema, "agent-kernel/HazardArtifact");
  assert.equal(hazardArtifact.schemaVersion, 1);
  assert.ok(hazardArtifact.meta && typeof hazardArtifact.meta.id === "string", "meta.id should be a string");
  assert.equal(hazardArtifact.meta.runId, "run_hazard_test");
  assert.equal(hazardArtifact.affinity, "fire");
  assert.equal(hazardArtifact.expression, "emit");
  assert.equal(hazardArtifact.proximityRadius, 2);
  assert.equal(hazardArtifact.mana.kind, "regen");
  assert.equal(hazardArtifact.durability.kind, "regen");
});

test("ak create --hazard one-time vitals produces correct artifact", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-create-hazard-onetime-"));
  runCliOk([
    "create",
    "--hazard",
    "affinity=water;expression=pull;proximityRadius=1;mana=one-time:3;durability=one-time:1",
    "--run-id",
    "run_hazard_onetime",
    "--created-at",
    "2026-04-14T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const hazardArtifact = readJson(join(outDir, "hazard-1.json"));
  assert.equal(hazardArtifact.schema, "agent-kernel/HazardArtifact");
  assert.equal(hazardArtifact.affinity, "water");
  assert.equal(hazardArtifact.expression, "pull");
  assert.equal(hazardArtifact.mana.kind, "one-time");
  assert.equal(hazardArtifact.mana.amount, 3);
  assert.equal(hazardArtifact.durability.kind, "one-time");
  assert.equal(hazardArtifact.durability.amount, 1);
});

test("ak create --resource produces resource artifact and wires configurator.inputs.resources", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-create-resource-"));
  runCliOk([
    "create",
    "--resource",
    "tier=permanent;stat=vitalMax;delta=10;dropRate=5",
    "--run-id",
    "run_resource_test",
    "--created-at",
    "2026-04-14T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  // Verify spec has configurator.inputs.resources
  const spec = readJson(join(outDir, "spec.json"));
  const resources = spec.configurator?.inputs?.resources;
  assert.ok(Array.isArray(resources) && resources.length === 1, "spec.configurator.inputs.resources should have one entry");
  assert.equal(resources[0].tier, "permanent");
  assert.equal(resources[0].stat, "vitalMax");
  assert.equal(resources[0].delta, 10);
  assert.equal(resources[0].dropRate, 5);

  // Verify request artifact has resource object
  const request = spec.authoring?.request;
  assert.ok(request, "spec.authoring.request should be present");
  const resourceReq = request.objects?.find((o) => o.kind === "resource");
  assert.ok(resourceReq, "request should include a resource object");
  assert.equal(resourceReq.attributes.tier, "permanent");

  // Verify ResourceArtifact file was written
  const resourceArtifactPath = join(outDir, "resource-1.json");
  assert.ok(existsSync(resourceArtifactPath), "resource-1.json should exist");

  const resourceArtifact = readJson(resourceArtifactPath);
  assert.equal(resourceArtifact.schema, "agent-kernel/ResourceArtifact");
  assert.equal(resourceArtifact.schemaVersion, 1);
  assert.ok(resourceArtifact.meta && typeof resourceArtifact.meta.id === "string", "meta.id should be a string");
  assert.equal(resourceArtifact.meta.runId, "run_resource_test");
  assert.equal(resourceArtifact.tier, "permanent");
  assert.equal(resourceArtifact.stat, "vitalMax");
  assert.equal(resourceArtifact.delta, 10);
  assert.equal(resourceArtifact.dropRate, 5);
});

test("ak create --resource level tier with negative delta is valid", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-create-resource-level-"));
  runCliOk([
    "create",
    "--resource",
    "tier=level;stat=vitalRegen;delta=-2;dropRate=20",
    "--run-id",
    "run_resource_level",
    "--created-at",
    "2026-04-14T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const resourceArtifact = readJson(join(outDir, "resource-1.json"));
  assert.equal(resourceArtifact.schema, "agent-kernel/ResourceArtifact");
  assert.equal(resourceArtifact.tier, "level");
  assert.equal(resourceArtifact.stat, "vitalRegen");
  assert.equal(resourceArtifact.delta, -2);
  assert.equal(resourceArtifact.dropRate, 20);
});

test("ak create --hazard rejects invalid affinity", () => {
  const result = runCli([
    "create",
    "--hazard",
    "affinity=lightning;expression=emit;proximityRadius=1",
  ]);
  assert.notEqual(result.status, 0, "should fail with invalid affinity");
  assert.ok(
    result.stderr.includes("affinity") || result.stdout.includes("affinity"),
    "error should mention affinity",
  );
});

test("ak create --resource rejects invalid tier", () => {
  const result = runCli([
    "create",
    "--resource",
    "tier=epic;stat=vitalMax;delta=5;dropRate=10",
  ]);
  assert.notEqual(result.status, 0, "should fail with invalid tier");
  assert.ok(
    result.stderr.includes("tier") || result.stdout.includes("tier"),
    "error should mention tier",
  );
});

test("ak create --resource rejects missing dropRate", () => {
  const result = runCli([
    "create",
    "--resource",
    "tier=level;stat=vitalMax;delta=5",
  ]);
  assert.notEqual(result.status, 0, "should fail with missing dropRate");
  assert.ok(
    result.stderr.includes("dropRate") || result.stdout.includes("dropRate"),
    "error should mention dropRate",
  );
});
