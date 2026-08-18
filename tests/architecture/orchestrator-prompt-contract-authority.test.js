/**
 * G1 orchestrator/prompt-contracts (A2) — THE NINE, paperwork six, 2026-08-18.
 *
 * `normalizeSummary` and `deriveAllowedOptionsFromCatalog` (`prompt-contract.js`) are
 * published on `controller.js` (CR.7 / WP-5) specifically so glue reaches them through
 * the persona rather than importing the module directly — `controller.js`'s own comment
 * names `ak-impl.mjs`, `kernel.js` and `ui-flow.js` as the three call sites that used to
 * cross the boundary. What no G1 test asked (the roster's `KNOWN_UNREGISTERED` note,
 * verbatim): could production normalize a summary, or derive a prompt's allowed options,
 * without the Orchestrator?
 *
 * Two things make that true today, verified independently rather than assumed:
 *   1. `persona-boundary.test.js` already forbids any importer outside a persona from
 *      reaching a non-public file inside `personas/<name>/` — `prompt-contract.js` is not
 *      in `PUBLIC_BASENAMES` ({controller.js, persona.js, contracts.ts}), so a glue file
 *      importing it directly is already a hard error (allowlist is 0). That guard was
 *      not written for this responsibility, but it already covers it — cited, not
 *      re-derived, and checked directly below as well, because two guards agreeing on
 *      one fact is stronger than one citing the other.
 *   2. Nothing else in the tree defines a second `normalizeSummary` or
 *      `deriveAllowedOptionsFromCatalog` that glue could call instead — checked by
 *      uniqueness, not by trusting the name is only used once.
 *
 * The BEHAVIORAL half — that this normalization is load-bearing, not decorative — already
 * has extensive coverage this entry does not duplicate: `tests/runtime/prompt-contract.test.js`
 * (the validation rules themselves, ~15 cases) and
 * `tests/adapters-cli/ak-llm-plan.test.js` ("cli llm-plan rejects summaries that do not
 * match catalog entries", exercised through the real CLI). This file's job is narrower:
 * prove production cannot reach an equivalent result without this exact code.
 */
const assert = require("node:assert/strict");
const { existsSync, readFileSync, readdirSync, statSync } = require("node:fs");
const { join, relative, sep } = require("node:path");

const ROOT = join(__dirname, "..", "..");
const SCANNED_ROOTS = ["packages", "scripts", "tools"].map((dir) => join(ROOT, dir));
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".mts", ".ts", ".cjs"]);
const SKIPPED = new Set(["node_modules", "dist", "build"]);
const PROMPT_CONTRACT_FILE = "packages/runtime/src/personas/orchestrator/prompt-contract.js";
const GLUE_FACING = ["normalizeSummary", "deriveAllowedOptionsFromCatalog"];

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

for (const fnName of GLUE_FACING) {
  test(`exactly one production definition of ${fnName} exists`, () => {
    const definitions = [];
    for (const file of allSourceFiles()) {
      const rel = relative(ROOT, file).split(sep).join("/");
      const source = readFileSync(file, "utf8");
      if (new RegExp(`export function ${fnName}\\b`).test(source)) {
        definitions.push(rel);
      }
    }
    assert.deepEqual(
      definitions,
      [PROMPT_CONTRACT_FILE],
      `${fnName} must be defined exactly once, in prompt-contract.js. A second definition `
        + "anywhere else is a shadow validator production could call instead of the "
        + "Orchestrator's.",
    );
  });
}

test("no production file outside the Orchestrator persona imports prompt-contract.js directly", () => {
  const offenders = [];
  for (const file of allSourceFiles()) {
    const rel = relative(ROOT, file).split(sep).join("/");
    if (rel.includes("personas/orchestrator/")) continue;
    if (rel.startsWith("tests/")) continue;
    const source = readFileSync(file, "utf8");
    if (/from\s*["'][^"']*prompt-contract\.js["']/.test(source)) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    "a file outside personas/orchestrator/ imports prompt-contract.js directly — it must go "
      + "through the persona.js barrel (persona-boundary.test.js should already forbid this; "
      + "if it doesn't, that guard has a gap this one just found)",
  );
});

test("every production caller of the glue-facing functions imports them from the barrel", () => {
  const offenders = [];
  for (const file of allSourceFiles()) {
    const rel = relative(ROOT, file).split(sep).join("/");
    if (rel.includes("personas/orchestrator/")) continue;
    if (rel.startsWith("tests/")) continue;
    const source = readFileSync(file, "utf8");
    const usesEither = GLUE_FACING.some((fn) => new RegExp(`\\b${fn}\\(`).test(source));
    if (!usesEither) continue;
    const importsFromBarrel = /from\s*["'][^"']*personas\/orchestrator\/persona\.js["']/.test(source);
    if (!importsFromBarrel) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    "a production file calls normalizeSummary or deriveAllowedOptionsFromCatalog without "
      + "importing them from personas/orchestrator/persona.js — either it has its own copy "
      + "or it reaches the module some other way, both of which mean production could "
      + "normalize a summary without the Orchestrator",
  );
});
