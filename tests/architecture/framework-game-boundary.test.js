/**
 * Framework vs game — the boundary the Primordial split cuts along (#739, tracker #747).
 *
 * agon is the framework: core-ts, runtime (personas, contracts, ports, runner,
 * render view models), the adapters, `agon`, the MCP server and the reference terminal
 * client (ui-ascii, kept by Darren 2026-11-06, #741). The game (Primordial) is a CONSUMER
 * of it, in its own private repository: the phone app, the playtest launcher, the archived
 * web UI, brand and design art. The game paths still here are the brand, design and demo
 * scripts until they move (#744). A path inside both a framework and a game root is game.
 * Charter → "Framework vs game".
 *
 * Three rules, each one-directional and checked against
 * `framework-game-boundary.json`:
 *
 *   1. The framework never imports game code.
 *   2. The framework names a game path only at a recorded seam, each with the issue
 *      that removes it. These are process or URL boundaries (`agon play` spawning the
 *      terminal client), not imports, but they still break when the game moves.
 *   3. The game reaches the framework only through the declared API surface, and
 *      never imports core-ts. The surface is exactly what the split must publish
 *      (#742): a game import of an undeclared module is a decision to widen the API,
 *      made in the JSON, not by accident.
 *
 * The seam and skin lists are exact: an entry nothing uses any more fails too. The API
 * surface is consumed mostly from Primordial, which this repository cannot see, so here
 * each entry must exist and the published exports must equal it; Primordial's own boundary
 * test checks that every agon import it makes is listed.
 */
const assert = require("node:assert/strict");
const { readFileSync, realpathSync, statSync } = require("node:fs");
const { resolve } = require("node:path");
const {
  ROOT,
  collectSourceFiles,
  importSpecifiers,
  isInside,
  maskSource,
  resolveImportTarget,
  toRepoPath,
} = require("./import-graph.js");

const BOUNDARY = JSON.parse(readFileSync(resolve(__dirname, "framework-game-boundary.json"), "utf8"));
const FRAMEWORK_ROOTS = BOUNDARY.frameworkRoots.map((path) => resolve(ROOT, path));
const GAME_ROOTS = BOUNDARY.gameRoots.map((path) => resolve(ROOT, path));
const CORE_ROOT = resolve(ROOT, "packages/core-ts");

// A game path written in framework source: a game directory followed by `/`.
const GAME_PATH_PATTERN = /(?<![\w-])(ui-ascii\/pwa\/|ui-web\/|scripts\/(?:game|pwa|brand|design|demo)\/)/g;

function within(path, roots) {
  const real = realpathSync(path);
  return roots.some((root) => isInside(real, realpathSync(root)));
}

const isGame = (path) => within(path, GAME_ROOTS);
const isFramework = (path) => within(path, FRAMEWORK_ROOTS) && !isGame(path);

/** Source files under the roots (a root may be a single file), keeping those `keep` accepts. */
function filesUnder(roots, keep) {
  const files = roots.flatMap((root) => (statSync(root).isFile() ? [root] : collectSourceFiles(root)));
  return [...new Set(files)].filter(keep).sort();
}
const frameworkFiles = () => filesUnder(FRAMEWORK_ROOTS, isFramework);
const gameFiles = () => filesUnder(GAME_ROOTS, isGame);

function report(heading, lines) {
  return `${heading}\n${lines.map((line) => `  ${line}`).join("\n")}`;
}

test("the boundary file names existing roots and its entries are well formed", () => {
  const problems = [];
  for (const root of [...BOUNDARY.frameworkRoots, ...BOUNDARY.gameRoots]) {
    try {
      realpathSync(resolve(ROOT, root));
    } catch {
      problems.push(`${root} (root does not exist)`);
    }
  }
  for (const [path, entry] of Object.entries(BOUNDARY.apiSurface)) {
    if (typeof entry.provides !== "string" || entry.provides.length === 0) problems.push(`${path} (apiSurface entry needs "provides")`);
    if (path.startsWith("packages/core-ts/")) problems.push(`${path} (core-ts can never be game API)`);
  }
  for (const seam of BOUNDARY.pathSeams) {
    if (!Number.isInteger(seam.issue)) problems.push(`${seam.file} ${seam.path} (path seam needs an issue number)`);
  }
  assert.deepEqual(problems, [], report("framework-game-boundary.json problem(s):", problems));
});

test("the framework never imports game code", () => {
  const violations = [];
  for (const file of frameworkFiles()) {
    for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
      if (!specifier.startsWith(".")) continue;
      const target = resolveImportTarget(file, specifier);
      if (target && isGame(target)) violations.push(`${toRepoPath(file)} -> ${specifier}`);
    }
  }
  assert.deepEqual(violations, [], report("framework -> game import(s):", violations));
});

test("the framework names game paths only at recorded seams, and every seam is still live", () => {
  const found = new Set();
  for (const file of frameworkFiles()) {
    // Comments may describe the game; only code and literals are a dependency.
    const code = maskSource(readFileSync(file, "utf8"), { strings: false });
    for (const match of code.matchAll(GAME_PATH_PATTERN)) found.add(`${toRepoPath(file)} :: ${match[1]}`);
  }
  const recorded = new Set(BOUNDARY.pathSeams.map((seam) => `${seam.file} :: ${seam.path}`));
  const unrecorded = [...found].filter((key) => !recorded.has(key)).sort();
  const stale = [...recorded].filter((key) => !found.has(key)).sort();
  assert.deepEqual(unrecorded, [], report("framework source names a game path outside a recorded seam:", unrecorded));
  assert.deepEqual(stale, [], report("recorded path seam(s) no longer present (remove them from the JSON):", stale));
});

test("the game reaches the framework only through the declared API surface, never core-ts", () => {
  const violations = [];
  for (const file of gameFiles()) {
    for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
      if (!specifier.startsWith(".")) continue;
      const target = resolveImportTarget(file, specifier);
      if (!target || isGame(target)) continue;
      const targetPath = toRepoPath(realpathSync(target));
      if (within(target, [CORE_ROOT])) {
        violations.push(`${toRepoPath(file)} -> ${targetPath} (core-ts: go through runtime)`);
      } else if (!isFramework(target)) {
        violations.push(`${toRepoPath(file)} -> ${targetPath} (neither game nor framework: classify it)`);
      } else if (!Object.hasOwn(BOUNDARY.apiSurface, targetPath)) {
        violations.push(`${toRepoPath(file)} -> ${targetPath} (not in apiSurface)`);
      }
    }
  }
  const missing = Object.keys(BOUNDARY.apiSurface).filter((path) => {
    try {
      return !statSync(resolve(ROOT, path)).isFile();
    } catch {
      return true;
    }
  }).sort();
  assert.deepEqual(violations, [], report("game -> framework import(s) outside the API surface:", violations));
  assert.deepEqual(missing, [], report("apiSurface entries that are not files (moved or deleted?):", missing));
});

// The vocabulary (affinity kinds, vitals, motivations) is a framework contract in
// contracts/game-vocabulary.js; contracts/game-elements.js is the SKIN the game restyles
// (#740, Darren 2026-11-06: rules stay, skin and content move). Only the recorded skin
// consumers (render view models, plus one Configurator preview awaiting #741) may import it,
// so persona logic can never come to depend on a colour or an asset id.
test("only recorded skin consumers in the framework import the skin module", () => {
  const skin = realpathSync(resolve(ROOT, "packages/runtime/src/contracts/game-elements.js"));
  const found = new Set();
  for (const file of frameworkFiles()) {
    if (realpathSync(file) === skin) continue;
    for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
      if (!specifier.startsWith(".")) continue;
      const target = resolveImportTarget(file, specifier);
      if (target && realpathSync(target) === skin) found.add(toRepoPath(file));
    }
  }
  const recorded = new Set(Object.keys(BOUNDARY.skinConsumers));
  const unrecorded = [...found].filter((path) => !recorded.has(path)).sort();
  const stale = [...recorded].filter((path) => !found.has(path)).sort();
  assert.deepEqual(unrecorded, [], report("framework file imports the skin; use contracts/game-vocabulary.js or record it:", unrecorded));
  assert.deepEqual(stale, [], report("recorded skin consumer(s) no longer import the skin (remove them):", stale));
});

// The published packages (#742) export exactly the declared API surface, so a game that
// consumes them cannot even resolve an undeclared module: Node refuses it at import time.
test("framework package exports equal the declared API surface", () => {
  const problems = [];
  for (const pkg of ["runtime", "adapters-web", "adapters-cli", "ui-ascii"]) {
    const prefix = `packages/${pkg}/`;
    const manifest = JSON.parse(readFileSync(resolve(ROOT, prefix, "package.json"), "utf8"));
    const exported = Object.keys(manifest.exports || {}).filter((key) => key !== "./package.json").sort();
    const declared = Object.keys(BOUNDARY.apiSurface)
      .filter((path) => path.startsWith(prefix))
      .map((path) => `./${path.slice(prefix.length)}`)
      .sort();
    for (const key of exported) {
      if (manifest.exports[key] !== key) problems.push(`${prefix}package.json exports ${key} -> ${manifest.exports[key]} (must map to itself)`);
    }
    const missing = declared.filter((key) => !exported.includes(key));
    const extra = exported.filter((key) => !declared.includes(key));
    if (missing.length) problems.push(`${prefix}package.json is missing exports: ${missing.join(", ")}`);
    if (extra.length) problems.push(`${prefix}package.json exports undeclared modules: ${extra.join(", ")}`);
  }
  assert.deepEqual(problems, [], report("package exports drifted from apiSurface:", problems));
});
