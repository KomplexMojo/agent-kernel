/**
 * No production object literal declares the same key twice.
 *
 * ═══ THE DEFECT THIS EXISTS FOR ═══════════════════════════════════════════════════════════
 * A duplicate key in a JS object literal is not an error. The LAST one silently wins, and
 * the earlier one stays on the page reading exactly like policy.
 *
 * `hazards` was declared twice in FIVE places across three files — four vocabularies in
 * `allocator/incentive-model.js` and `allocator/validate-spend.js`, plus one in the CLI.
 * One story explains all five: hazards used to bill to the ROOMS pool, and when they got
 * their own pool (15% of the dungeon split) the new line was added BELOW the old one
 * instead of replacing it. So `CATEGORY_POOL_IDS.hazards` was written as `"rooms"` and
 * again as `"hazards"`, and the codebase had been running on the second for as long as the
 * pool has existed while the first sat there describing a policy that no longer applied.
 *
 * It surfaced sideways: M9 pulled `contracts/artifacts.ts` into the typecheck gate, and TS
 * DOES flag a duplicate key — but only in an interface (`TS2300`). The same duplication in
 * a union type (`SpendProposalCategory`), in a frozen array, and in every object literal
 * raises nothing at all. ⇒ *One spelling of a defect was compiler-visible and four were
 * not, so finding the visible one said nothing about the rest.* This guard is the census
 * the compiler could not run.
 *
 * ⚠️ PARSES, DOES NOT COUNT BRACES. The first census for this used brace depth and reported
 * 38 hits; 30 were false positives from scopes it never popped. The truth was 8. A count
 * produced by the wrong instrument is not a smaller version of the right answer.
 *
 * ⚠️ GET/SET PAIRS ARE LEGAL AND PRESENT. `ui-web/src/card-builder-controller.js` builds a
 * fake DOM element with `get textContent` + `set textContent`. A guard that flagged those
 * would be reporting correct code, so accessors are keyed by kind. A data property shadowed
 * by an accessor is still a duplicate — that one was real, and is fixed.
 *
 * PERTURBATION-VERIFIED 2026-08-11:
 *   - re-add `hazards: "rooms"` above `hazards: "hazards"`        → DETECTED
 *   - duplicate a key with an IDENTICAL value (the inert shape)   → DETECTED
 *   - add a `get x`/`set x` pair to a literal                     → NOT flagged (correct)
 */
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const REPO = resolve(__dirname, "../..");
const ts = createRequire(`${REPO}/`)("typescript");

function productionFiles() {
  return execFileSync("git", ["ls-files", "packages"], { cwd: REPO, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.includes("node_modules"))
    .filter((f) => /\.(js|mjs|ts|mts)$/.test(f));
}

/**
 * Duplicate keys in one file's object literals.
 *
 * Keys are qualified by ACCESSOR KIND so `get x` and `set x` coexist, which is the whole
 * point of an accessor pair. Everything else — including a data property later shadowed by
 * an accessor — collides.
 */
function duplicateKeysIn(file, source) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found = [];

  const walk = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const seen = new Map();
      for (const prop of node.properties) {
        if (!prop.name) continue;                       // spread elements carry no key
        if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name)) continue;
        const accessor = ts.isGetAccessor(prop) ? "get" : ts.isSetAccessor(prop) ? "set" : "value";
        const key = `${accessor}:${prop.name.text}`;
        const line = sf.getLineAndCharacterOfPosition(prop.getStart(sf)).line + 1;
        if (seen.has(key)) {
          found.push(`${file}:${line} '${prop.name.text}' — already declared at line ${seen.get(key)}`);
        } else {
          seen.set(key, line);
        }
      }
    }
    ts.forEachChild(node, walk);
  };

  walk(sf);
  return found;
}

test("no production object literal declares the same key twice", () => {
  const offenders = [];
  for (const file of productionFiles()) {
    offenders.push(...duplicateKeysIn(file, readFileSync(resolve(REPO, file), "utf8")));
  }

  assert.deepEqual(
    offenders,
    [],
    "a duplicate key in an object literal is silently won by the LAST one, leaving the "
    + "earlier line reading like live policy — delete the dead entry, and check which of "
    + "the two the code has actually been running on before deciding which is dead",
  );
});

/**
 * The guard is only worth its runtime if the parser is really seeing the literals. A file
 * that fails to parse yields zero properties and therefore zero offenders — silently.
 */
test("the parser actually reaches production object literals", () => {
  const files = productionFiles();
  assert.ok(files.length > 200, `expected the full production set, saw ${files.length}`);

  const known = "packages/runtime/src/personas/allocator/incentive-model.js";
  const sf = ts.createSourceFile(known, readFileSync(resolve(REPO, known), "utf8"), ts.ScriptTarget.Latest, true);
  let literals = 0;
  const walk = (n) => { if (ts.isObjectLiteralExpression(n)) literals += 1; ts.forEachChild(n, walk); };
  walk(sf);
  assert.ok(literals > 3, `expected several object literals in ${known}, saw ${literals}`);
});

// ## TODO: Test Permutations
