/**
 * G1 configurator/actors (A2) — milestone authorized 2026-08-18, local-codex/Plan.md
 * §POST-AM/Z.
 *
 * The roster's `KNOWN_UNREGISTERED` note read "actor-config-generation.js was DELETED by
 * P1.4 as dead code... either something else authors actor configs, or nothing does."
 * Traced: something did, in adapter glue — `ak-impl.mjs`'s `parseDelverSpec` defaulted,
 * validated and assembled the delver candidate object inline. `actor-generator.js`
 * (`generateActorSet`), the Configurator's own dead-looking candidate, is NOT the
 * fulfiller of this responsibility — it is a real, already-used grid-placement fixture
 * generator for scale/perf test data (`tests/helpers/tier-generators.js` →
 * `tests/runtime/e2e-fixture-generators.test.js`), a different concern entirely. Left
 * untouched; this milestone did not delete or wire it.
 *
 * What this proves: the delver candidate a build/run request receives is authored by the
 * Configurator's `authorDelverCandidate` (`personas/configurator/actor-authoring.js`), not
 * reproduced by CLI glue. `adapters-cli-no-actor-authoring.test.js` proves the CLI side
 * (no inline defaulting/validation/assembly); this proves the production wiring is real,
 * not a hand-rolled stand-in that happens to satisfy the shape check.
 */
const assert = require("node:assert/strict");
const { existsSync, readFileSync, readdirSync, statSync } = require("node:fs");
const { join, relative, sep } = require("node:path");

const ROOT = join(__dirname, "..", "..");
const SCANNED_ROOTS = ["packages", "scripts"].map((dir) => join(ROOT, dir));
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".mts", ".ts", ".cjs"]);
const SKIPPED = new Set(["node_modules", "dist", "build"]);
const AUTHORING_FILE = "packages/runtime/src/personas/configurator/actor-authoring.js";
// Same pattern as authorCandidates/candidate-authoring.js: the persona-internal service
// layer imports the authoring module, and controller.js re-exposes it from `services` —
// so the service layer is the sole importer, not controller.js directly.
const PUBLISHING_FILE = "packages/runtime/src/personas/configurator/configurator-services.js";
const EXPECTED_CONSUMER_SITES = ["packages/adapters-cli/src/cli/ak-impl.mjs"];

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

test("authorDelverCandidate is called only at the expected production consumer site", () => {
  const sites = new Set();
  for (const file of allSourceFiles()) {
    const rel = relative(ROOT, file).split(sep).join("/");
    if (rel.startsWith("tests/") || rel === PUBLISHING_FILE || rel === AUTHORING_FILE) continue;
    const source = readFileSync(file, "utf8");
    if (/\.authorDelverCandidate\s*\(/.test(source)) sites.add(rel);
  }
  assert.deepEqual(
    [...sites].sort(),
    [...EXPECTED_CONSUMER_SITES].sort(),
    "authorDelverCandidate must be called only at the known production consumer site — a "
      + "new site is a second author of what a delver candidate looks like unless it too "
      + "sources from a real Configurator persona (checked below for the known site)",
  );
});

test("the production consumer site sources authorDelverCandidate from a real Configurator persona", () => {
  const source = readFileSync(join(ROOT, EXPECTED_CONSUMER_SITES[0]), "utf8");
  assert.match(
    source,
    /import\s*\{[^}]*\bcreateConfiguratorPersona\b[^}]*\}\s*from\s*["'][^"']*personas\/configurator\/persona\.js["']/,
    "the consumer site must import the real Configurator persona factory",
  );
  assert.match(
    source,
    /const\s+configurator\s*=\s*createConfiguratorPersona\(/,
    "the consumer site must construct a real Configurator persona, not stand in for one",
  );
  assert.match(
    source,
    /configurator\.authorDelverCandidate\(/,
    "the wired call must trace to the constructed persona's own surface, not a bare import "
      + "of actor-authoring.js's function",
  );
});

test("actor-authoring.js is reachable from production, not dead code", () => {
  const importers = [];
  for (const file of allSourceFiles()) {
    const rel = relative(ROOT, file).split(sep).join("/");
    if (rel.startsWith("tests/") || rel === AUTHORING_FILE) continue;
    const source = readFileSync(file, "utf8");
    if (/from\s*["'][^"']*\/actor-authoring(\.js)?["']/.test(source)) importers.push(rel);
  }
  assert.deepEqual(
    importers,
    [PUBLISHING_FILE],
    "actor-authoring.js must be imported by the Configurator's own controller (which "
      + "publishes it on the persona surface) and nowhere else — a second importer would "
      + "be a second, unpublished path to the same authoring logic",
  );
});

// ## TODO: Test Permutations
// - controller.js stops publishing authorDelverCandidate on the persona surface (label-only)
// - a second production file starts calling configurator.authorDelverCandidate
// - actor-authoring.js imported directly, bypassing the controller's publication
