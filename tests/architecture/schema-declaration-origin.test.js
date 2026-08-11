/**
 * M7 (2026-08-08) — every `agent-kernel/*` schema used in production is DECLARED in
 * `contracts/artifacts.ts`.
 *
 * ═══ THE DEFECT THIS EXISTS FOR ═══════════════════════════════════════════════════════════
 * The AdaptiveWorkflow schema cluster was counted three times and was wrong three times:
 *
 *   9  — the milestone spec: counted only `contracts/artifacts.ts`
 *   15 — M6's census: counted only `const X = "agent-kernel/…"` DECLARATIONS
 *   20 — the truth: six schemas had no constant anywhere, only inline literals
 *
 * Twelve of the twenty were declared outside `artifacts.ts`, which the charter forbids for
 * boundary-crossing data, and several were declared TWICE — `AdaptiveWorkflowRuntimeProfile`
 * under a second name (`RUNTIME_PROFILE_SNAPSHOT_SCHEMA`) that PA's census saw and dismissed
 * as a substring false positive without noticing it was a duplicate origin.
 *
 * ⚠️ THIS GUARD MATCHES LITERALS, NOT DECLARATIONS — deliberately, because matching
 * declarations is precisely what let six schemas hide. A schema with no constant is
 * invisible to any instrument that looks for constants.
 *
 * PERTURBATION-VERIFIED 2026-08-08:
 *   - re-add a local `const X = "agent-kernel/AdaptiveWorkflowPlan"`  → DETECTED
 *   - inline a bare `"agent-kernel/Whatever"` literal in a prod file  → DETECTED
 *   - remove a name from KNOWN_OUTSTANDING                            → DETECTED (it is exact)
 *
 * ═══ M8 (2026-08-11) ══════════════════════════════════════════════════════════════════════
 * KNOWN_OUTSTANDING is now EMPTY: the seven schemas M7 enumerated are declared in
 * artifacts.ts and imported at every use site. Two consequences worth being explicit about:
 *
 *   1. The declaration check has no exemptions left, so a new undeclared schema fails on
 *      arrival rather than being added to a list.
 *   2. The retype check was widened from the AdaptiveWorkflow cluster to a named
 *      SINGLE_ORIGIN_SCHEMAS set that includes the seven. Without that widening, M8 would
 *      have been erasable one file at a time by a green suite — every one of its seven would
 *      still pass the declaration check while retyped, which is exactly the hole M7's
 *      perturbation found in its own first guard.
 *
 * PERTURBATION-VERIFIED 2026-08-11 (each in the shape of the defect it prevents):
 *   - retype `"agent-kernel/GameplayBundle"` in core-facade.js       → DETECTED
 *   - re-declare a second `const … = "agent-kernel/GameplayBundle"`  → DETECTED
 *   - add a new undeclared `"agent-kernel/Nonexistent"` literal      → DETECTED
 *   - add a fixed schema back to KNOWN_OUTSTANDING                   → DETECTED
 */
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const REPO = resolve(__dirname, "../..");
const ARTIFACTS = "packages/runtime/src/contracts/artifacts.ts";

/**
 * Production schemas that are STILL declared outside artifacts.ts. Enumerated, not silenced.
 *
 * ✅ EMPTIED BY M8 (2026-08-11). M7 left seven here — the same charter violation as the
 * AdaptiveWorkflow cluster, elsewhere in the tree — and recorded them rather than silencing
 * them precisely so the next census would find a list instead of a search. All seven are now
 * declared in artifacts.ts and imported at every use site.
 *
 * An empty list is the point, not a formality: with nothing exempted, the check below is
 * "every production schema literal is declared centrally", with no escape hatch. Growing this
 * list again requires a deliberate edit to this file and a stated reason.
 */
const KNOWN_OUTSTANDING = Object.freeze([]);

/**
 * Schemas held to SINGLE ORIGIN — declared in artifacts.ts *and* imported, never retyped.
 *
 * ⚠️ THIS IS A DIFFERENT AND STRICTER PROPERTY than "declared in artifacts.ts", and the
 * distinction is the whole reason M7's first guard passed its own defect. A file that writes
 * `"agent-kernel/GameplayBundle"` inline satisfies the declaration check — the schema *is*
 * declared, it simply is not being used from the declaration — while remaining free to drift
 * from it. That is not hypothetical here: before M8, `GAMEPLAY_BUNDLE_SCHEMA` was declared
 * independently in the CLI that writes bundles and in the browser module that reads them.
 *
 * SCOPE: the AdaptiveWorkflow cluster (M7) plus M8's seven. It is deliberately NOT every
 * schema — roughly 200 sites across the tree still retype a centrally declared schema, which
 * is a real backlog and a separate piece of work. What this set guarantees is that schemas
 * someone has already paid to consolidate cannot silently un-consolidate.
 */
const SINGLE_ORIGIN_SCHEMAS = Object.freeze([
  "agent-kernel/ActionSequence",
  "agent-kernel/ActorArtifact",
  "agent-kernel/AffinityRulesArtifact",
  "agent-kernel/GameplayBundle",
  "agent-kernel/LayoutArtifact",
  "agent-kernel/MotivationRulesArtifact",
  "agent-kernel/PoolCatalog",
  "agent-kernel/SelectedStrategy",
  "agent-kernel/BenchmarkEvidence",
  "agent-kernel/ContextBudget",
]);

/** True for a schema held to single origin: the M8 seven, or anything in the M7 cluster. */
function isSingleOrigin(schema) {
  return schema.startsWith("agent-kernel/AdaptiveWorkflow") || SINGLE_ORIGIN_SCHEMAS.includes(schema);
}

/** Files that are production code: shipped packages, excluding tests and fixtures. */
function productionFiles() {
  const out = execFileSync("git", ["ls-files", "packages"], { cwd: REPO, encoding: "utf8" });
  return out
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.includes("node_modules"))
    .filter((f) => /\.(js|mjs|ts|mts)$/.test(f));
}

/** Schema literals on a line, ignoring comment lines — a comment is not a declaration. */
function schemaLiteralsIn(source) {
  const found = new Set();
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    for (const m of line.matchAll(/"(agent-kernel\/[A-Za-z0-9_]+)"/g)) found.add(m[1]);
  }
  return found;
}

test("every production schema literal is declared in contracts/artifacts.ts", () => {
  const artifacts = readFileSync(resolve(REPO, ARTIFACTS), "utf8");
  const declared = schemaLiteralsIn(artifacts);
  assert.ok(declared.size > 30, `artifacts.ts should declare the bulk of the schemas, saw ${declared.size}`);

  const offenders = new Map();
  for (const file of productionFiles()) {
    if (file === ARTIFACTS) continue;
    const source = readFileSync(resolve(REPO, file), "utf8");
    for (const schema of schemaLiteralsIn(source)) {
      if (declared.has(schema)) continue;
      if (KNOWN_OUTSTANDING.includes(schema)) continue;
      if (!offenders.has(schema)) offenders.set(schema, []);
      offenders.get(schema).push(file);
    }
  }

  assert.deepEqual(
    Object.fromEntries(offenders),
    {},
    "these schemas are used in production but not declared in artifacts.ts — declare them "
    + "there and import the constant, or add them to KNOWN_OUTSTANDING with a reason",
  );
});

test("every single-origin schema is declared in exactly one place", () => {
  const declarations = new Map(); // schema -> [file:line]
  for (const file of productionFiles()) {
    const source = readFileSync(resolve(REPO, file), "utf8");
    source.split("\n").forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
      const m = line.match(/const\s+[A-Za-z0-9_]+\s*=\s*"(agent-kernel\/[A-Za-z0-9_]+)"/);
      if (!m) return;
      if (!declarations.has(m[1])) declarations.set(m[1], []);
      declarations.get(m[1]).push(`${file}:${index + 1}`);
    });
  }

  const held = [...declarations.keys()].filter(isSingleOrigin);
  const duplicated = Object.fromEntries(
    held.filter((s) => declarations.get(s).length > 1).map((s) => [s, declarations.get(s)]),
  );

  assert.deepEqual(
    duplicated,
    {},
    "a single-origin schema string is declared in more than one place — a second origin is "
    + "free to drift. The one that hid longest was named RUNTIME_PROFILE_SNAPSHOT_SCHEMA "
    + "(M7); M8's was GAMEPLAY_BUNDLE_SCHEMA, declared once in the CLI that writes bundles "
    + "and once in the browser module that reads them, under the same name",
  );
});

/**
 * ⚠️ THIS TEST EXISTS BECAUSE THE FIRST VERSION OF THIS GUARD DID NOT CATCH ITS OWN DEFECT.
 *
 * Perturbation P2 — replacing `ADAPTIVE_WORKFLOW_PLAN_SCHEMA` in `runner.js` with the bare
 * literal `"agent-kernel/AdaptiveWorkflowPlan"` — PASSED the checks above. They verify a
 * schema is DECLARED centrally; they say nothing about whether a use site imports that
 * declaration or retypes the string. Retyping is the actual defect: it is how six schemas
 * came to have no constant at all, and a "declared in artifacts.ts" check cannot see it
 * because the schema *is* declared — just not used from there.
 *
 * ⇒ *A guard that forbids the wrong spelling of a defect is not a guard.* Scoped to
 * SINGLE_ORIGIN_SCHEMAS — M7's cluster, widened by M8 to include its seven; inline literals
 * elsewhere in the tree are widespread and are not either milestone's to fix.
 */
test("no single-origin schema is retyped as an inline literal outside artifacts.ts", () => {
  const retyped = new Map();
  for (const file of productionFiles()) {
    if (file === ARTIFACTS) continue;
    const source = readFileSync(resolve(REPO, file), "utf8");
    source.split("\n").forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      for (const m of line.matchAll(/"(agent-kernel\/[A-Za-z0-9_]+)"/g)) {
        if (!isSingleOrigin(m[1])) continue;
        if (!retyped.has(m[1])) retyped.set(m[1], []);
        retyped.get(m[1]).push(`${file}:${index + 1}`);
      }
    });
  }

  assert.deepEqual(
    Object.fromEntries(retyped),
    {},
    "a single-origin schema string is written out here instead of imported from "
    + "contracts/artifacts.ts — import the constant; a retyped literal is a second origin "
    + "that no declaration-keyed census can see",
  );
});

test("KNOWN_OUTSTANDING is honest: every entry is still undeclared and still used", () => {
  const declared = schemaLiteralsIn(readFileSync(resolve(REPO, ARTIFACTS), "utf8"));
  const usedInProduction = new Set();
  for (const file of productionFiles()) {
    if (file === ARTIFACTS) continue;
    for (const schema of schemaLiteralsIn(readFileSync(resolve(REPO, file), "utf8"))) {
      usedInProduction.add(schema);
    }
  }

  // A stale allowlist entry is the failure mode this branch has hit repeatedly: the note
  // outlives the thing it described, and nothing reports it.
  //
  // M8 emptied the list, so this assertion is currently vacuous — kept deliberately, because
  // it goes live the moment anyone adds an entry, which is precisely when it is needed.
  const stale = KNOWN_OUTSTANDING.filter((s) => declared.has(s) || !usedInProduction.has(s));
  assert.deepEqual(
    stale,
    [],
    "these KNOWN_OUTSTANDING entries are fixed or gone — remove them from the list",
  );
});

// ## TODO: Test Permutations
