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
 * M7's approved scope was the AdaptiveWorkflow cluster. These seven are the same charter
 * violation elsewhere in the tree and were deliberately left alone — recorded here so the
 * debt is visible and counted rather than rediscovered by the next census. Shrinking this
 * list is the follow-up; growing it requires a deliberate edit to this file.
 */
const KNOWN_OUTSTANDING = Object.freeze([
  "agent-kernel/ActionSequence",
  "agent-kernel/ActorArtifact",
  "agent-kernel/AffinityRulesArtifact",
  "agent-kernel/GameplayBundle",
  "agent-kernel/LayoutArtifact",
  "agent-kernel/MotivationRulesArtifact",
  "agent-kernel/PoolCatalog",
]);

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

test("the AdaptiveWorkflow cluster has exactly one origin per schema", () => {
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

  const cluster = [...declarations.keys()].filter((s) => (
    s.startsWith("agent-kernel/AdaptiveWorkflow")
    || ["agent-kernel/SelectedStrategy", "agent-kernel/BenchmarkEvidence", "agent-kernel/ContextBudget"].includes(s)
  ));
  const duplicated = Object.fromEntries(
    cluster.filter((s) => declarations.get(s).length > 1).map((s) => [s, declarations.get(s)]),
  );

  assert.deepEqual(
    duplicated,
    {},
    "an AdaptiveWorkflow schema string is declared in more than one place — a second origin "
    + "is free to drift, and the one that hid longest was named RUNTIME_PROFILE_SNAPSHOT_SCHEMA",
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
 * ⇒ *A guard that forbids the wrong spelling of a defect is not a guard.* Scoped to the
 * AdaptiveWorkflow cluster, matching M7's approved scope; inline literals elsewhere in the
 * tree are widespread and are not this milestone's to fix.
 */
test("no AdaptiveWorkflow schema is retyped as an inline literal outside artifacts.ts", () => {
  const isCluster = (schema) => (
    schema.startsWith("agent-kernel/AdaptiveWorkflow")
    || ["agent-kernel/SelectedStrategy", "agent-kernel/BenchmarkEvidence", "agent-kernel/ContextBudget"].includes(schema)
  );

  const retyped = new Map();
  for (const file of productionFiles()) {
    if (file === ARTIFACTS) continue;
    const source = readFileSync(resolve(REPO, file), "utf8");
    source.split("\n").forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      for (const m of line.matchAll(/"(agent-kernel\/[A-Za-z0-9_]+)"/g)) {
        if (!isCluster(m[1])) continue;
        if (!retyped.has(m[1])) retyped.set(m[1], []);
        retyped.get(m[1]).push(`${file}:${index + 1}`);
      }
    });
  }

  assert.deepEqual(
    Object.fromEntries(retyped),
    {},
    "an AdaptiveWorkflow schema string is written out here instead of imported from "
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
  const stale = KNOWN_OUTSTANDING.filter((s) => declared.has(s) || !usedInProduction.has(s));
  assert.deepEqual(
    stale,
    [],
    "these KNOWN_OUTSTANDING entries are fixed or gone — remove them from the list",
  );
});

// ## TODO: Test Permutations
