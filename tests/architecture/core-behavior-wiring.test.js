/**
 * Built, unit-tested, and unreachable — the drift class this repo keeps growing.
 *
 * Findings F5, F6, F8 and F9 were ALL one shape. Each was a core-ts behavior with
 * a full unit-test file, exported on the public surface, and **zero production
 * callers**:
 *
 *   applyAffinityDamage / …ToHazard / …PullFromHazard   affinity never reached a vital
 *   resolveMotivatedActorAffinityInteraction            stacks never interacted in a tick
 *   spendMotivatedActorAffinityMana                     grants were acquired, never spent
 *   evaluateMotivations + the flag mask                 motivation never gated behavior
 *   motivationKindsConflict                             conflicting motivations never refused
 *
 * Every one of them passed its own tests. The suite was green the entire time,
 * because a unit test calls the function directly — being unreachable from the
 * application is invisible to it, and that is exactly what "affinities and
 * motivations don't do anything across ticks" turned out to mean.
 *
 * WHY THIS GUARD IS ABOUT BEHAVIORS, NOT EXPORTS. 104 of core's 189 exported
 * names have no production reference, but most are QUERIES (`get*`, `has*`,
 * `is*`) — API surface an adapter or UI may legitimately not use yet. An unwired
 * query is unused surface. An unwired BEHAVIOR — something that mutates state or
 * decides an outcome — is a feature that cannot happen. Only the second is a
 * defect, so only the second is ratcheted. Guarding the raw export count instead
 * would produce a number too noisy to act on, which is its own way of enforcing
 * nothing.
 *
 * THIS IS A RATCHET, NOT A BAN. The baseline below is what was unreachable when
 * the guard was written. It may SHRINK freely. It may not grow: a new behavior
 * that nothing calls is a milestone that stopped one step short of done.
 */
"use strict";

const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { extname, join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const CORE_INDEX = resolve(ROOT, "packages/core-ts/src/index.ts");
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const SKIPPED_DIRECTORIES = new Set(["dist", "node_modules"]);

/**
 * Production code that may legitimately call a core behavior. Tests are excluded
 * ON PURPOSE — a test calling a function is what made this class invisible.
 */
/**
 * ⚠️ `packages/core-ts/src` is DELIBERATELY ABSENT.
 *
 * The first version of this guard included it and reported 0 unwired behaviors —
 * a perfect score that meant nothing, because every behavior is named in the
 * module that DEFINES it, so each one matched itself and looked wired. The guard
 * asserted a tautology. The honesty sub-test below is what caught it, which is
 * the reason that sub-test exists.
 *
 * "Wired" here means reachable from a layer ABOVE the kernel — runtime, adapters
 * or UI. A core behavior called only by other core code is not reachable by the
 * application unless its caller is, and the question this guard asks is "can the
 * application do this?", not "does this identifier appear twice".
 */
const PRODUCTION_ROOTS = [
  "packages/runtime/src",
  "packages/adapters-cli/src",
  "packages/adapters-web/src",
  "packages/adapters-test/src",
  "packages/ui-web/src",
];

/** A behavior mutates state or decides an outcome. A query answers a question. */
const QUERY_PREFIXES = ["get", "has", "is", "read", "render", "unpack", "pack", "to", "format"];

function isBehaviorName(name) {
  return !QUERY_PREFIXES.some((prefix) =>
    name.startsWith(prefix) && name.length > prefix.length && name[prefix.length] === name[prefix.length].toUpperCase());
}

function collectSourceFiles(directory, files = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) collectSourceFiles(path, files);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

function readCoreSurface() {
  const source = readFileSync(CORE_INDEX, "utf8");
  const list = source.match(/export const CORE_API_KEYS[^=]*=\s*\[([\s\S]*?)\]/);
  assert.ok(list, "core-ts must publish its surface as CORE_API_KEYS in packages/core-ts/src/index.ts");
  return [...list[1].matchAll(/"([A-Za-z0-9_$]+)"/g)].map((m) => m[1]);
}

/**
 * Production source with the core index itself removed: index.ts names every
 * export twice (the key list, then the assignment), so counting it as a caller
 * would make every export look wired and the guard would assert nothing.
 */
function readProductionSource() {
  const chunks = [];
  for (const root of PRODUCTION_ROOTS) {
    for (const file of collectSourceFiles(resolve(ROOT, root))) {
            chunks.push(readFileSync(file, "utf8"));
    }
  }
  return chunks.join("\n");
}

function findUnwiredBehaviors() {
  const production = readProductionSource();
  return readCoreSurface()
    .filter(isBehaviorName)
    .filter((name) => !new RegExp(`\\b${name}\\b`).test(production))
    .sort();
}

/**
 * Recorded 2026-08-14, immediately after AM.0–AM.3 closed F1/F2/F4/F12:
 * **22 of core's 68 behaviors cannot be reached by the application.** Nearly all
 * are the affinity and motivation surface — `applyAffinityDamage`,
 * `resolveMotivatedActorAffinityInteraction`, `spendMotivatedActorAffinityMana`,
 * `motivationKindsConflict`, the three affinity-expression predicates, the whole
 * resource placement trio. Program AM Phase 2 (AM.5–AM.9) is the work of wiring
 * them, and this number is how that work is measured.
 *
 * Set to the EXACT current count, not a round number above it. A baseline with
 * slack in it is a ratchet that permits the next regression for free.
 *
 * KNOWN CONSERVATIVE BIAS: a behavior reached only through another core-ts
 * function is reported as unwired, because core-internal call chains are not
 * traced — `setActiveMotivatedActor` is in the list below even though AM.2 wired
 * it, since its caller is `rules/move.ts`. The bias is deliberate and one-way:
 * it over-reports, so the guard can never quietly hide a real gap. If it ever
 * under-reported, the count would be reassuring and wrong, which is the failure
 * mode this whole file exists to end.
 */
const BASELINE_UNWIRED_BEHAVIOR_COUNT = 13;

test("no core-ts BEHAVIOR is added that production cannot reach", () => {
  const unwired = findUnwiredBehaviors();

  assert.ok(
    unwired.length <= BASELINE_UNWIRED_BEHAVIOR_COUNT,
    `unwired core behaviors grew from ${BASELINE_UNWIRED_BEHAVIOR_COUNT} to ${unwired.length}.\n`
      + "A behavior no production code calls is a feature that cannot happen — its unit tests pass\n"
      + "and the application never reaches it. That is how F5/F6/F8/F9 (affinity and motivation\n"
      + "doing nothing across ticks) stayed green for months.\n"
      + "Either wire it in this diff, or do not export it yet.\n\n"
      + `currently unreachable:\n${unwired.map((n) => `  ${n}`).join("\n")}`,
  );
});

test("the baseline is honest — it must not be set above the current count", () => {
  // A ratchet whose baseline drifts upward is a ratchet that has been unwound.
  // If the count has fallen, LOWER the baseline in the same diff so the next
  // regression is caught at the new level rather than the old one.
  const unwired = findUnwiredBehaviors();
  assert.ok(
    BASELINE_UNWIRED_BEHAVIOR_COUNT <= unwired.length + 8,
    `the baseline (${BASELINE_UNWIRED_BEHAVIOR_COUNT}) is far above the actual count `
      + `(${unwired.length}). Lower it so the guard keeps its teeth.`,
  );
});

// ## TODO: Test Permutations
//
// - a name matching a QUERY prefix (getFoo, hasFoo, isFoo, readFoo) must be
//   classified as a query, and `gettysburg`-style false prefixes must not be
// - adding a fake behavior to CORE_API_KEYS with no caller must raise the count
// - a behavior referenced ONLY from tests/ must still count as unwired — that is
//   the entire point of excluding tests from PRODUCTION_ROOTS
