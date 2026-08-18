/**
 * Persona-boundary-style guard — `configurator/actors` milestone, 2026-08-18.
 *
 * The roster's own note said "either something else authors actor configs, or nothing
 * does" (`charter-coverage.test.js` KNOWN_UNREGISTERED). Traced: something did, in the
 * wrong layer — `packages/adapters-cli/src/cli/ak-impl.mjs`'s `parseDelverSpec` defaulted
 * a missing motivation to `"attacking"`, validated affinity/motivation/setup-mode against
 * the chartered enums, and assembled the delver candidate object inline. That is domain
 * logic in adapter glue, which the Enforcement Checklist forbids outright.
 *
 * This guard does NOT forbid the CLI's `;`-delimited field splitting or its generic
 * value-format tokenizers (`parseActorAffinities`/`parseActorVitals`/
 * `parseOptimizationGoalList`) — those are DSL syntax shared with `parseWardenSpec`
 * (out of scope here) and stay in the CLI per the milestone spec. It forbids only the
 * THREE signals unique to authoring a delver candidate: the default motivation literal,
 * the assembled candidate's `type: "delver"` tag, and skipping the Configurator's
 * `authorDelverCandidate` entry point.
 *
 * Perturbation (run for real, see local-codex/Plan.md §POST-AM/Z close-out): revert
 * `parseDelverSpec` to assemble the candidate inline → this guard catches it and no other
 * guard does (`persona-boundary.test.js` only catches internal-module imports, not
 * content-level domain logic).
 */
const assert = require("node:assert/strict");
const { readFileSync, readdirSync, statSync } = require("node:fs");
const { extname, join, relative, sep } = require("node:path");

const ROOT = join(__dirname, "..", "..");
const CLI_SRC = join(ROOT, "packages", "adapters-cli", "src");
const AK_IMPL = join(CLI_SRC, "cli", "ak-impl.mjs");
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts"]);
const SKIPPED = new Set(["node_modules", "dist", "build"]);

function sourceFiles(directory, found = []) {
  for (const entry of readdirSync(directory)) {
    if (SKIPPED.has(entry)) continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
    } else if (SOURCE_EXTENSIONS.has(extname(entry))) {
      found.push(full);
    }
  }
  return found;
}

function extractFunctionBody(source, functionName) {
  const signatureStart = source.indexOf(`function ${functionName}(`);
  assert.ok(signatureStart >= 0, `${functionName} was not found — has it moved or been renamed?`);

  // Skip past the parameter list first — it may itself contain destructuring braces
  // (e.g. `{ defaultAffinity = X } = {}`), which must not be mistaken for the body.
  const parenStart = source.indexOf("(", signatureStart);
  let parenDepth = 0;
  let paramsEnd = -1;
  for (let i = parenStart; i < source.length; i += 1) {
    if (source[i] === "(") parenDepth += 1;
    else if (source[i] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        paramsEnd = i;
        break;
      }
    }
  }
  assert.ok(paramsEnd >= 0, `${functionName}'s parameter list was never closed`);

  let depth = 0;
  let bodyStart = -1;
  for (let i = paramsEnd; i < source.length; i += 1) {
    if (source[i] === "{") {
      if (depth === 0) bodyStart = i;
      depth += 1;
    } else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(bodyStart, i + 1);
    }
  }
  throw new Error(`${functionName}'s closing brace was never found`);
}

test("adapters-cli declares no default delver motivation", () => {
  for (const file of sourceFiles(CLI_SRC)) {
    const rel = relative(ROOT, file).split(sep).join("/");
    const source = readFileSync(file, "utf8");
    assert.ok(
      !source.includes('"attacking"'),
      `${rel} declares the default delver motivation literal — this belongs to the `
        + "Configurator's authorDelverCandidate now (packages/runtime/src/personas/"
        + "configurator/actor-authoring.js), not to CLI glue",
    );
  }
});

test("adapters-cli assembles no delver candidate object directly", () => {
  for (const file of sourceFiles(CLI_SRC)) {
    const rel = relative(ROOT, file).split(sep).join("/");
    const source = readFileSync(file, "utf8");
    assert.ok(
      !source.includes('type: "delver"'),
      `${rel} assembles a delver candidate object directly — candidate assembly is `
        + "Configurator work (configurator/actors); the CLI must call "
        + "configurator.authorDelverCandidate(...) and use its return value",
    );
  }
});

test("parseDelverSpec sources its candidate from the Configurator, not from inline validation", () => {
  const source = readFileSync(AK_IMPL, "utf8");
  const body = extractFunctionBody(source, "parseDelverSpec");
  assert.match(
    body,
    /configurator\.authorDelverCandidate\(/,
    "parseDelverSpec must call the Configurator's authorDelverCandidate entry point rather "
      + "than defaulting/validating affinity, motivation or setup-mode inline",
  );
  assert.ok(
    !/ALLOWED_MOTIVATIONS\.includes\(motivation\)/.test(body),
    "parseDelverSpec still enum-validates the resolved motivation inline — that check moved "
      + "into authorDelverCandidate",
  );
});

// ## TODO: Test Permutations
// - parseWardenSpec is untouched by this guard (out of scope) — confirm it still assembles
//   `type: "warden"` inline without tripping this test
// - a second CLI file (not ak-impl.mjs) reintroducing `"attacking"` or `type: "delver"`
// - authorDelverCandidate called but its return value discarded in favor of a hand-rolled object
