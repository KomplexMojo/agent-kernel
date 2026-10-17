// #280: every build path validates and locks through the Configurator and carries the
// Director's round. The Configurator's validate/lock used to run only in create/configure,
// and llm-plan dropped the round it opened, rebuilding a plan from the finished spec.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "vitest";

import { orchestrateBuild } from "../../packages/runtime/src/build/orchestrate-build.js";

const ROOT = resolve(import.meta.dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const ak = (args, env = {}) => spawnSync(process.execPath, [CLI, ...args],
  { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env } });

// Rooms whose minimum size exceeds their maximum: the layout generator clamps this silently,
// the Configurator's validation refuses it.
const INVERTED_ROOMS = { roomCount: 1, roomMinSize: 4, roomMaxSize: 3, corridorWidth: 1 };

test("orchestrateBuild refuses a config the Configurator rejects, whatever the caller", async () => {
  const spec = readJson(resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-configurator.json"));
  spec.configurator.inputs.levelGen = { ...spec.configurator.inputs.levelGen, shape: INVERTED_ROOMS };
  await assert.rejects(orchestrateBuild({ spec, producedBy: "test" }), /roomMinSize|roomMaxSize/);
});

test("ak build --spec refuses a config the Configurator rejects", () => {
  const dir = mkdtempSync(join(tmpdir(), "build-persona-rounds-"));
  try {
    const spec = readJson(resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-configurator.json"));
    spec.configurator.inputs.levelGen = { ...spec.configurator.inputs.levelGen, shape: INVERTED_ROOMS };
    writeFileSync(join(dir, "spec.json"), JSON.stringify(spec));
    const result = ak(["build", "--spec", join(dir, "spec.json"), "--out-dir", join(dir, "out")]);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /roomMinSize|roomMaxSize/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ak configurator refuses a level-gen input the Configurator rejects", () => {
  const dir = mkdtempSync(join(tmpdir(), "build-persona-rounds-cfg-"));
  try {
    const levelGen = readJson(resolve(ROOT, "tests/fixtures/configurator/level-gen-input-v1-hazard.json"));
    levelGen.shape = INVERTED_ROOMS;
    writeFileSync(join(dir, "level-gen.json"), JSON.stringify(levelGen));
    const result = ak(["configurator", "--level-gen", join(dir, "level-gen.json"),
      "--actors", "tests/fixtures/configurator/actors-v1-affinity-base.json", "--out-dir", join(dir, "out")]);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /roomMinSize|roomMaxSize/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ak llm-plan persists the plan its own Director round drafted", () => {
  const dir = mkdtempSync(join(tmpdir(), "build-persona-rounds-llm-"));
  try {
    const result = ak(["llm-plan", "--scenario", "tests/fixtures/e2e/e2e-scenario-v1-basic.json",
      "--model", "fixture", "--fixture", "tests/fixtures/adapters/llm-generate-summary-budget-loop.json",
      "--budget-loop", "--emit-intermediates", "--run-id", "run_round", "--created-at", "2025-01-01T00:00:00Z",
      "--out-dir", dir], { AK_LLM_LIVE: "1" });
    assert.equal(result.status, 0, result.stderr);
    const intent = readJson(join(dir, "intent.json"));
    const plan = readJson(join(dir, "plan.json"));
    // The round's IntentEnvelope is synthesized at the CLI boundary (source "cli"); a
    // reconstruction from the finished spec carries the spec's source instead.
    assert.equal(intent.source, "cli");
    assert.equal(plan.intentRef.id, intent.meta.id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ## TODO: Test Permutations
// - sandbox bridge compile refuses a config the Configurator rejects.
// - each *-plan command refuses an inverted room shape.
// - ak scenario persists its Director round's plan.
