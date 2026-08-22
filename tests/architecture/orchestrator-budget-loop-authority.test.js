/**
 * G1 orchestrator/budget-loops (A2) — THE NINE, paperwork six, 2026-08-18.
 *
 * `runLlmBudgetLoop` (`personas/orchestrator/llm-budget-loop.js`) is a free function: no
 * IO of its own, no persona state. Its A5 standing is already settled by
 * `orchestrator/llm-session`'s registry entry — the loop performs no LLM IO directly, it
 * takes an injected `runSession`. What that entry does NOT answer, and what the roster's
 * `KNOWN_UNREGISTERED` note names directly, is A2: **could production run the loop
 * without the Orchestrator?**
 *
 * The loop cannot answer that about itself — `runSession` is just a required callback
 * slot (`tests/personas/orchestrator/orchestrator-llm-budget-loop.test.js` already proves
 * the loop REFUSES to run without one). Whether that slot is ALWAYS filled with an
 * Orchestrator-backed implementation is a fact about production wiring, not about the
 * loop's own code — so it has to be checked at every call site, the same shape as CR.4's
 * inventory for `runLlmSession` itself.
 *
 * Derived independently of `cr4-llm-call-site-inventory.test.js` rather than importing
 * its table — two guards deriving the same fact from the tree and agreeing is stronger
 * than one hand-copying the other's list, which is exactly the second-origin rot this
 * tree has recorded four times elsewhere.
 */
const assert = require("node:assert/strict");
const { existsSync, readFileSync, readdirSync, statSync } = require("node:fs");
const { join, relative, sep } = require("node:path");

const ROOT = join(__dirname, "..", "..");
const SCANNED_ROOTS = ["packages", "scripts", "tools"].map((dir) => join(ROOT, dir));
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".mts", ".ts", ".cjs"]);
const SKIPPED = new Set(["node_modules", "dist", "build"]);
const LLM_HOST_CANONICAL = "packages/runtime/src/commands/llm-host.js";

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

/** Every production file that calls `runLlmBudgetLoop(`, excluding the loop's own file and tests. */
function callSites() {
  const files = SCANNED_ROOTS.filter((dir) => existsSync(dir)).flatMap((dir) => sourceFiles(dir));
  const sites = [];
  for (const file of files) {
    const rel = relative(ROOT, file).split(sep).join("/");
    if (rel.endsWith("personas/orchestrator/llm-budget-loop.js")) continue;
    const source = readFileSync(file, "utf8");
    if (source.includes("runLlmBudgetLoop(")) sites.push({ rel, source });
  }
  return sites;
}

test("production has at least one call site — the guard below would be vacuous otherwise", () => {
  assert.ok(callSites().length > 0, "no production caller of runLlmBudgetLoop found; re-derive this guard");
});

test("every production call site threads runSession from the canonical Orchestrator-backed host", () => {
  const offenders = [];
  for (const { rel, source } of callSites()) {
    const importsCanonicalHost = new RegExp(
      `import\\s*\\{[^}]*\\brunLlmSessionHosted\\b[^}]*\\}\\s*from\\s*["'][^"']*llm-host\\.js["']`,
    ).test(source);
    const wiresRunSession = /runSession\s*:\s*runLlmSessionHosted\b/.test(source);
    if (!importsCanonicalHost || !wiresRunSession) {
      offenders.push({ rel, importsCanonicalHost, wiresRunSession });
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "a production caller of runLlmBudgetLoop does not thread runSession from the canonical "
      + `${LLM_HOST_CANONICAL} — either it supplies its own session runner (bypassing the `
      + "Orchestrator) or it imports runLlmSessionHosted from somewhere else. Either one means "
      + "production COULD run the loop without the persona.",
  );
});

test("the canonical host itself drives an Orchestrator round, not a second implementation", () => {
  const source = readFileSync(join(ROOT, LLM_HOST_CANONICAL), "utf8");
  assert.match(
    source,
    /import\s*\{[^}]*\bcreateOrchestratorPersona\b[^}]*\}\s*from\s*["'][^"']*personas\/orchestrator\/persona\.js["']/,
    "commands/llm-host.js must import the real Orchestrator persona factory",
  );
  assert.match(
    source,
    /createOrchestratorPersona\(/,
    "commands/llm-host.js must construct a real Orchestrator persona, not stand in for one",
  );
  assert.match(
    source,
    /\.llm\.beginRound\(/,
    "commands/llm-host.js must drive the round through the persona's own llm.beginRound seam",
  );
});
