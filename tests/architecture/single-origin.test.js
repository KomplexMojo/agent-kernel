const assert = require("node:assert/strict");
const { existsSync, readFileSync, readdirSync, statSync } = require("node:fs");
const { extname, isAbsolute, join, relative, resolve, sep } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const SKIPPED_DIRECTORIES = new Set(["dist", "node_modules"]);

// Match top-level numeric constant declarations whose names identify economy
// prices or budget splits. The semantic name filter avoids sweeping in
// unrelated gameplay values such as mana costs or walkable-density targets.
const PRICE_OR_BUDGET_CONSTANT = new RegExp(
  String.raw`^(?:export\s+)?const\s+(?=[\w$]*(?:price|(?:room|resource|layout|design|actor|vital|regen|stack)[\w$]*cost|budget[\w$]*(?:token|split|pool|pct|ratio)|(?:dungeon|delver)[\w$]*pct|(?:delver|warden)[\w$]*ratio|pool[\w$]*weight|sub[\w$]*pool|reference[\w$]*target|default_?pools?|resource[\w$]*permanent[\w$]*multiplier))[\w$]+\s*=\s*(?:-?(?:\d[\d_]*(?:\.[\d_]*)?|\.\d+)(?:e[+-]?\d+)?\b|(?:Object\.freeze\s*\(\s*)?[\[{][^;]*?\b-?(?:\d[\d_]*(?:\.[\d_]*)?|\.\d+)(?:e[+-]?\d+)?\b)`,
  "gim",
);

// Shared game vocabulary (motivation + card type/size) and its normalizers.
// P5.1 D1 collapsed an alias chain in which ONE value wore FOUR names across two
// personas: GAME_MOTIVATION_KINDS (contracts) was re-declared as MOTIVATION_KINDS
// in BOTH configurator/motivation-loadouts.js AND configurator/motivation-rules.js,
// then again as ALLOWED_MOTIVATIONS in orchestrator/prompt-contract.js. Every
// consumer outside the Configurator had to import a persona internal to read a
// vocabulary that was never the Configurator's to own. This guard is LIVE (not
// skipped): the crossings are gone, so any new declaration is a regression.
//
// Deliberately NOT matched: orchestrator/prompt-contract.js's ALLOWED_* names.
// Those restate a vocabulary as "values valid in an LLM prompt contract", which is
// that persona's own concern, and they read through contracts now rather than
// through another persona.
const SHARED_VOCABULARY_DECLARATION = new RegExp(
  String.raw`^(?:export\s+)?(?:const\s+(?:MOTIVATION_KINDS|MOTIVATION_DISPLAY_GROUPS|MOTIVATION_KIND_TO_CODE|MOTIVATION_FAMILIES|MOTIVATION_EXCLUSIVE_GROUPS|CARD_TYPE_IDS|ROOM_CARD_SIZE_IDS|DEFAULT_ROOM_CARD_SIZE)\b|function\s+(?:normalizeCardType|normalizeRoomCardSize|normalizeCardCount|normalizeMotivationKind|getMotivationExclusiveGroup|getConflictingMotivationKinds|coerceMotivationKinds)\b)`,
  "gim",
);

// PX.3 — no persona FACTORY may read the wall clock, in ANY form.
// A defaulted clock means a caller that forgets to inject one silently gets
// wall-clock time, degrading determinism and replay with nothing failing. The rule
// is enforced at construction by _shared/require-clock.js; this stops it being
// reintroduced.
//
// ⚠️ WIDENED 2026-08-04. The previous pattern was `clock = () => new Date()` — the
// DEFAULT-PARAMETER form alone — and it therefore missed two live violations inside
// its own scope, both writing a wall-clock timestamp into a persisted artifact:
//   director/controller.js   `typeof clock === "function" ? clock() : new Date()...`
//                            → PlanArtifact.meta.createdAt
//   actor/controller.js      `payload?.clock || (() => new Date()...)`
//                            → the SolverRequest's createdAt, across the adapter boundary
// Both were unreachable in practice (construction had already run requireClock), but
// a guard that only recognises one spelling of a defect is not a guard — the defect
// class is "a persona factory reaches for the wall clock", not "one syntax does".
// Forbidding `new Date(` outright is the honest expression of that and is checkable:
// none of the 14 files parses a date either, so there is no legitimate use to carve out.
//
// Scope is the 14 factory files (7 controllers + 7 state machines), which is exactly
// PX.3's stated target: "make clock required at PERSONA CONSTRUCTION".
//
// PX.3'S RECORDED RESIDUE — 18 non-factory sites, still open. They are plain
// functions rather than constructors, so requiring injection there is a separate and
// larger call about every helper's signature. The earlier note here listed TEN and
// counted only the default-parameter form; this is the full census:
//   default parameter (13): personas/annotator/llm-trace.js ·
//     personas/orchestrator/{budget-inputs ×2,llm-capture ×2}.js ·
//     personas/_shared/{persona-helpers,tick-orchestrator,tick-state-machine}.mts ·
//     ports/solver.js · contracts/schema-catalog.js ·
//     adaptive-workflow/{metrics,state-machine ×3}.js
//   `||` fallback (2): personas/allocator/default-price-list.js ·
//     personas/director/buildspec-assembler.js
//   ternary fallback (2): personas/orchestrator/llm-budget-loop.js · runner/runtime-fsm.mjs
//   direct read (1): render/visualization-snapshot.js
const PERSONA_CLOCK_DEFAULT = /new Date\(/g;

const PERSONA_FACTORY_FILES = [
  "orchestrator", "director", "configurator", "actor", "allocator", "annotator", "moderator",
].flatMap((persona) => [
  `packages/runtime/src/personas/${persona}/controller.js`,
  `packages/runtime/src/personas/${persona}/state-machine.js`,
]);

// CR.9 M4 — the propose/judge protocol's VALUES have one origin: contracts/spend-protocol.js.
//
// M3 minted BudgetEnvelope / ConfigurationCandidate / SpendVerdict and left their
// vocabulary homeless. The schema strings were restated at each point of use, and the
// four authoring-validation outcomes were declared THREE times: build-spec.js (the
// enforcing copy), artifacts.ts (the type mirror), and a private copy inside
// allocator/budget-fulfillment.js — a persona restating a vocabulary it does not own,
// with nothing checking the three agreed. That is the CR.1 defect class (a second
// silently-diverging answer to one question) sitting inside the milestone meant to end it.
//
// ⚠️ THIS GUARD MATCHES STRING LITERAL VALUES, NOT CONSTANT NAMES, and that is the whole
// design. `const REASONS = ["over_cap"]` and `if (verdict.reason === "over_cap")` are both
// the defect; neither carries a recognisable NAME to match on. Carrying forward the
// 2026-08-04 guard-spelling lesson one layer up: forbid the capability, not one syntax.
//
// It therefore needs the string literals INTACT, which is why `keepStringLiterals` exists —
// the default masking blanks them and this guard would silently match nothing. A guard that
// scans a blanked corpus reports zero violations and reads exactly like coverage.
// Comments stay masked, so prose naming an outcome (READMEs, this file, the plan) is fine:
// the defect is re-declaring the value in code, not mentioning it.
//
// PERTURBATION-VERIFIED 2026-08-05, four restorations plus one control:
//   re-declared outcome vocabulary in the Allocator      → DETECTED
//   `verdict.reason === "over_cap"` in the Allocator     → DETECTED (no constant name exists)
//   restated protocol schema string in the Configurator  → DETECTED
//   the same value named in a code COMMENT               → correctly NOT detected
//   the first defect, with `keepStringLiterals` removed  → NOT DETECTED — the guard passes
//     clean with the violation in the tree. That control is why the option is spelled out
//     above rather than left as a quiet parameter.
//
// CANONICAL HOME is the contracts DIRECTORY, not the single file: artifacts.ts is the type
// mirror and must restate the values as a TypeScript union, since no runtime `.js` module
// can import a `.ts` one. Nothing here checks the two agree — that is
// `tests/personas/allocator/allocator-spend-verdict-reasons.test.js`, which compares the
// union's members to the runtime constant. The two guards are complementary: this one stops
// a FOURTH declaration appearing, that one stops the two sanctioned ones drifting.
const SPEND_PROTOCOL_VOCABULARY = new RegExp(
  String.raw`["'](?:over_cap|not_priceable|invalid_requirements|conflicting_requirements`
  + String.raw`|insufficient_budget|agent-kernel/(?:BudgetEnvelope|ConfigurationCandidate|SpendVerdict))["']`,
  "g",
);

const SINGLE_ORIGIN_GUARDS = [
  {
    concept: "persona factory wall-clock reads",
    canonicalHome: [],
    forbiddenPattern: PERSONA_CLOCK_DEFAULT,
    scope: PERSONA_FACTORY_FILES,
  },
  {
    concept: "shared game vocabulary (motivation + card type/size)",
    canonicalHome: ["packages/runtime/src/contracts"],
    forbiddenPattern: SHARED_VOCABULARY_DECLARATION,
    scope: "packages/runtime/src",
  },
  {
    concept: "EffectKind",
    canonicalHome: "packages/core-ts/src/ports/effects.ts",
    forbiddenPattern: /\b(?:enum|const)\s+EffectKind\b/g,
    scope: "packages",
  },
  {
    concept: "spend-protocol vocabulary (verdict reasons, authoring outcomes, protocol schemas)",
    canonicalHome: ["packages/runtime/src/contracts"],
    forbiddenPattern: SPEND_PROTOCOL_VOCABULARY,
    scope: "packages",
    keepStringLiterals: true,
  },
  {
    concept: "price/budget-split numeric constants",
    canonicalHome: [
      "packages/runtime/src/personas/allocator/base-costs.json",
      "packages/runtime/src/personas/allocator",
    ],
    forbiddenPattern: PRICE_OR_BUDGET_CONSTANT,
    // ⚠️ SCOPE IS `packages`, NOT `packages/runtime/src` — widened at CR.9 M5 after the
    // narrow scope hid a live violation through the entire milestone that closed CR.1.
    // `adapters-cli/src/cli/ak-impl.mjs` held AUTHORING_POOL_WEIGHT_DEFAULTS, a fourth
    // copy of the budget split, and it is the one that actually drives `ak create` — so a
    // retune of the canonical split in base-costs.json changed nothing on the real path
    // and the guard reported clean. The economy does not stop at the runtime package, and
    // neither may the guard that protects it.
    scope: "packages",
  },
];

// CR.9 M5 emptied this. The price/budget guard was skipped from the day it was written,
// as a census rather than a gate: 15 constants across 4 files, two of which CR.1's
// hand-written inventory never listed. `89e213e` and `fb46132` relocated 14; the last —
// `DEFAULT_LAYOUT_TILE_COSTS` in contracts — was DELETED here rather than moved, because
// its numbers had already diverged from `base-costs.json` and picking a winner would have
// left the second table standing. The guard is now live, and CR.1 closes on it.
//
// Keep this set empty. A skipped guard reads exactly like a passing one in the runner's
// output, which is how 15 constants stayed outside the Allocator under a green suite.
const SKIPPED_CONCEPTS = new Set([]);

function toRepoPath(path) {
  return relative(ROOT, path).split(sep).join("/");
}

function isInside(path, directory) {
  const pathFromDirectory = relative(directory, path);
  return pathFromDirectory === "" || (!pathFromDirectory.startsWith(`..${sep}`) && !isAbsolute(pathFromDirectory));
}

function collectSourceFiles(directory, files = new Set()) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) collectSourceFiles(path, files);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      files.add(path);
    }
  }
  return files;
}

/**
 * Blank out comments, and — unless a guard asks otherwise — string literals too.
 *
 * `keepStringLiterals` exists for value-matching guards (CR.9 M4's protocol vocabulary):
 * their defect IS a string literal, so blanking strings would make the scan match nothing
 * and report a clean sweep. Comments stay masked in both modes, because prose naming a
 * value is documentation, not a second declaration of it.
 */
function maskCommentsAndStrings(source, { keepStringLiterals = false } = {}) {
  let masked = "";
  let state = "code";
  let quote = "";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (state === "line-comment") {
      if (character === "\n") {
        masked += "\n";
        state = "code";
      } else {
        masked += " ";
      }
      continue;
    }

    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        masked += "  ";
        index += 1;
        state = "code";
      } else {
        masked += character === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (state === "string") {
      if (character === "\\" && next !== undefined) {
        masked += keepStringLiterals ? character + next : "  ";
        index += 1;
      } else {
        masked += keepStringLiterals || character === "\n" ? character : " ";
        if (character === quote) state = "code";
      }
      continue;
    }

    if (character === "/" && next === "/") {
      masked += "  ";
      index += 1;
      state = "line-comment";
    } else if (character === "/" && next === "*") {
      masked += "  ";
      index += 1;
      state = "block-comment";
    } else if (character === "'" || character === '"' || character === "`") {
      quote = character;
      state = "string";
      masked += keepStringLiterals ? character : " ";
    } else {
      masked += character;
    }
  }

  return masked;
}

function asList(value) {
  return Array.isArray(value) ? value : [value];
}

function isCanonicalFile(file, canonicalHome) {
  return asList(canonicalHome).some((home) => {
    const canonicalPath = resolve(ROOT, home);
    if (existsSync(canonicalPath) && statSync(canonicalPath).isDirectory()) {
      return isInside(file, canonicalPath);
    }
    return file === canonicalPath;
  });
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function scanGuard({ canonicalHome, forbiddenPattern, scope, keepStringLiterals = false }) {
  const files = new Set();
  for (const scopedPath of asList(scope)) {
    const resolved = resolve(ROOT, scopedPath);
    // A scope may name a directory to walk or a single file — the persona-clock
    // guard targets 14 specific factory files rather than whole directories,
    // because their non-factory neighbours are deliberately out of scope.
    if (statSync(resolved).isDirectory()) {
      collectSourceFiles(resolved, files);
    } else {
      files.add(resolved);
    }
  }

  const violations = [];
  for (const file of [...files].sort()) {
    if (isCanonicalFile(file, canonicalHome)) continue;

    const source = maskCommentsAndStrings(readFileSync(file, "utf8"), { keepStringLiterals });
    const flags = forbiddenPattern.flags.includes("g")
      ? forbiddenPattern.flags
      : `${forbiddenPattern.flags}g`;
    const matcher = new RegExp(forbiddenPattern.source, flags);

    for (const match of source.matchAll(matcher)) {
      violations.push(`${toRepoPath(file)}:${lineNumberAt(source, match.index)}`);
    }
  }

  return violations;
}

for (const guard of SINGLE_ORIGIN_GUARDS) {
  const registerTest = SKIPPED_CONCEPTS.has(guard.concept) ? test.skip : test;
  registerTest(`${guard.concept} is declared only in its canonical home`, () => {
    const violations = scanGuard(guard);
    assert.equal(
      violations.length,
      0,
      `${guard.concept} declaration(s) outside ${asList(guard.canonicalHome).join(" or ")}:\n`
        + violations.map((violation) => `  ${violation}`).join("\n"),
    );
  });
}
