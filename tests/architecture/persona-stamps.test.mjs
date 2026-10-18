// #275: every level artifact carries the persona that produced it. Each persona stamps its
// own output (`personas/_shared/persona-stamp.js`); a command that builds a level around the
// persona leaves another stamp, and this guard fails. Before #275 every artifact carried the
// command's name ("cli-create"), so a skipped persona was invisible in the data.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "vitest";

import { personaStampViolations, REQUIRED_PERSONA_STAMPS } from "../../packages/runtime/src/contracts/persona-stamps.js";

const ROOT = resolve(import.meta.dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const CREATED_AT = "2026-10-17T00:00:00.000Z";
const ak = (args, env = {}) => spawnSync(process.execPath, [CLI, ...args],
  { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env } });
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function judgedArtifacts(dir) {
  return readdirSync(dir).filter((file) => file.endsWith(".json"))
    .map((file) => readJson(join(dir, file)))
    .filter((artifact) => REQUIRED_PERSONA_STAMPS[artifact?.schema]);
}

function assertStamped(dir, label) {
  const artifacts = judgedArtifacts(dir);
  const schemas = new Set(artifacts.map((artifact) => artifact.schema));
  for (const schema of ["agent-kernel/SimConfigArtifact", "agent-kernel/InitialStateArtifact", "agent-kernel/BudgetReceiptArtifact"]) {
    assert.ok(schemas.has(schema), `${label} wrote no ${schema}`);
  }
  assert.deepEqual(personaStampViolations(artifacts), [], `${label}: artifacts not stamped by their persona`);
}

const LEVEL_COMMANDS = [
  ["create", "--room", "size=small;count=1", "--delver", "count=1;id=hero;motivation=user_controlled"],
  ["configure", "--room", "size=small;count=1"],
  ["room-plan", "--room", "size=small;count=1"],
  ["hazard-plan", "--hazard", "affinity=fire;expression=emit;proximityRadius=2"],
  ["resource-plan", "--resource", "permanenceMode=consumable;vital=health;delta=5"],
  ["delver-plan", "--delver", "count=1;motivation=exploring"],
  ["warden-plan", "--warden", "count=1;motivation=stationary"],
  ["configurator", "--level-gen", "tests/fixtures/configurator/level-gen-input-v1-hazard.json",
    "--actors", "tests/fixtures/configurator/actors-v1-affinity-base.json"],
];

test.each(LEVEL_COMMANDS.map((args) => [args[0], args]))("%s stamps each level artifact with its persona", (_name, args) => {
  const dir = mkdtempSync(join(tmpdir(), "persona-stamps-"));
  try {
    const result = ak([...args, "--created-at", CREATED_AT, "--out-dir", dir]);
    assert.equal(result.status, 0, result.stderr);
    assertStamped(dir, args[0]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("build --spec and llm-plan stamp their level artifacts and the Director's plan", () => {
  const dir = mkdtempSync(join(tmpdir(), "persona-stamps-build-"));
  try {
    assert.equal(ak([...LEVEL_COMMANDS[0], "--created-at", CREATED_AT, "--out-dir", join(dir, "create")]).status, 0);
    const spec = readJson(join(dir, "create", "spec.json"));
    writeFileSync(join(dir, "spec.json"), JSON.stringify(spec));
    const built = ak(["build", "--spec", join(dir, "spec.json"), "--out-dir", join(dir, "build")]);
    assert.equal(built.status, 0, built.stderr);
    assertStamped(join(dir, "build"), "build --spec");

    const planned = ak(["llm-plan", "--scenario", "tests/fixtures/e2e/e2e-scenario-v1-basic.json",
      "--model", "fixture", "--fixture", "tests/fixtures/adapters/llm-generate-summary-budget-loop.json",
      "--budget-loop", "--emit-intermediates", "--run-id", "run_stamps", "--created-at", CREATED_AT,
      "--out-dir", join(dir, "llm")], { AK_LLM_LIVE: "1" });
    assert.equal(planned.status, 0, planned.stderr);
    assert.ok(existsSync(join(dir, "llm", "plan.json")));
    assertStamped(join(dir, "llm"), "llm-plan");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("receipts written outside a build are the Allocator's too (sandbox, run overrides)", () => {
  const dir = mkdtempSync(join(tmpdir(), "persona-stamps-receipts-"));
  try {
    const sandbox = ak(["sandbox-create", "--budget", "tests/fixtures/artifacts/budget-artifact-v1-basic.json",
      "--run-id", "sbx", "--created-at", CREATED_AT, "--out-dir", join(dir, "sandbox")]);
    assert.equal(sandbox.status, 0, sandbox.stderr);
    assert.deepEqual(personaStampViolations(judgedArtifacts(join(dir, "sandbox"))), []);

    assert.equal(ak([...LEVEL_COMMANDS[0], "--created-at", CREATED_AT, "--out-dir", join(dir, "level")]).status, 0);
    const run = ak(["run", "--sim-config", join(dir, "level", "sim-config.json"),
      "--initial-state", join(dir, "level", "initial-state.json"), "--ticks", "0",
      "--actor", "extra_1,2,2,delver", "--out-dir", join(dir, "run")]);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readJson(join(dir, "run", "budget-receipt.json")).meta.producedBy, "allocator");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an artifact stamped by glue instead of its persona is a violation", () => {
  const glueReceipt = { schema: "agent-kernel/BudgetReceiptArtifact", meta: { id: "r", producedBy: "cli-create" } };
  assert.deepEqual(personaStampViolations([glueReceipt]),
    [{ schema: "agent-kernel/BudgetReceiptArtifact", id: "r", expected: "allocator", found: "cli-create" }]);
});

// ## TODO: Test Permutations
// - ak scenario stamps its level artifacts and plan.
// - the sandbox bridge compile stamps its level artifacts.
// - a caller-supplied --price-list keeps the caller's stamp (input, not a persona output).
