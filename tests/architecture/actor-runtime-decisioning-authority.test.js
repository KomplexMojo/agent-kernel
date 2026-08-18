/**
 * G1 actor/runtime-decisioning (A2) — THE NINE, paperwork six, 2026-08-18.
 *
 * ⚠️ **CORRECTED MID-INVESTIGATION.** The roster's `KNOWN_UNREGISTERED` note reads
 * "the runtime-decisioning path has tests but no ownership entry" — true, but the wrong
 * shape was assumed going in. `personas/actor/constraint-problems.js` (the §Z.2 solver
 * module — `buildActionSelectionProblem`, `resolveActionFromConstraintResult`) is
 * imported and re-exported on the Actor's persona surface, but `find_referencing_symbols`
 * shows NEITHER function has any OTHER caller anywhere in the tree — not even inside
 * `controller.js` itself. The comment beside that re-export says it exists so a caller
 * can "reach it through the persona rather than the module... a builder nothing can call
 * is the same 'published with no path' defect this program spent the session removing" —
 * and it happened anyway, one layer further out: reachable, but reached by nothing. The
 * same shape holds for the Allocator's `buildBudgetFitProblem` (checked directly, not
 * assumed): only a barrel re-export and its own test call it.
 *
 * WHAT ACTUALLY RUNS: a separate, older module, `personas/_shared/runtime-decision.mts`
 * (predates §Z.2 — no `Z.2` marker on it, unlike constraint-problems.js). Its
 * `buildRuntimeDecisionEnvelope` is what `actor/controller.js` really calls to pose a
 * problem, and its `resolveActionFromSolverResult` is what
 * `_shared/tick-orchestrator.mts`'s `handleSolverRequests` really calls to resolve one —
 * proven end-to-end with a real Z3 adapter by `tests/runtime/complex-motivation-z3.test.js`,
 * not reproven here. Two complete, parallel implementations of "pose and resolve a
 * runtime-decision problem" exist; only one is wired. This entry owns the one that runs.
 * The dead one is `§POST-AM/Z`'s new finding, not fixed here — see Plan.md.
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

test("constraint-problems.js's action-selection builder and resolver remain genuinely unwired (documents the parked finding, does not fix it)", () => {
  const offenders = [];
  for (const file of allSourceFiles()) {
    const rel = relative(ROOT, file).split(sep).join("/");
    if (rel.includes("personas/actor/constraint-problems.js")) continue;
    if (rel.includes("personas/actor/controller.js")) continue; // the import + re-export
    const source = readFileSync(file, "utf8");
    if (
      /\bbuildActionSelectionProblem\(/.test(source)
      || /\bresolveActionFromConstraintResult\(/.test(source)
    ) {
      offenders.push(rel);
    }
  }
  // ⚠️ This assertion is INVERTED from every other guard in this file: if it ever starts
  // failing, that means someone wired the §Z.2 builder into production — which is GOOD
  // news, not a regression. When that happens, delete this test and register the change
  // in Plan.md rather than treating a passing run here as the goal.
  assert.deepEqual(
    offenders,
    [],
    "constraint-problems.js's action-selection functions gained a real caller — update "
      + "this entry's `why` and Plan.md's parked finding, this test's premise is now stale",
  );
});
