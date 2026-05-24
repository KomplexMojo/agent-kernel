import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT_PATH = resolve(ROOT, "scripts/testing/run-core-ts-coverage.mjs");
const COVERAGE_DIR = resolve(ROOT, "coverage/core-ts");

test("coverage script exists and is loadable", () => {
  assert.ok(existsSync(SCRIPT_PATH), "run-core-ts-coverage.mjs must exist");
});

test("vitest.config.mjs has coverage configuration for core-ts", async () => {
  const configText = readFileSync(resolve(ROOT, "vitest.config.mjs"), "utf8");
  assert.ok(configText.includes("packages/core-ts/src/**/*.ts"), "coverage include must target core-ts");
  assert.ok(configText.includes("provider: \"v8\""), "coverage provider must be v8");
  assert.ok(configText.includes("coverage/core-ts"), "reportsDirectory must point to coverage/core-ts");
});

test("coverage script runs and produces a report", () => {
  // Clean up any prior coverage output
  rmSync(COVERAGE_DIR, { recursive: true, force: true });

  const result = spawnSync("node", [SCRIPT_PATH, "--no-thresholds"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 120_000,
  });

  assert.equal(result.status, 0, `coverage script must exit 0, stderr: ${(result.stderr || "").slice(0, 500)}`);
  assert.ok(existsSync(resolve(COVERAGE_DIR, "coverage-summary.json")), "must produce coverage-summary.json");
});

test("coverage summary contains core-ts source entries", () => {
  const summaryPath = resolve(COVERAGE_DIR, "coverage-summary.json");
  if (!existsSync(summaryPath)) {
    assert.fail("coverage-summary.json missing — run the coverage report first");
  }

  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  assert.ok(summary.total, "summary must have a total entry");
  assert.ok(summary.total.statements, "total must include statements");
  assert.ok(summary.total.branches, "total must include branches");
  assert.ok(summary.total.functions, "total must include functions");
  assert.ok(summary.total.lines, "total must include lines");

  // At least one core-ts source file must appear
  const coreFiles = Object.keys(summary).filter((key) => key.includes("packages/core-ts/src/"));
  assert.ok(coreFiles.length > 0, "summary must include core-ts source files");
});

test("package.json has test:coverage:core-ts script", () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
  assert.ok(pkg.scripts["test:coverage:core-ts"], "test:coverage:core-ts script must be defined");
  assert.ok(
    pkg.scripts["test:coverage:core-ts"].includes("run-core-ts-coverage.mjs"),
    "script must invoke run-core-ts-coverage.mjs",
  );
});
