/**
 * G1 actor/runtime-decisioning (A2) — THE NINE, paperwork six, 2026-08-18.
 *
 * ⚠️ **CORRECTED MID-INVESTIGATION, THEN THE CORRECTION WAS RESOLVED.** The roster's
 * `KNOWN_UNREGISTERED` note reads "the runtime-decisioning path has tests but no
 * ownership entry" — true, but the wrong shape was assumed going in. §Z.2's
 * `constraint-problems.js` (one per persona — Actor's `buildActionSelectionProblem` /
 * `resolveActionFromConstraintResult`, Allocator's `buildBudgetFitProblem` /
 * `resolveSelectionFromConstraintResult`, Configurator's `buildSatisfiabilityProblem` /
 * `resolveSatisfiabilityFromConstraintResult`) was imported and re-exported on each
 * persona's surface, but `find_referencing_symbols` showed NONE of the six functions had
 * any caller anywhere in the tree beyond their own barrel re-export and their own test
 * file — not even inside their own controller. The comment beside the Actor's re-export
 * said it existed so a caller could "reach it through the persona rather than the
 * module... a builder nothing can call is the same 'published with no path' defect this
 * program spent the session removing" — and it happened anyway, one layer further out:
 * reachable, but reached by nothing.
 *
 * WHAT ACTUALLY RUNS: a separate, older module, `personas/_shared/runtime-decision.mts`
 * (predates §Z.2 — no `Z.2` marker on it, unlike constraint-problems.js). Its
 * `buildRuntimeDecisionEnvelope` is what `actor/controller.js` really calls to pose a
 * problem, and its `resolveActionFromSolverResult` is what
 * `_shared/tick-orchestrator.mts`'s `handleSolverRequests` really calls to resolve one —
 * proven end-to-end through the solver adapter by `tests/runtime/complex-motivation-z3.test.js`,
 * not reproven here. This entry owns the one that runs.
 *
 * **RULED 2026-08-18: DELETE** (`local-codex/Plan.md` §POST-AM/Z) — the maintainer asked
 * directly for the ruling ("rule on constraint-problems.js: delete, wire-in, or leave");
 * this is that ruling, with the investigation below as its basis. Two complete, parallel
 * implementations of "pose and resolve a runtime-decision problem" existed; only one was
 * ever wired, and the unwired one had zero production callers
 * across all three personas (re-verified fresh for the Configurator, which the original
 * finding had flagged but not individually checked). `constraint-problems.js` is deleted
 * in all three personas, along with its dedicated 9-test suite
 * (`tests/runtime/constraint-problem-builders.test.js`) and its barrel re-exports. The
 * §Z.2 schema layer (`contracts/constraint-problem.js` — `buildConstraintProblem`,
 * `validateConstraintProblem`, `CONSTRAINT_DOMAIN_OWNERS`) is untouched: it has its own,
 * fully independent test coverage (`tests/runtime/solver-constraint-framework.test.js`)
 * that never referenced the deleted persona-level builders.
 */
const assert = require("node:assert/strict");
const { existsSync, readFileSync, readdirSync, statSync } = require("node:fs");
const { join, relative, sep } = require("node:path");

const ROOT = join(__dirname, "..", "..");
const SCANNED_ROOTS = ["packages"].map((dir) => join(ROOT, dir));
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".mts", ".ts", ".cjs"]);
const SKIPPED = new Set(["node_modules", "dist", "build"]);
const RUNTIME_DECISION_FILE = "packages/runtime/src/personas/_shared/runtime-decision.mts";
const TICK_ORCHESTRATOR_FILE = "packages/runtime/src/personas/_shared/tick-orchestrator.mts";

function sourceFiles(directory, found = []) {
  for (const entry of readdirSync(directory)) {
    if (SKIPPED.has(entry)) continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
    } else if (SOURCE_EXTENSIONS.has(entry.slice(entry.lastIndexOf(".")))) {
      found.push(full);
    }
  }
  return found;
}

function allSourceFiles() {
  return SCANNED_ROOTS.filter((dir) => existsSync(dir)).flatMap((dir) => sourceFiles(dir));
}

test("resolveActionFromSolverResult is called only from the canonical tick orchestrator", () => {
  const callers = [];
  for (const file of allSourceFiles()) {
    const rel = relative(ROOT, file).split(sep).join("/");
    if (rel === RUNTIME_DECISION_FILE) continue;
    const source = readFileSync(file, "utf8");
    if (/\bresolveActionFromSolverResult\(/.test(source)) callers.push(rel);
  }
  assert.deepEqual(
    callers,
    [TICK_ORCHESTRATOR_FILE],
    "resolveActionFromSolverResult must be called from exactly the canonical tick "
      + "orchestrator — a caller anywhere else is a second resolution path",
  );
  const source = readFileSync(join(ROOT, TICK_ORCHESTRATOR_FILE), "utf8");
  assert.match(
    source,
    /from\s*["']\.\/runtime-decision\.mts["']/,
    "the tick orchestrator must import resolveActionFromSolverResult from the canonical "
      + "_shared/runtime-decision.mts, not a copy",
  );
});

test("the Actor's real posing path calls buildRuntimeDecisionEnvelope, not the unwired constraint-problems.js builder", () => {
  const controllerPath = join(
    ROOT,
    "packages/runtime/src/personas/actor/controller.js",
  );
  const source = readFileSync(controllerPath, "utf8");
  assert.match(
    source,
    /buildRuntimeDecisionEnvelope\(/,
    "actor/controller.js must call buildRuntimeDecisionEnvelope to pose a runtime-decision "
      + "problem",
  );
});

test("constraint-problems.js does not exist in any persona (deleted 2026-08-18, not reintroduced)", () => {
  const CONSTRAINT_PROBLEMS_FILES = [
    "packages/runtime/src/personas/actor/constraint-problems.js",
    "packages/runtime/src/personas/allocator/constraint-problems.js",
    "packages/runtime/src/personas/configurator/constraint-problems.js",
  ];
  const reintroduced = CONSTRAINT_PROBLEMS_FILES.filter((rel) => existsSync(join(ROOT, rel)));
  assert.deepEqual(
    reintroduced,
    [],
    "constraint-problems.js was deleted as a superseded, never-wired parallel "
      + "implementation of runtime-decisioning (see the file header) — its reappearance "
      + "needs the same maintainer ruling that deleted it, not a silent reintroduction",
  );

  // The Z.2 schema layer is a SEPARATE, still-live module and must not be caught by this
  // guard — only the persona-level builder/resolver pairs were ruled dead.
  assert.ok(
    existsSync(join(ROOT, "packages/runtime/src/contracts/constraint-problem.js")),
    "precondition: the schema layer must still exist — this guard is not the one that "
      + "would catch its removal",
  );
});
