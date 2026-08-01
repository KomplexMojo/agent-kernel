#!/usr/bin/env node
/**
 * What would it cost to widen the typecheck gate?
 *
 * `pnpm run typecheck` guards a deliberately small scope: core-ts and its tests,
 * which are already clean under `strict`. Widening it is a per-package decision,
 * and that decision needs a number rather than a guess. This runs `tsc` over each
 * candidate scope in isolation and reports the error count.
 *
 * Nothing here fails the build — it is a planning tool. `pnpm run typecheck` is
 * the gate.
 *
 * Two very different questions, and the difference is the whole point:
 *   - checkJs OFF (default): "do the .ts files in this scope typecheck?"
 *   - checkJs ON  (--check-js): "what would it cost to type the .js too?"
 * Only the second is the size of an all-TypeScript migration.
 *
 * ⚠️ The temp config is written to the REPO ROOT, not to a tmpdir. tsc resolves
 * `include` relative to the config file's own directory, so a config in /tmp with
 * absolute include patterns silently matches almost nothing — the first version of
 * this script did exactly that and cheerfully reported 0 errors everywhere,
 * including for a package that actually has 7133. A report that cannot fail is
 * worse than no report.
 */

import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const checkJs = process.argv.includes("--check-js");
const CONFIG = join(ROOT, "tsconfig.__report.json");

const SCOPES = [
  { name: "core-ts (gated today)", include: ["packages/core-ts/src/**/*", "tests/core-ts/**/*"] },
  { name: "runtime/contracts", include: ["packages/runtime/src/contracts/**/*"] },
  { name: "runtime/personas", include: ["packages/runtime/src/personas/**/*"] },
  { name: "runtime (all)", include: ["packages/runtime/src/**/*"] },
  { name: "adapters-cli", include: ["packages/adapters-cli/src/**/*"] },
  { name: "adapters-web", include: ["packages/adapters-web/src/**/*"] },
  { name: "ui-web", include: ["packages/ui-web/src/**/*"] },
];

function measure(include) {
  writeFileSync(CONFIG, JSON.stringify({
    extends: "./tsconfig.json",
    compilerOptions: { types: ["node"], checkJs },
    include,
  }, null, 2));

  const listed = spawnSync("npx", ["tsc", "-p", CONFIG, "--listFiles"], { cwd: ROOT, encoding: "utf8" });
  const files = `${listed.stdout ?? ""}`.split("\n")
    .filter((line) => line.startsWith(ROOT) && !line.includes("node_modules")).length;

  const run = spawnSync("npx", ["tsc", "-p", CONFIG], { cwd: ROOT, encoding: "utf8" });
  const lines = `${run.stdout ?? ""}${run.stderr ?? ""}`.split("\n").filter((l) => / error TS\d+/.test(l));
  const codes = {};
  for (const line of lines) {
    const code = line.match(/error (TS\d+)/)?.[1];
    if (code) codes[code] = (codes[code] ?? 0) + 1;
  }
  const top = Object.entries(codes).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return { errors: lines.length, files, top };
}

try {
  console.log(`typecheck scope report  (checkJs: ${checkJs ? "ON — .ts and .js" : "off — .ts only"})\n`);
  console.log("   errors   files  scope                     most common");
  for (const scope of SCOPES) {
    const { errors, files, top } = measure(scope.include);
    // `files` is printed so a 0 is interpretable: with checkJs off, a package that is
    // all .js legitimately has nothing to check, and that is not the same as clean.
    const detail = top.map(([c, n]) => `${c}×${n}`).join("  ");
    console.log(`  ${String(errors).padStart(6)}  ${String(files).padStart(6)}  ${scope.name.padEnd(24)}${detail}`);
  }
  console.log("\n  Gate: pnpm run typecheck (tsconfig.typecheck.json)");
  if (!checkJs) console.log("  Re-run with --check-js to size an all-TypeScript migration.");
} finally {
  if (existsSync(CONFIG)) rmSync(CONFIG, { force: true });
}
