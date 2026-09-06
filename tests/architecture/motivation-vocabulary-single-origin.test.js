/**
 * ONE motivation vocabulary, and every copy must agree with it.
 *
 * AUDIT, 2026-09-06. Twenty-six files across core-ts, runtime, adapters-cli and ui-web
 * name motivation kinds as string literals, and FIVE of them enumerate all twelve:
 *
 *   core-ts/src/motivation-readers.ts                  the code→name authority
 *   runtime/src/contracts/game-elements.js             the name authority
 *   runtime/src/personas/configurator/motivation-rules.js
 *   runtime/src/render/actor-medallion-composer.ts
 *   runtime/src/render/actor-medallion-composer.js     (a second copy of the same file)
 *
 * TWO THINGS WERE UNGUARDED, and both are the repo's recurring defect rather than new
 * mistakes.
 *
 * 1. THE TWO AUTHORITIES WERE NEVER COMPARED. `MOTIVATION_KIND_BY_CODE` (core) and
 *    `GAME_MOTIVATION_KINDS` (contracts) are independent lists of the same twelve names
 *    in different packages. Nothing asserted they agree, so adding a kind to one and not
 *    the other would have produced a vocabulary that disagrees with itself, silently.
 *
 * 2. `single-origin.test.js` MATCHES DECLARATION NAMES, so it catches a re-declared
 *    `const MOTIVATION_KINDS` and cannot see an ANONYMOUS inline array of the same twelve
 *    strings — which is exactly what the medallion composer holds. That guard's own
 *    header records this lesson from a previous occurrence: "the guard was scoped to the
 *    spelling that existed when it was written rather than to the concept." It happened
 *    again, one level down.
 *
 * This guard is about AGREEMENT, not about forbidding copies. A render layer mapping each
 * kind to a token is legitimate; a render layer inventing a thirteenth kind, or missing
 * one, is not.
 */
"use strict";

const assert = require("node:assert/strict");
const { readdirSync, readFileSync, statSync } = require("node:fs");
const { join, relative, resolve, sep } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const PACKAGES = resolve(ROOT, "packages");
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".mts", ".ts"]);
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "build", "graphify-out"]);

function collect(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) collect(join(directory, entry.name), files);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
      files.push(join(directory, entry.name));
    }
  }
  return files;
}

const repoPath = (p) => relative(ROOT, p).split(sep).join("/");

async function authorities() {
  const core = await import("../../packages/core-ts/src/index.ts");
  const contracts = await import("../../packages/runtime/src/contracts/game-elements.js");
  const fromCore = Object.entries(core.MOTIVATION_KIND_BY_CODE)
    .filter(([code]) => Number(code) > 0)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, name]) => name);
  return { fromCore, fromContracts: Array.from(contracts.GAME_MOTIVATION_KINDS) };
}

test("core and contracts name the same motivation kinds", async () => {
  const { fromCore, fromContracts } = await authorities();
  assert.deepEqual(
    [...fromContracts].sort(),
    [...fromCore].sort(),
    "core-ts `MOTIVATION_KIND_BY_CODE` and contracts `GAME_MOTIVATION_KINDS` are the two "
      + "lists every other copy is derived from. They live in different packages and were "
      + "never compared until this guard: a kind added to one alone gives the codebase a "
      + "vocabulary that disagrees with itself, and nothing else would notice.",
  );
});

test("a file that carries most of the vocabulary carries all of it", async () => {
  const { fromCore } = await authorities();
  const known = new Set(fromCore);
  // A file naming two-thirds of the kinds is a CODEBOOK, whatever it calls itself, and the
  // risk is that it falls one member behind when a kind is added — eleven of twelve, with
  // nothing failing and one motivation quietly missing a price, an icon or a rule.
  //
  // The threshold is what makes this non-circular. Asserting completeness only on files
  // that already name every kind would prove nothing; asserting it on files that name most
  // of them is exactly the drift that has no other detector.
  //
  // ⚠️ THE THRESHOLD IS HIGH ON PURPOSE — two-thirds was tried first and produced a false
  // positive that is itself worth knowing about. `configurator/motivation-evaluation-core.js`
  // names 8 of 12, and every one is an AXIS TIER name rather than a motivation kind:
  // MOBILITY_NAMES is ["stationary","exploring","patrolling"], COMBAT_NAMES is
  // ["none","attacking","defending"]. Those strings are the names of tier VALUES, and they
  // collide by spelling with motivation KINDS. Same token, two meanings, decided by
  // context — no textual guard can separate them, so the threshold sits above where axis
  // tables land and below where a codebook missing a member or two does.
  const threshold = known.size - 2;
  const incomplete = [];
  for (const file of collect(PACKAGES)) {
    const source = readFileSync(file, "utf8");
    const named = new Set();
    for (const [, token] of source.matchAll(/"([a-z][a-z_]{2,30})"/g)) {
      if (known.has(token)) named.add(token);
    }
    if (named.size < threshold || named.size === known.size) continue;
    const missing = fromCore.filter((kind) => !named.has(kind));
    incomplete.push(`${repoPath(file)} names ${named.size}/${known.size}, missing: ${missing.join(", ")}`);
  }
  assert.deepEqual(
    incomplete,
    [],
    "these files hold most of the motivation vocabulary but not all of it. Either they are "
      + "codebooks that fell behind, or they should derive the list from "
      + `contracts/game-elements.js instead of restating it:\n  ${incomplete.join("\n  ")}`,
  );
});

// ⚠️ A THIRD GUARD WAS WRITTEN AND DELETED, and the reason is worth more than the guard.
// It flagged any non-kind token appearing inside an array alongside three or more kinds,
// intending to catch a typo or a retired name. It fired on four files immediately, and
// every hit was legitimate: `defend`, `guard`, `patrol`, `sentry`, `warden` are role
// aliases that share those arrays by design, and `combat`, `mobility`, `none` are axis
// names. Without a spec of what else may legally sit beside a kind, the check cannot tell
// a typo from a synonym — and a guard whose failures are usually false teaches people to
// add exceptions to it, which is worse than not having it.

// ## TODO: Test Permutations
// - a file naming exactly two kinds is not treated as a codebook
// - the guard survives a kind whose name is a substring of another
