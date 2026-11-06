/**
 * Framework vs game — the boundary the Primordial split cuts along (#739, tracker #747).
 *
 * agent-kernel is the framework: core-ts, runtime (personas, contracts, ports, runner,
 * render view models), the adapters, `ak` and the MCP server. The game (Primordial)
 * is a CONSUMER of it: the playable clients (ui-ascii, ui-web), the playtest and PWA
 * scripts, brand and design art. Charter → "Framework vs game".
 *
 * Three rules, each one-directional and checked against
 * `framework-game-boundary.json`:
 *
 *   1. The framework never imports game code.
 *   2. The framework names a game path only at a recorded seam, each with the issue
 *      that removes it. These are process or URL boundaries (`ak play` spawning the
 *      terminal client), not imports, but they still break when the game moves.
 *   3. The game reaches the framework only through the declared API surface, and
 *      never imports core-ts. The surface is exactly what the split must publish
 *      (#742): a game import of an undeclared module is a decision to widen the API,
 *      made in the JSON, not by accident.
 *
 * Every list is exact: a seam or surface entry nothing uses any more fails too, so
 * the file stays the truth about what crosses the line.
 */
const assert = require("node:assert/strict");
const { readFileSync, realpathSync } = require("node:fs");
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

// A game path written in framework source: a package or script directory followed by `/`.
const GAME_PATH_PATTERN = /(?<![\w-])(ui-ascii\/|ui-web\/|scripts\/(?:game|pwa|brand|design|demo|ui-ascii)\/)/g;

function filesUnder(roots) {
  return roots.flatMap((root) => collectSourceFiles(root)).sort();
}

function within(path, roots) {
  const real = realpathSync(path);
  return roots.some((root) => isInside(real, realpathSync(root)));
}

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
  for (const file of filesUnder(FRAMEWORK_ROOTS)) {
    for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
      if (!specifier.startsWith(".")) continue;
      const target = resolveImportTarget(file, specifier);
      if (target && within(target, GAME_ROOTS)) violations.push(`${toRepoPath(file)} -> ${specifier}`);
    }
  }
  assert.deepEqual(violations, [], report("framework -> game import(s):", violations));
});

test("the framework names game paths only at recorded seams, and every seam is still live", () => {
  const found = new Set();
  for (const file of filesUnder(FRAMEWORK_ROOTS)) {
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
  const used = new Set();
  const violations = [];
  for (const file of filesUnder(GAME_ROOTS)) {
    for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
      if (!specifier.startsWith(".")) continue;
      const target = resolveImportTarget(file, specifier);
      if (!target || within(target, GAME_ROOTS)) continue;
      const targetPath = toRepoPath(realpathSync(target));
      if (within(target, [CORE_ROOT])) {
        violations.push(`${toRepoPath(file)} -> ${targetPath} (core-ts: go through runtime)`);
      } else if (!within(target, FRAMEWORK_ROOTS)) {
        violations.push(`${toRepoPath(file)} -> ${targetPath} (neither game nor framework: classify it)`);
      } else if (!Object.hasOwn(BOUNDARY.apiSurface, targetPath)) {
        violations.push(`${toRepoPath(file)} -> ${targetPath} (not in apiSurface)`);
      } else {
        used.add(targetPath);
      }
    }
  }
  const stale = Object.keys(BOUNDARY.apiSurface).filter((path) => !used.has(path)).sort();
  assert.deepEqual(violations, [], report("game -> framework import(s) outside the API surface:", violations));
  assert.deepEqual(stale, [], report("apiSurface entries no game code imports (remove them):", stale));
});

// The vocabulary (affinity kinds, vitals, motivations) is a framework contract in
// contracts/game-vocabulary.js; contracts/game-elements.js is the SKIN the game restyles
// (#740, Darren 2026-11-06: rules stay, skin and content move). Only the recorded skin
// consumers (render view models, plus one Configurator preview awaiting #741) may import it,
// so persona logic can never come to depend on a colour or an asset id.
test("only recorded skin consumers in the framework import the skin module", () => {
  const skin = realpathSync(resolve(ROOT, "packages/runtime/src/contracts/game-elements.js"));
  const found = new Set();
  for (const file of filesUnder(FRAMEWORK_ROOTS)) {
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
