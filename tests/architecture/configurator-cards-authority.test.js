/**
 * G1 configurator/cards (A2) — THE NINE, paperwork six, 2026-08-18.
 *
 * `allocator/judges-not-authors`'s registry entry already proves the ALLOCATOR's half of
 * this exact mechanism: the Allocator refuses to price a candidate card without the
 * Configurator's `authorCandidates` injected (CR.9 M3, `allocator_candidate_authoring_required`).
 * `tests/personas/allocator/allocator-judges-not-authors.test.js` goes further than that
 * refusal — "the winning card is one the Configurator actually proposed" and "motivations
 * reach the price through the candidate's published field, not a re-derivation" both use
 * `tests/helpers/configurator-capabilities.js`, which wires a REAL
 * `createConfiguratorPersona()`, not a stub, specifically so a test can't pass by
 * hand-rolling the second implementation the refusal exists to prevent.
 *
 * What no entry claims is the CONFIGURATOR's own side: could production author a
 * candidate card (`buildMinimumDelverCard`, `proposeDelverCandidates`, and siblings in
 * `candidate-authoring.js`) without going through the Configurator at all? Not reproven
 * here — cited, plus one inventory closing the gap between "the Allocator refuses a
 * missing authoring surface" and "production supplies a REAL one, not a hand-rolled
 * stand-in that happens to satisfy the shape check".
 */
const assert = require("node:assert/strict");
const { existsSync, readFileSync, readdirSync, statSync } = require("node:fs");
const { join, relative, sep } = require("node:path");

const ROOT = join(__dirname, "..", "..");
const SCANNED_ROOTS = ["packages", "scripts"].map((dir) => join(ROOT, dir));
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".mts", ".ts", ".cjs"]);
const SKIPPED = new Set(["node_modules", "dist", "build"]);
const CARD_AUTHORING_FILE = "packages/runtime/src/commands/card-authoring.js";
// The Configurator's own controller PUBLISHES authorCandidates on its persona surface
// (`authorCandidates: services.authorCandidates`) — that is the origin, not a second
// consumer, and is excluded for the same reason a function's own definition doesn't
// count as a caller of itself.
const PUBLISHING_FILE = "packages/runtime/src/personas/configurator/controller.js";
// Both are real production wiring sites (CLI and the card-authoring command), each
// threading a REAL Configurator persona's own authorCandidates into the Allocator —
// two legitimate callers of the same public surface, not two authors.
const EXPECTED_CONSUMER_SITES = [
  "packages/adapters-cli/src/cli/ak-impl.mjs",
  CARD_AUTHORING_FILE,
];

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

test("authorCandidates is assigned only at the expected production consumer sites", () => {
  const sites = [];
  for (const file of allSourceFiles()) {
    const rel = relative(ROOT, file).split(sep).join("/");
    if (rel.startsWith("tests/") || rel === PUBLISHING_FILE) continue;
    const source = readFileSync(file, "utf8");
    for (const line of source.split("\n")) {
      if (/^\s*\/\//.test(line)) continue; // comments mentioning the name are not assignments
      if (/authorCandidates\s*:\s*[A-Za-z_$]/.test(line)) {
        sites.push(rel);
        break;
      }
    }
  }
  assert.deepEqual(
    sites.sort(),
    [...EXPECTED_CONSUMER_SITES].sort(),
    "authorCandidates must be assigned only at the known production consumer sites — a "
      + "new site is a second author of what a candidate card looks like unless it too "
      + "sources from a real Configurator persona (checked below for the known sites)",
  );
});

test("every production consumer site sources authorCandidates from a real Configurator persona", () => {
  for (const rel of EXPECTED_CONSUMER_SITES) {
    const source = readFileSync(join(ROOT, rel), "utf8");
    assert.match(
      source,
      /import\s*\{[^}]*\bcreateConfiguratorPersona\b[^}]*\}\s*from\s*["'][^"']*personas\/configurator\/persona\.js["']/,
      `${rel} must import the real Configurator persona factory`,
    );
    assert.match(
      source,
      /createConfiguratorPersona\(/,
      `${rel} must construct a real Configurator persona, not stand in for one`,
    );
    assert.match(
      source,
      /authorCandidates\s*:\s*configurator(Authoring)?\.authorCandidates|authorCandidates\s*:\s*configuratorAuthoring/,
      `${rel}'s wired authorCandidates value must trace to the constructed persona's own surface`,
    );
  }
});

test("card-authoring.js is reachable from production, not dead code", () => {
  const importers = [];
  for (const file of allSourceFiles()) {
    const rel = relative(ROOT, file).split(sep).join("/");
    if (rel.startsWith("tests/") || rel === CARD_AUTHORING_FILE) continue;
    const source = readFileSync(file, "utf8");
    if (/from\s*["'][^"']*commands\/card-authoring(\.js)?["']/.test(source)) importers.push(rel);
  }
  assert.ok(importers.length > 0, "card-authoring.js has no importer — this guard would be vacuous otherwise");
});
