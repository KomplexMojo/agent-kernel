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
 *
 * ═══ M9 (2026-08-11) — THE RULE NO LONGER NEEDS A LIST ════════════════════════════════════
 * M8 closed the seven schemas that had no central declaration; M9 closed the other half of
 * the problem — 182 sites across 50 files that retyped a schema artifacts.ts ALREADY
 * declared, including 68 rival `const` declarations, five of them in `contracts/` itself.
 *
 * So the retype check dropped its scope: no production file outside artifacts.ts may write
 * an `agent-kernel/*` literal at all. A guard that enumerates what it protects is a guard
 * someone has to remember to extend — M8's named set of ten would have silently failed to
 * cover the 172 sites it did not name.
 *
 * ⚠️ THE THREE CHECKS ARE NOT INDEPENDENT ANYMORE, and that is fine as long as it is stated:
 * with no literals permitted outside artifacts.ts, the declaration check can only fail when
 * the retype check already has. It is kept because it names a different defect in its message
 * ("this schema does not exist centrally" vs "this schema is written out twice"), and a
 * failing suite that says both is more useful than one that says either.
 */
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const REPO = resolve(__dirname, "../..");
const ARTIFACTS = "packages/runtime/src/contracts/artifacts.ts";

/**
 * The one exemption list, honoured by every check below. Enumerated, never silenced.
 *
 * ✅ EMPTIED BY M8 (2026-08-11) and still empty after M9. M7 left seven schemas here — the
 * same charter violation as the AdaptiveWorkflow cluster, elsewhere in the tree — and
 * recorded them rather than silencing them, precisely so the next census would find a list
 * instead of a search. It worked: M8 was executable from this list alone.
 *
 * An empty list is the point, not a formality. With nothing exempted the rule is absolute —
 * no production file outside artifacts.ts may write an `agent-kernel/*` literal — and
 * growing this list again takes a deliberate edit to this file and a stated reason.
 *
 * ⚠️ It is ONE list on purpose. M9 briefly had an exemption that silenced the declaration
 * check but not the retype check, which is an escape hatch that does not actually let you
 * out: an entry would have looked like a decision while still failing the suite.
 */
const KNOWN_OUTSTANDING = Object.freeze([]);

/**
 * Schemas held to SINGLE ORIGIN — declared in artifacts.ts *and* imported, never retyped.
 *
 * ⚠️ THIS IS A DIFFERENT AND STRICTER PROPERTY than "declared in artifacts.ts", and the
 * distinction is the whole reason M7's first guard passed its own defect. A file that writes
 * `"agent-kernel/GameplayBundle"` inline satisfies the declaration check — the schema *is*
 * declared, it simply is not being used from the declaration — while remaining free to drift
 * from it. That was not hypothetical: before M8, `GAMEPLAY_BUNDLE_SCHEMA` was declared
 * independently in the CLI that writes bundles and in the browser module that reads them.
 *
 * ✅ M9 (2026-08-11) MADE THIS EVERY SCHEMA. It was a named set of ten — M7's cluster plus
 * M8's seven — because 182 sites across 50 files still retyped a centrally declared schema.
 * That backlog is closed, so the rule needs no list: **no production file outside
 * artifacts.ts may write an `agent-kernel/*` literal at all.** A set that has to enumerate
 * what it protects is a set someone has to remember to add to; this one cannot go stale
 * because there is nothing in it to update.
 */
function isSingleOrigin(schema) {
  return !KNOWN_OUTSTANDING.includes(schema);
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
 * ⇒ *A guard that forbids the wrong spelling of a defect is not a guard.* M7 scoped this to
 * its own cluster, M8 widened it to a named ten, and M9 removed the scope entirely: it is now
 * every schema, because there is no longer a single retyped literal in the tree to grandfather.
 * This is the strongest of the three checks and the one that actually holds the property —
 * the declaration check below it can only ever agree.
 */
test("no schema is retyped as an inline literal outside artifacts.ts", () => {
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
    "a schema string is written out here instead of imported from contracts/artifacts.ts — "
    + "import the constant; a retyped literal is a second origin that no declaration-keyed "
    + "census can see",
  );
});

test("KNOWN_OUTSTANDING is honest: every entry is still an actual violation", () => {
  const literalsOutsideArtifacts = new Set();
  for (const file of productionFiles()) {
    if (file === ARTIFACTS) continue;
    for (const schema of schemaLiteralsIn(readFileSync(resolve(REPO, file), "utf8"))) {
      literalsOutsideArtifacts.add(schema);
    }
  }

  // A stale allowlist entry is the failure mode this branch has hit repeatedly: the note
  // outlives the thing it described, and nothing reports it.
  //
  // The list is empty after M8/M9, so this assertion is currently vacuous — kept
  // deliberately, because it goes live the moment anyone adds an entry, which is precisely
  // when it is needed. M9 retargeted it: an exemption is honest while the schema is still
  // written as a literal somewhere outside artifacts.ts. The old wording ("still undeclared")
  // described the pre-M8 world, where a schema could be absent from artifacts.ts entirely;
  // nothing can be in that state now, so that check would have passed forever.
  const stale = KNOWN_OUTSTANDING.filter((s) => !literalsOutsideArtifacts.has(s));
  assert.deepEqual(
    stale,
    [],
    "these KNOWN_OUTSTANDING entries no longer violate anything — remove them from the list",
  );
});

// ## TODO: Test Permutations
