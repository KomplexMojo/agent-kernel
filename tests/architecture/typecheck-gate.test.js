const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");

/**
 * The typecheck gate, enforced the way this repo enforces its other architectural
 * invariants — as a test, so it cannot rot quietly.
 *
 * WHY THIS EXISTS. Before 2026-08-01 there was no `tsc` or typecheck script at all:
 * `strict: true` sat in tsconfig.json and never ran, so the repo's TypeScript files
 * were never verified by anything. Vitest transpiles and strips types without
 * checking them, so a type error in a `.ts` file would ship silently and a green
 * suite said nothing about it.
 *
 * SCOPE IS DELIBERATELY SMALL. `tsconfig.typecheck.json` covers core-ts and its
 * tests — the code that is genuinely clean under `strict` today. This gate locks in
 * a property the repo HAS rather than announcing one it does not. Widening it is a
 * per-package decision; `pnpm run typecheck:report` prints the cost of each.
 *
 * Known, measured, and NOT in scope: the five real `_shared/*.mts` modules carry
 * 180 type errors between them and leak into every scope that imports them. They
 * are the natural next step, not an oversight.
 */

test("the typecheck gate passes: core-ts is clean under strict", () => {
  const config = resolve(ROOT, "tsconfig.typecheck.json");
  assert.ok(existsSync(config), "tsconfig.typecheck.json must exist — it defines the gate");

  const result = spawnSync("npx", ["tsc", "-p", config], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const errors = output.split("\n").filter((line) => / error TS\d+/.test(line));

  assert.deepEqual(
    errors,
    [],
    `tsc reported ${errors.length} error(s) in the gated scope:\n${errors.slice(0, 20).join("\n")}`,
  );
  assert.equal(result.status, 0, `tsc exited ${result.status}\n${output.slice(0, 2000)}`);
});

test("the gate is not vacuous: it actually has files in its program", () => {
  const config = resolve(ROOT, "tsconfig.typecheck.json");
  const result = spawnSync("npx", ["tsc", "-p", config, "--listFiles"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });

  // A gate whose `include` matches nothing passes trivially. That is not
  // hypothetical: the first version of typecheck-report.mjs put its config in a
  // tmpdir with absolute include patterns, matched almost nothing, and reported
  // "0 errors" for a package that has 7133.
  const projectFiles = `${result.stdout ?? ""}`
    .split("\n")
    .filter((line) => line.startsWith(ROOT) && !line.includes("node_modules"));

  assert.ok(
    projectFiles.length >= 15,
    `the gate should cover the core-ts sources and their tests, saw ${projectFiles.length} file(s)`,
  );
  assert.ok(
    projectFiles.some((f) => f.includes("packages/core-ts/src/index.ts")),
    "core-ts's entry point must be inside the gated program",
  );
});

/**
 * ## TODO: Test Permutations
 *
 * - gate fails when a deliberate type error is introduced into core-ts
 * - gate fails when tsconfig.typecheck.json's include is emptied
 * - report script exits 0 and cleans up its temp config even when tsc errors
 */
