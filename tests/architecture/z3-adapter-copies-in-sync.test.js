/**
 * The two real-Z3 adapter copies must not drift apart.
 *
 * WHY THERE ARE TWO. `adapters-cli` and `adapters-web` each own their own solver
 * implementation, and this repo has NO internal package.json dependency edges —
 * every cross-package reference is relative-path only. An
 * adapters-web -> adapters-cli import would be a lateral adapter-to-adapter
 * dependency the architecture does not sanction, so Z.5 duplicated the file
 * deliberately and said so in the web copy's header: *"Keep the two files in
 * sync by hand until/unless a shared adapter package is introduced."*
 *
 * WHY THIS GUARD EXISTS. "By hand" was the entire mechanism. Nothing checked it:
 * `tests/runtime/z3-real-adapter-conformance.test.js` imports only the CLI copy,
 * so every behavioral assertion in the repo — conformance, determinism, ranking,
 * and the faction-aware scoring this guard shipped beside — passes while the
 * browser's copy says something else entirely. ⇒ *A duplicate with no equality
 * check is not a duplicate, it is a fork with a comment asking politely.*
 *
 * WHAT IS COMPARED. Everything after each file's leading block comment, byte for
 * byte. The headers legitimately differ — the web copy carries the paragraph
 * explaining the duplication — and only the headers may. Comparing the code
 * rather than a behavior sample is the point: a guard that checked "both export
 * createRealZ3SolverAdapter" would pass against two arbitrarily different
 * rankers, which is the spelling-versus-concept trap this repo keeps re-finding.
 *
 * WHEN THIS FAILS, the fix is to copy the change across — never to relax the
 * comparison. If the duplication is ever replaced by a shared package, delete
 * this file in that diff rather than leaving it asserting something untrue.
 */
"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");

const CLI_COPY = "packages/adapters-cli/src/adapters/z3/index.js";
const WEB_COPY = "packages/adapters-web/src/adapters/z3/index.js";

/**
 * Drop the single leading block comment, which is the only part allowed to
 * differ. Anything else — imports, constants, every line of the ranking — must
 * match exactly.
 */
function bodyOf(relativePath) {
  const source = readFileSync(resolve(ROOT, relativePath), "utf8");
  const end = source.indexOf("*/");
  assert.ok(
    source.trimStart().startsWith("/*") && end !== -1,
    `${relativePath} no longer opens with a block comment, so this guard cannot tell its header `
      + "from its code. Restore the header or rewrite the comparison — do not delete the guard.",
  );
  return source.slice(end + 2).trim();
}

test("the adapters-cli and adapters-web Z3 adapters are identical below their headers", () => {
  assert.equal(
    bodyOf(WEB_COPY),
    bodyOf(CLI_COPY),
    `${WEB_COPY} has drifted from ${CLI_COPY}. These are deliberate copies kept in sync by hand, `
      + "and only the CLI one is exercised by the conformance and scoring suites — so a change "
      + "applied to one of them means the browser and the CLI now decide actor actions "
      + "differently, with every test in the repo still green. Copy the change across.",
  );
});

test("only the CLI copy is covered by the behavioral suites — which is why the guard above exists", () => {
  const conformance = readFileSync(
    resolve(ROOT, "tests/runtime/z3-real-adapter-conformance.test.js"),
    "utf8",
  );
  assert.ok(
    conformance.includes("adapters-cli/src/adapters/z3/index.js"),
    "the conformance suite no longer loads the CLI copy",
  );
  assert.ok(
    !conformance.includes("adapters-web/src/adapters/z3/index.js"),
    "the conformance suite now loads the web copy too. That is an improvement, not a failure — "
      + "update or remove this test to say what the coverage actually is, rather than leaving a "
      + "claim here that has stopped being true.",
  );
});

// ## TODO: Test Permutations
// - a probe copy differing only in whitespace inside a function body: must FAIL (byte comparison)
// - a probe copy differing only in its leading header: must PASS
// - either file missing entirely: fails with a message naming which one
