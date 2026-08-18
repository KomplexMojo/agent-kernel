/**
 * Ports & Adapters — the RUNTIME side of the boundary.
 *
 * `dependency-direction.test.js` already guards two of the three layers:
 *   - core-ts imports nothing outside core-ts, and does no IO / clock / random;
 *   - runtime imports no adapter or UI package.
 *
 * Nothing guarded the third: **runtime may not perform IO itself.** "Does not
 * import adapters-cli" and "does not open a file" are different claims, and only
 * the first was enforced. The runtime happened to be clean — every write goes
 * through an injected host function (`requireHostFunction(host, "writeJson")`)
 * — but that was a convention, not a rule, so the next milestone that needs to
 * persist something could reach for `node:fs` and no test would object.
 *
 * That is not hypothetical here: AM.0b's job is literally "make `run` write a
 * world-state artifact". A milestone about writing state is exactly where the
 * layer dies quietly.
 *
 * The clock and randomness checks are the same rule in its other half. PX.3
 * (packages/runtime/src/personas/_shared/require-clock.js) established that a
 * clock is injected and never defaulted, and its own header says the enforcement
 * is "the architectural test asserting neither default has come back" — but that
 * test only ever covered personas. `runner/runtime-fsm.mjs` and
 * `render/visualization-snapshot.js` both still read the wall clock, and the
 * latter put `Date.now()` into a PERSISTED artifact id, so replaying a run
 * produced a different snapshot. A rule enforced on one directory and not its
 * neighbours reads as enforced.
 *
 * WHAT THIS FORBIDS IS THE CAPABILITY, NOT A SPELLING. Each entry below names a
 * capability (reach the filesystem, reach the network, read wall-clock time) and
 * matches every form the codebase could express it in — `require`, static
 * import, dynamic import, and bare global — because a guard that matches one
 * syntax of a defect is how the previous five instances of this trap survived.
 */
"use strict";

const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { extname, join, relative, resolve, sep } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const RUNTIME_ROOT = resolve(ROOT, "packages/runtime/src");
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const SKIPPED_DIRECTORIES = new Set(["dist", "node_modules"]);

/**
 * Capabilities the runtime must reach only through an injected port/adapter.
 * `pattern` matches executable source with comments and string literals masked.
 */
/**
 * ⚠️ `scope` IS LOAD-BEARING, and this guard shipped broken without it.
 *
 * The first version masked comments AND string literals before matching, then
 * used patterns like `from "node:fs"` — which live *inside* a string literal.
 * Masking had already blanked them, so every import-based check could never
 * match anything. Perturbing the guard (adding a real `import … from "node:fs"`
 * to ports/solver.js) reported ZERO violations and exposed it.
 *
 * The global-identifier checks (`fetch(`, `Date.now`, `localStorage`) genuinely
 * do need strings masked, or prose in an error message matches. So the two
 * classes need different source views:
 *
 *   scope: "imports"  → comments masked, STRINGS PRESERVED (specifiers live there)
 *   scope: "code"     → comments AND strings masked (identifiers must be executable)
 *
 * A guard that matched only the spellings its own author happened to test is the
 * exact trap this repo has now hit six times. Perturb every pattern class, not
 * one representative of it.
 */
const FORBIDDEN_RUNTIME_CAPABILITIES = [
  // ── Filesystem, process, network: adapter territory ──────────────────────
  {
    scope: "imports",
    label: "filesystem access (node:fs / fs)",
    pattern: /(?:require\s*\(\s*["'](?:node:)?fs(?:\/promises)?["']|from\s*["'](?:node:)?fs(?:\/promises)?["']|import\s*\(\s*["'](?:node:)?fs(?:\/promises)?["'])/,
    remedy: "take the write/read as an injected host function, as commands/kernel.js does with requireHostFunction(host, \"writeJson\").",
  },
  {
    scope: "imports",
    label: "child process / worker spawn",
    pattern: /(?:require\s*\(\s*["'](?:node:)?(?:child_process|worker_threads)["']|from\s*["'](?:node:)?(?:child_process|worker_threads)["']|import\s*\(\s*["'](?:node:)?(?:child_process|worker_threads)["'])/,
    remedy: "spawning belongs in an adapter; the runtime emits an effect and the adapter fulfils it.",
  },
  {
    scope: "mixed",
    label: "network access (node:http/https/net or fetch)",
    // `fetch` must be the GLOBAL, not a member: `adapters.externalFacts.fetch(effect)`
    // in ports/effects.js is an injected adapter being called, which is the
    // boundary working correctly. Requiring no preceding `.` or `?.` keeps the
    // guard pointed at the capability instead of at the word.
    pattern: /(?:require\s*\(\s*["'](?:node:)?(?:http|https|net|dgram)["']|from\s*["'](?:node:)?(?:http|https|net|dgram)["']|import\s*\(\s*["'](?:node:)?(?:http|https|net|dgram)["']|(?<![.\w$])fetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b)/,
    remedy: "all external IO lives in adapters-web / adapters-cli / adapters-test and is reached via ports/effects.js.",
  },
  {
    scope: "code",
    label: "browser storage",
    pattern: /\b(?:localStorage|sessionStorage|indexedDB)\b/,
    remedy: "browser storage is adapters-web territory.",
  },
  {
    scope: "code",
    label: "environment access (process.env / process.argv)",
    pattern: /\bprocess\s*\.\s*(?:env|argv|cwd)\b/,
    remedy: "configuration arrives as an argument, not from the ambient environment.",
  },
  // ── Determinism: the other half of the same rule (PX.3) ──────────────────
  {
    scope: "code",
    label: "wall-clock read (Date.now)",
    pattern: /\bDate\s*\.\s*now\s*\(/,
    remedy: "take an injected clock. See personas/_shared/require-clock.js — a defaulted clock degrades replay silently.",
  },
  {
    scope: "code",
    label: "wall-clock read (new Date() with no argument)",
    pattern: /\bnew\s+Date\s*\(\s*\)/,
    remedy: "take an injected clock returning an ISO-8601 string; `new Date(value)` for parsing a supplied value is fine.",
  },
  {
    scope: "code",
    label: "nondeterministic randomness (Math.random)",
    pattern: /\bMath\s*\.\s*random\s*\(/,
    remedy: "derive from the run seed, as personas/actor/controller.js does.",
  },
  {
    scope: "code",
    label: "ambient randomness (Web Crypto)",
    pattern: /\b(?:randomUUID|getRandomValues|randomBytes)\s*\(/,
    remedy: "seed-derive it, or take the generator as an argument. Reaching globalThis.crypto is an ambient capability, same class as Math.random.",
  },
  {
    scope: "imports",
    label: "crypto module import",
    pattern: /(?:require\s*\(\s*["'](?:node:)?crypto["']|from\s*["'](?:node:)?crypto["']|import\s*\(\s*["'](?:node:)?crypto["'])/,
    remedy: "hashing belongs behind an injected function; randomness belongs to the seed.",
  },
  {
    scope: "code",
    label: "high-resolution clock (performance.now / process.hrtime)",
    pattern: /\b(?:performance\s*\.\s*now|process\s*\.\s*hrtime)\s*\(/,
    remedy: "still a wall clock. Take an injected clock.",
  },
  {
    scope: "imports",
    label: "host environment modules (os / dns / readline / tty)",
    pattern: /(?:require\s*\(\s*["'](?:node:)?(?:os|dns|readline|tty)["']|from\s*["'](?:node:)?(?:os|dns|readline|tty)["']|import\s*\(\s*["'](?:node:)?(?:os|dns|readline|tty)["'])/,
    remedy: "the host's shape is adapter knowledge; the runtime receives what it needs as arguments.",
  },
];

/**
 * Sites accepted for now, each with the reason it is not a violation.
 * ⚠️ This list may SHRINK. Adding to it needs a stated reason in the same diff —
 * it is the record of where the boundary is bent, not a place to park work.
 */
const ACCEPTED = new Map([
  [
    "packages/runtime/src/commands/card-authoring.js::ambient randomness (Web Crypto)",
    "buildCardId() reaches globalThis.crypto for collision-resistant card IDs, and refuses to "
      + "generate one when Web Crypto is absent rather than falling back to a weaker source. Those "
      + "IDs are authoring identity, never simulation state: no golden or replay path reaches this "
      + "(CLI cards use deterministic card_delver_N ids), which is why the goldens are stable. "
      + "Listed rather than left uncovered so the next reader sees a decision, not an oversight.",
  ],
]);

function collectSourceFiles(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) collectSourceFiles(path, files);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

/**
 * Strip comments, and optionally string contents.
 * Import specifiers LIVE inside strings, so they must be matched with strings intact.
 */
function maskSource(source, { strings = true } = {}) {
  let masked = "";
  let state = "code";
  let quote = "";
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === "line-comment") {
      if (ch === "\n") { state = "code"; masked += ch; } else { masked += " "; }
      continue;
    }
    if (state === "block-comment") {
      if (ch === "*" && next === "/") { state = "code"; masked += "  "; i += 1; } else { masked += ch === "\n" ? ch : " "; }
      continue;
    }
    if (state === "string") {
      if (ch === "\\") { masked += strings ? "  " : source.slice(i, i + 2); i += 1; continue; }
      if (ch === quote) { state = "code"; masked += ch; continue; }
      masked += strings ? (ch === "\n" ? ch : " ") : ch;
      continue;
    }
    if (ch === "/" && next === "/") { state = "line-comment"; masked += "  "; i += 1; continue; }
    if (ch === "/" && next === "*") { state = "block-comment"; masked += "  "; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { state = "string"; quote = ch; masked += ch; continue; }
    masked += ch;
  }
  return masked;
}

function toRepoPath(path) {
  return relative(ROOT, path).split(sep).join("/");
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

test("runtime performs no IO, environment, clock or randomness access of its own", () => {
  const violations = [];

  for (const file of collectSourceFiles(RUNTIME_ROOT).sort()) {
    const repoPath = toRepoPath(file);
    const raw = readFileSync(file, "utf8");
    const views = {
      code: maskSource(raw, { strings: true }),
      imports: maskSource(raw, { strings: false }),
      mixed: maskSource(raw, { strings: false }),
    };

    for (const { label, pattern, remedy, scope } of FORBIDDEN_RUNTIME_CAPABILITIES) {
      const executable = views[scope] ?? views.code;
      const match = pattern.exec(executable);
      if (!match) continue;
      const accepted = ACCEPTED.get(`${repoPath}::${label}`);
      if (accepted) continue;
      violations.push(
        `${repoPath}:${lineNumberAt(executable, match.index)} — ${label}\n      → ${remedy}`,
      );
    }
  }

  assert.equal(
    violations.length,
    0,
    "runtime must reach every capability through an injected port or adapter.\n"
      + "The dependency-direction guard only proves the runtime does not IMPORT an adapter package;\n"
      + "these are the capabilities it must not exercise directly:\n"
      + violations.map((v) => `  ${v}`).join("\n"),
  );
});

test("the accepted-exception list is a record of bent boundaries, not a parking space", () => {
  // A boundary exception without a stated reason is indistinguishable from drift
  // that someone silenced. If the list ever grows, every entry must say why.
  for (const [key, reason] of ACCEPTED.entries()) {
    assert.ok(
      typeof reason === "string" && reason.trim().length >= 20,
      `accepted exception "${key}" must carry a substantive reason (got: ${JSON.stringify(reason)})`,
    );
  }
});

// ## TODO: Test Permutations
//
// - a fixture file under a temp dir exercising each forbidden capability, to
//   prove every pattern matches the form it claims to (import, require, dynamic
//   import, bare global) rather than only the one spelling the repo happens to use
// - `new Date(value)` and `new Date(a, b)` must NOT match; `new Date()` and
//   `new Date( )` must
// - a capability named inside a comment or a string literal must NOT match
