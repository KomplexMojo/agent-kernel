/**
 * On-demand coverage report for packages/core-ts/src.
 *
 * Usage:
 *   node scripts/testing/run-core-ts-coverage.mjs                # run with thresholds
 *   node scripts/testing/run-core-ts-coverage.mjs --no-thresholds  # skip threshold enforcement
 *
 * Runs core-ts and direct core helper tests with V8 coverage enabled and prints a summary.
 * Reports land in coverage/core-ts/ (text, json, html).
 *
 * Thresholds are configured in vitest.config.mjs under test.coverage.thresholds.
 * Current thresholds: statements 85%, branches 80%, functions 90%, lines 85%.
 */

import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess } from "./shared.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const COVERAGE_DIR = resolve(ROOT, "coverage/core-ts");

// Pre-create coverage temp directory to avoid race condition with parallel workers.
mkdirSync(resolve(COVERAGE_DIR, ".tmp"), { recursive: true });

const skipThresholds = process.argv.includes("--no-thresholds");

const args = [
  "exec", "vitest", "run",
  "--config", "vitest.config.mjs",
  "--coverage",
  "--coverage.enabled",
  "tests/core-ts/",
  "tests/bindings/",
  "tests/runtime/mvp-movement.test.js",
  "tests/runtime/actor-proposal-replay.test.js",
  "tests/runtime/affinity-aura-lifecycle.test.js",
  "tests/ui-web/preview-view.test.mjs",
];

if (skipThresholds) {
  args.push(
    "--coverage.thresholds.statements", "0",
    "--coverage.thresholds.branches", "0",
    "--coverage.thresholds.functions", "0",
    "--coverage.thresholds.lines", "0",
  );
}

const result = runProcess("pnpm", args);

if (result.stdout) {
  process.stdout.write(result.stdout);
}
if (result.stderr) {
  process.stderr.write(result.stderr);
}

process.exit(result.status ?? 1);
