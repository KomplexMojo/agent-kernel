/**
 * CR.4 M1 — the LLM call-site inventory, pinned mechanically.
 *
 * WHY THIS EXISTS. CR.4's caller list has been wrong three times:
 *   1. Codex's original list named three importers and missed `adaptive-workflow/llm-seams.js`.
 *   2. The corrected finding recorded "four importers, eight call sites".
 *   3. The truth (2026-08-07) is **12 call sites across 5 files**, and the fifth file is
 *      `personas/orchestrator/llm-budget-loop.js` itself — `runLlmBudgetLoop` calls
 *      `runLlmSession` TWICE, internally. They are not peers: the loop WRAPS the session,
 *      and stacks its own repair session (llm-budget-loop.js:876) on top of the session's
 *      own retry+repair ladder.
 *
 * Every one of those corrections came from someone re-deriving the list by hand. That is
 * the same defect this branch keeps hitting in other forms — an inventory that nothing
 * verifies goes stale silently, exactly like the disposition row that survived CR.9's
 * closure because no gate checked it.
 *
 * So the inventory is a test. M4 and M5 migrate these call sites; if a new one appears (or
 * a migration removes one) this fails and the milestone scope is re-derived deliberately
 * instead of being discovered halfway through. **When you migrate a site, update EXPECTED
 * in the same diff** — that is the point, not an inconvenience.
 */
const assert = require("node:assert/strict");
const { readFileSync, readdirSync, statSync } = require("node:fs");
const { join, relative, sep } = require("node:path");

const ROOT = join(__dirname, "..", "..");
const PACKAGES = join(ROOT, "packages");
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".mts", ".ts", ".cjs"]);
const SKIPPED = new Set(["node_modules", "dist", "build"]);

/**
 * The inventory, as of 2026-08-07. Values are call counts, not line numbers: line
 * numbers churn on every edit and would make this a maintenance tax rather than a gate.
 */
const EXPECTED = Object.freeze({
  // M4b MIGRATED kernel's 2 runLlmSession sites to `commands/llm-host.js`, which drives
  // the Orchestrator round and dispatches its effects. The runLlmBudgetLoop site remains:
  // it cannot move until the loop itself is inverted, because the loop WRAPS the session.
  "packages/runtime/src/commands/kernel.js": { runLlmSession: 0, runLlmBudgetLoop: 1 },
  "packages/adapters-cli/src/cli/ak-impl.mjs": { runLlmSession: 2, runLlmBudgetLoop: 1 },
  "packages/ui-web/src/design-guidance.js": { runLlmSession: 1, runLlmBudgetLoop: 1 },
  "packages/runtime/src/adaptive-workflow/llm-seams.js": { runLlmSession: 1, runLlmBudgetLoop: 1 },
  // The one no revision of CR.4 recorded: the persona's own loop drives its own session.
  "packages/runtime/src/personas/orchestrator/llm-budget-loop.js": { runLlmSession: 2, runLlmBudgetLoop: 0 },
});

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

function countCalls(source, name) {
  return source.split(`await ${name}(`).length - 1;
}

function actualInventory() {
  const inventory = {};
  for (const file of sourceFiles(PACKAGES)) {
    const source = readFileSync(file, "utf8");
    const runLlmSession = countCalls(source, "runLlmSession");
    const runLlmBudgetLoop = countCalls(source, "runLlmBudgetLoop");
    if (runLlmSession === 0 && runLlmBudgetLoop === 0) continue;
    inventory[relative(ROOT, file).split(sep).join("/")] = { runLlmSession, runLlmBudgetLoop };
  }
  return inventory;
}

test("CR.4's LLM call-site inventory matches the tree", () => {
  assert.deepEqual(
    actualInventory(),
    EXPECTED,
    "The LLM call sites CR.4 must migrate have changed. This list has been wrong three "
    + "times already — re-derive it, update EXPECTED in this diff, and re-scope the "
    + "milestone rather than discovering it mid-migration.",
  );
});

test("the totals CR.4 is scoped against: 10 call sites left across 5 files", () => {
  const inventory = actualInventory();
  const total = Object.values(inventory)
    .reduce((sum, f) => sum + f.runLlmSession + f.runLlmBudgetLoop, 0);

  assert.equal(Object.keys(inventory).length, 5, "five files, not the recorded four");
  assert.equal(total, 10, "12 at M1, minus the 2 kernel sites migrated at M4b");
});

test("the loop wraps the session — this layering is why the inversion is two-layer", () => {
  const inventory = actualInventory();
  const loop = inventory["packages/runtime/src/personas/orchestrator/llm-budget-loop.js"];

  assert.ok(loop, "llm-budget-loop.js must be in the inventory; it is a caller, not just a peer");
  assert.equal(
    loop.runLlmSession,
    2,
    "runLlmBudgetLoop drives runLlmSession itself (primary + its own repair session), so it "
    + "cannot simply become a caller of the new entry point — it is IO-triggering in its own right",
  );
});

// ## TODO: Test Permutations
// - assert no NEW module imports llm-session.js/llm-budget-loop.js outside the inventory
// - after M3, assert the effect-based entry point's call sites grow as these shrink
