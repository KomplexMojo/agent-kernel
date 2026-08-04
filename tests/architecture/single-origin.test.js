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
    concept: "price/budget-split numeric constants",
    canonicalHome: [
      "packages/runtime/src/personas/allocator/base-costs.json",
      "packages/runtime/src/personas/allocator",
    ],
    forbiddenPattern: PRICE_OR_BUDGET_CONSTANT,
    scope: "packages/runtime/src",
  },
];

const SKIPPED_CONCEPTS = new Set([
  // CR.1: Keep skipped until the diff that moves price/budget splits into Allocator un-skips it.
  "price/budget-split numeric constants",
]);

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

function maskCommentsAndStrings(source) {
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
        masked += "  ";
        index += 1;
      } else {
        masked += character === "\n" ? "\n" : " ";
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
      masked += " ";
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

function scanGuard({ canonicalHome, forbiddenPattern, scope }) {
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

    const source = maskCommentsAndStrings(readFileSync(file, "utf8"));
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
