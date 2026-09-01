/**
 * Persona authority — the Allocator is the ONLY author of a design-token cost.
 *
 * Charter §261-263: "There is one price model, owned by the Allocator. Base cost
 * numbers live in personas/allocator/base-costs.json (data, tunable); formulas
 * live in Allocator code. A base cost literal in any other [module is
 * forbidden]." §271-273: every priced element — vitals, regen, affinity,
 * motivations, tiles, hazards, resources, actors — is charged through the
 * Allocator's price list, and "silent fallbacks to alternate cost tables are
 * forbidden".
 *
 * Nothing enforced that, and two rival tables had grown inside the Configurator:
 *
 *   configurator/affinity-rules.js   defaultDesignCostTokens: 4, 16, 36, 64, 100
 *   configurator/motivation-rules.js defaultDesignCostTokens: 0, 1, 5, 20
 *
 * while the Allocator prices the same concepts from base-costs.json with
 * DIFFERENT numbers (motivation_strategy_focused is 10 there and 20 here). They
 * are inert — no code charges from them — which is precisely what made them
 * survive: the charter names this exact hazard in §277-281, "a published price
 * with no charging path… the dangerous one — the price list reads complete, so
 * nobody looks". They are validated and persisted into every build's rules
 * artifact, so anything reading that artifact prices affinities and motivations
 * differently from the Allocator.
 *
 * WHAT THIS FORBIDS IS DEFINING A PRICE, NOT MENTIONING ONE. A field assigned a
 * numeric LITERAL is an author declaring a cost. A field assigned from a
 * variable, a price map, or a function result is a carrier moving someone else's
 * number, which is what non-Allocator code is supposed to do. Distinguishing the
 * two is the whole point: `tokenCost: inst.cost` is correct and must not fire.
 */
"use strict";

const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { extname, join, relative, resolve, sep } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const SEARCH_ROOTS = [
  resolve(ROOT, "packages/runtime/src"),
  resolve(ROOT, "packages/core-ts/src"),
  resolve(ROOT, "packages/adapters-cli/src"),
  resolve(ROOT, "packages/adapters-web/src"),
];
const ALLOCATOR_DIR = "packages/runtime/src/personas/allocator/";
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const SKIPPED_DIRECTORIES = new Set(["dist", "node_modules"]);

/**
 * Field names that DECLARE a design-token cost. Matched only when the value is a
 * numeric literal — see the header on carriers vs authors.
 */
const TOKEN_COST_FIELD = /\b([A-Za-z_$][\w$]*(?:[Cc]ostTokens|[Tt]okenCost|[Dd]esignCost|[Bb]aseCost|[Uu]nitCost|[Pp]riceTokens|[Tt]okenPrice|[Cc]ostPerUnit)[\w$]*)\s*:\s*(-?\d+(?:\.\d+)?)\s*[,}\n]/g;

/**
 * The vocabulary above is a HEURISTIC and this guard says so out loud.
 *
 * "Is this number a price?" is not statically decidable, so any guard here
 * matches names, and a name-matching guard is bypassable by naming a field
 * something else. The first version matched only four fragments
 * (`CostTokens|DesignCost|costTokens|designCost`) — a rival table called
 * `motivationBaseCost: 20` would have sailed straight through, which is the same
 * one-spelling weakness this guard exists to catch elsewhere.
 *
 * Two things compensate:
 *   1. the vocabulary below is broad and listed in one place, so extending it is
 *      a one-line change rather than a rewrite;
 *   2. `ALLOCATOR_PRICE_IDS` cross-checks against the Allocator's ACTUAL keys, so
 *      a rival table that reuses a real price id (`motivation_strategy_focused:
 *      20`) is caught no matter what the surrounding field is called.
 *
 * ⇒ Extend the vocabulary when a new cost-shaped field name enters the codebase.
 *   That is this guard's known maintenance cost, stated rather than discovered.
 */
const BASE_COSTS_PATH = resolve(ROOT, "packages/runtime/src/personas/allocator/base-costs.json");

/** Every price id the Allocator actually publishes, e.g. "motivation_random". */
function readAllocatorPriceIds() {
  const raw = JSON.parse(readFileSync(BASE_COSTS_PATH, "utf8"));
  const ids = new Set();
  for (const [group, entries] of Object.entries(raw)) {
    if (group.startsWith("_") || typeof entries !== "object" || entries === null) continue;
    for (const id of Object.keys(entries)) {
      // Namespaced ids only (`motivation_random`, `vital_health_point`). The one
      // group that is not namespaced — `levelBudgetSplitPercent` with keys
      // `room` / `delver` / `warden` — uses words too common to attribute: a
      // bare `delver: 1` in CLI arg parsing is a count, not a price, and
      // matching it reports the parser as a rival cost table. A guard that cries
      // wolf on ordinary code gets muted, which costs more than the coverage
      // gained. Those five splits are percentages of a budget rather than unit
      // prices, so the vocabulary check above remains their cover.
      if (id.includes("_")) ids.add(id);
    }
  }
  return ids;
}

/**
 * Known non-Allocator declarations, each with the reason it is still here.
 * ⚠️ This list may only SHRINK. An entry is a charter violation that has been
 * SEEN, not one that has been forgiven.
 */
const KNOWN_RIVAL_TABLES = new Map([
  // EMPTY, and it should stay that way.
  //
  // It held two entries when this guard was written:
  //   affinity-rules.js   F10a — per-tier design costs 4/16/36/64/100
  //   motivation-rules.js F13  — per-kind design costs 0/1/5/20, already
  //                              disagreeing with base-costs.json
  //                              (strategy_focused: 10 there, 20 here)
  // Both were deleted by AM.4 in this same diff, so the exception list emptied
  // before it was ever needed. Leaving the entries behind would have been worse
  // than useless: an allowlist naming files that no longer violate anything
  // silently permits the violation to come BACK to exactly those two files —
  // the one place it is most likely to.
]);

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

function toRepoPath(path) {
  return relative(ROOT, path).split(sep).join("/");
}

function findTokenCostDeclarations() {
  const byFile = new Map();
  for (const root of SEARCH_ROOTS) {
    for (const file of collectSourceFiles(root).sort()) {
      const repoPath = toRepoPath(file);
      if (repoPath.startsWith(ALLOCATOR_DIR)) continue; // the one legitimate author
      const source = readFileSync(file, "utf8");
      const found = [];
      let match;
      TOKEN_COST_FIELD.lastIndex = 0;
      while ((match = TOKEN_COST_FIELD.exec(source)) !== null) {
        found.push(`${match[1]}: ${match[2]}`);
      }
      if (found.length > 0) byFile.set(repoPath, found);
    }
  }
  return byFile;
}

test("only the Allocator declares a design-token cost", () => {
  const byFile = findTokenCostDeclarations();
  const unexpected = [...byFile.entries()].filter(([file]) => !KNOWN_RIVAL_TABLES.has(file));

  assert.deepEqual(
    unexpected.map(([file, decls]) => `${file} — ${[...new Set(decls)].join(", ")}`),
    [],
    "a design-token cost was declared outside packages/runtime/src/personas/allocator/.\n"
      + "Charter §261-263: base cost numbers live in the Allocator's base-costs.json and nowhere else;\n"
      + "§271-273 forbids alternate cost tables. Move the number to base-costs.json and read it\n"
      + "through the Allocator's price list, or carry it from a variable instead of declaring a literal.",
  );
});

test("the known rival cost tables do not grow, and each is recorded with its finding", () => {
  const byFile = findTokenCostDeclarations();

  for (const [file, reason] of KNOWN_RIVAL_TABLES.entries()) {
    assert.ok(
      typeof reason === "string" && reason.includes("—"),
      `${file} must record WHY it is still here and which finding tracks it`,
    );
  }

  // A rival table that is still present must not spread to new files. This is
  // the ratchet: the map above may lose entries, never gain them silently.
  const present = [...byFile.keys()].filter((file) => KNOWN_RIVAL_TABLES.has(file));
  assert.ok(
    present.length <= KNOWN_RIVAL_TABLES.size,
    `rival cost tables grew: ${present.join(", ")}`,
  );
});

test("no module outside the Allocator assigns a number to one of its published price ids", () => {
  // Vocabulary-independent: this catches a rival table however its enclosing
  // field is named, as long as it reuses a real price id. `defaultDesignCostTokens`
  // did not — which is exactly why BOTH checks are needed, and why neither alone
  // would have caught both F10a and a future variant.
  const priceIds = readAllocatorPriceIds();
  assert.ok(priceIds.size > 0, "base-costs.json must publish price ids");

  const violations = [];
  for (const root of SEARCH_ROOTS) {
    for (const file of collectSourceFiles(root).sort()) {
      const repoPath = toRepoPath(file);
      if (repoPath.startsWith(ALLOCATOR_DIR)) continue;
      const source = readFileSync(file, "utf8");
      for (const id of priceIds) {
        // `"motivation_random": 3` or `motivation_random: 3` — a number bound to
        // an Allocator price id outside the Allocator is a second price for it.
        const assigned = new RegExp(`["']?\\b${id}\\b["']?\\s*:\\s*-?\\d`);
        if (assigned.test(source)) violations.push(`${repoPath} — ${id}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    "a number was bound to one of the Allocator's own price ids outside the Allocator.\n"
      + "That is a second price for an element that already has one (charter §271-273:\n"
      + "silent fallbacks to alternate cost tables are forbidden).",
  );
});

test("mixed-room build and presentation never author or reconstruct design-token spend", () => {
  const orchestrator = readFileSync(
    resolve(ROOT, "packages/runtime/src/build/orchestrate-build.js"),
    "utf8",
  );
  const summary = readFileSync(
    resolve(ROOT, "packages/runtime/src/build/mixed-room-summary.js"),
    "utf8",
  );

  assert.equal(orchestrator.includes("priceMixedRoomDesignSpend({"), true);
  assert.equal(orchestrator.includes("tokenSpend"), false);
  assert.equal(orchestrator.includes("defaultTileTokenCost"), false);
  assert.equal(summary.includes("tokenSpend"), false);
  assert.equal(summary.includes("defaultTileTokenCost"), false);
  assert.equal(summary.includes("calculatePriceTotal"), false);
  assert.equal(summary.includes("normalizePriceItems"), false);
  assert.equal(summary.includes("unitCost"), false);
  assert.equal(summary.includes("designTokenSpend"), true);
  assert.equal(summary.includes("allocator_summary_required"), true);
});

test("this guard states what it does NOT cover", () => {
  // A guard that looks total but is heuristic is worse than one that admits it:
  // the first stops people looking. Keep the caveat in the file, tested, so it
  // cannot be quietly dropped while the heuristic stays.
  const selfSource = readFileSync(__filename, "utf8");
  assert.ok(
    selfSource.includes("HEURISTIC") && selfSource.includes("bypassable by naming a field"),
    "the header must keep stating that name-matching is heuristic and extensible; "
      + "removing that caveat while keeping the heuristic misrepresents the coverage",
  );
});

// ## TODO: Test Permutations
//
// - `tokenCost: inst.cost` / `costTokens: resolved` / `designCostTokens: fn()`
//   must NOT fire — carriers are not authors
// - `defaultDesignCostTokens: 0` must fire: zero is a declared price, and a
//   published price of zero is one of the two hazards charter §277-281 names
// - a declaration inside packages/runtime/src/personas/allocator/ must NOT fire
// - a NEW file declaring a token cost must fire even when its numbers agree with
//   base-costs.json — agreement today is not single origin
